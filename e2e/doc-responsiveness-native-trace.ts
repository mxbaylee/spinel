import type { CDPSession } from '@playwright/test';
import {
  DOC_CALLBACK_TRACE_SETTINGS,
  retainDocCallbackTrace,
} from './doc-responsiveness-callback-trace.ts';
import { persistCallbackManifest } from './doc-responsiveness-callback-progress.ts';
import type { callbackProgress } from './doc-responsiveness-callback-progress.ts';

export const NATIVE_DIAGNOSTIC_TRACE = {
  ...DOC_CALLBACK_TRACE_SETTINGS,
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
};

/** Reuse the callback collector's late-handle and pending-operation ownership. */
export async function startNativeDiagnosticTrace(
  cdp: CDPSession,
  path: string,
  progress: ReturnType<typeof callbackProgress>,
  ownership: { signal: AbortSignal; interrupt: () => Promise<void> },
) {
  const categories = await cdp.send('Tracing.getCategories');
  await cdp.send('Tracing.start', NATIVE_DIAGNOSTIC_TRACE);
  let pending: Promise<Record<string, unknown>> | undefined;
  return {
    finish() {
      return (pending ??= (async () => {
        const began = performance.now(),
          controller = new AbortController();
        const maxBytes = 64 * 1024 * 1024,
          timeoutMs = 30_000;
        const signal = AbortSignal.any([ownership.signal, controller.signal]);
        const timer = setTimeout(
          () => controller.abort(new Error('Native diagnostic trace exceeded 30 seconds.')),
          timeoutMs,
        );
        let failure: unknown,
          transport: Awaited<ReturnType<typeof retainDocCallbackTrace>> | undefined;
        try {
          transport = await retainDocCallbackTrace(cdp, path, progress, {
            signal,
            interrupt: ownership.interrupt,
            maxBytes,
          });
        } catch (error) {
          failure = error;
        } finally {
          clearTimeout(timer);
        }
        const receipt: Record<string, unknown> = {
          diagnosticOnly: true,
          validation:
            'Lossless protobuf transport only; trace parsing, clock alignment and attribution remain pending.',
          settings: NATIVE_DIAGNOSTIC_TRACE,
          categories,
          maxBytes,
          timeoutMs,
          transport: transport ?? null,
          elapsedMs: performance.now() - began,
          complete: !failure,
          failure: failure ? String(failure) : null,
        };
        failure = await persistCallbackManifest(path + '.receipt.json', receipt, failure);
        if (receipt.manifestPersistenceError) progress.failed('manifest-persistence');
        if (failure) throw failure;
        return receipt;
      })());
    },
  };
}
