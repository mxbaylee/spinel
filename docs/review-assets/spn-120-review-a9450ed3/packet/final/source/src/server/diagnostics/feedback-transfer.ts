import { Transform } from 'node:stream';
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FEEDBACK_LIMITS } from '../../shared/feedback.ts';

/** The deadline covers the destination's final flush, not only reading the file. */
export async function transferFeedback(
  source: Readable,
  destination: Writable,
  signal: AbortSignal,
  authorize: () => void,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, FEEDBACK_LIMITS.operationTimeoutMs);
  timeout.unref();
  const authorized = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        authorize();
        callback(null, chunk);
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  try {
    await pipeline(source, authorized, destination, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    source.destroy();
  }
}
