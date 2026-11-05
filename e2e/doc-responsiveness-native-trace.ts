import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { CDPSession } from '@playwright/test';

export const NATIVE_DIAGNOSTIC_TRACE = {
  traceConfig: {
    recordMode: 'recordUntilFull' as const,
    traceBufferSizeInKb: 64 * 1024,
    includedCategories: [
      'devtools.timeline',
      'toplevel',
      'v8',
      'disabled-by-default-v8.gc',
      'blink.user_timing',
    ],
  },
  transferMode: 'ReturnAsStream' as const,
  streamFormat: 'json' as const,
  streamCompression: 'none' as const,
};

/** One bounded diagnostic capture, separate from all unprofiled acceptance. */
export async function startNativeDiagnosticTrace(cdp: CDPSession, path: string) {
  type Completion = {
    stream?: string;
    dataLossOccurred?: boolean;
    traceFormat?: string;
    streamCompression?: string;
  };
  let complete: (value: Completion) => void = () => {};
  const completion = new Promise<Completion>((resolve) => {
    complete = resolve;
  });
  const categories = await cdp.send('Tracing.getCategories');
  cdp.on('Tracing.tracingComplete', complete);
  try {
    await cdp.send('Tracing.start', NATIVE_DIAGNOSTIC_TRACE);
  } catch (error) {
    cdp.off('Tracing.tracingComplete', complete);
    throw error;
  }
  let pending: Promise<Record<string, unknown>> | undefined;
  return {
    finish() {
      return (pending ??= (async () => {
        const began = performance.now(),
          hash = createHash('sha256');
        const maxBytes = 64 * 1024 * 1024,
          timeoutMs = 30_000;
        let stream: string | undefined,
          bytes = 0,
          ended = false,
          streamClosed = false;
        let failure: unknown, event: Completion | undefined;
        let rejectDeadline: (error: Error) => void = () => {};
        const expired = new Promise<never>((_, reject) => {
          rejectDeadline = reject;
        });
        const bounded = <T>(promise: Promise<T>) => Promise.race([promise, expired]);
        const timer = setTimeout(() => {
          rejectDeadline(new Error('Native diagnostic trace exceeded 30 seconds.'));
          void cdp.detach().catch(() => {});
        }, timeoutMs);
        let file: FileHandle | undefined;
        try {
          await bounded(cdp.send('Tracing.end'));
          ended = true;
          event = await bounded(completion);
          stream = event.stream;
          if (!stream) throw new Error('Native trace stream missing.');
          file = await open(path, 'wx');
          for (;;) {
            const chunk = await bounded(cdp.send('IO.read', { handle: stream, size: 64 * 1024 }));
            const buffer = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
            if (bytes + buffer.length > maxBytes)
              throw new Error('Native trace byte limit exceeded.');
            await bounded(file.writeFile(buffer));
            hash.update(buffer);
            bytes += buffer.length;
            if (chunk.eof) break;
          }
          if (
            !bytes ||
            event.dataLossOccurred !== false ||
            event.traceFormat !== 'json' ||
            event.streamCompression !== 'none'
          )
            throw new Error('Native diagnostic trace incomplete or unexpected format.');
        } catch (error) {
          failure = error;
        } finally {
          if (stream) {
            try {
              await bounded(cdp.send('IO.close', { handle: stream }));
              streamClosed = true;
            } catch (error) {
              failure ??= error;
            }
          }
          await file?.close().catch((error) => {
            failure ??= error;
          });
          clearTimeout(timer);
          cdp.off('Tracing.tracingComplete', complete);
          if (failure) await cdp.detach().catch(() => {});
        }
        const receipt = {
          diagnosticOnly: true,
          validation:
            'Transport only; trace parsing, clock alignment and attribution remain pending.',
          settings: NATIVE_DIAGNOSTIC_TRACE,
          categories,
          maxBytes,
          timeoutMs,
          bytes,
          sha256: hash.digest('hex'),
          ended,
          streamClosed,
          completion: event ?? null,
          elapsedMs: performance.now() - began,
          complete: !failure,
          failure: failure ? String(failure) : null,
        };
        await writeFile(path + '.receipt.json', JSON.stringify(receipt, null, 2) + '\n');
        if (failure) throw failure;
        return receipt;
      })());
    },
  };
}
