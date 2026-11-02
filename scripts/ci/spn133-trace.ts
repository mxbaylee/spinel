// Diagnostic helper only; never part of latency acceptance or production builds.
import type { CDPSession } from '@playwright/test';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export async function startDiagnosticTrace(cdp: CDPSession, destination: string) {
  type Completion = { stream?: string; dataLossOccurred: boolean };
  let finish!: (value: Completion) => void;
  const completed = new Promise<Completion>((resolve) => {
    finish = resolve;
  });
  cdp.on('Tracing.tracingComplete', finish);
  try {
    await cdp.send('Tracing.start', {
      // The first full timeline exceeded the unchanged cap. Keep GC and clock/
      // phase spans; omit unrelated per-frame, timer and general function events.
      categories: '-*,blink.user_timing,disabled-by-default-v8.gc',
      options: 'record-until-full',
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
      streamCompression: 'none',
    });
  } catch (error) {
    cdp.off('Tracing.tracingComplete', finish);
    throw error;
  }
  let result: Promise<Record<string, unknown>> | undefined;
  return () =>
    (result ??= (async () => {
      const deadline = Date.now() + 30_000;
      const bounded = async <T>(promise: Promise<T>): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Trace collection exceeded 30 s deadline')),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      const hash = createHash('sha256');
      let bytes = 0;
      let handle: string | undefined;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      let completion: Completion | undefined;
      try {
        await bounded(cdp.send('Tracing.end'));
        completion = await bounded(completed);
        handle = completion.stream;
        if (!handle) throw new Error('Trace completion did not supply a stream');
        file = await open(destination, 'w');
        for (;;) {
          const chunk = await bounded(cdp.send('IO.read', { handle, size: 1024 * 1024 }));
          const buffer = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
          bytes += buffer.length;
          if (bytes > 64 * 1024 * 1024)
            throw new Error('Trace exceeds declared 64 MiB retention cap');
          await file.writeFile(buffer);
          hash.update(buffer);
          if (chunk.eof) break;
        }
        if (completion.dataLossOccurred) throw new Error('Chromium reported trace data loss');
        return { complete: true, bytes, sha256: hash.digest('hex'), dataLossOccurred: false };
      } catch (error) {
        return {
          complete: false,
          bytes,
          dataLossOccurred: completion?.dataLossOccurred ?? null,
          error: String(error),
          partialSha256: hash.digest('hex'),
        };
      } finally {
        cdp.off('Tracing.tracingComplete', finish);
        await file?.close();
        if (handle) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            cdp.send('IO.close', { handle }).catch(() => {}),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 2000);
            }),
          ]);
          clearTimeout(timer);
        }
      }
    })());
}
