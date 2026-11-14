import { Worker } from 'node:worker_threads';

/** Keep cancellation occupied until the worker has really stopped touching files. */
export async function snapshotDatabase(source: string, destination: string, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Diagnostics export cancelled.');
  const worker = new Worker(new URL('./snapshot-worker.ts', import.meta.url), {
    workerData: { source, destination },
    resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 },
  });
  let failure = false;
  let terminated: Promise<number> | undefined;
  const abort = () => {
    failure = true;
    terminated ??= worker.terminate();
  };
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 30_000);
  timeout.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('error', () => {
        failure = true;
      });
      worker.once('exit', (code) => {
        if (code === 0 && !failure && !signal.aborted) resolve();
        else reject(new Error('Diagnostics export unavailable.'));
      });
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    if (terminated) await terminated;
  }
}
