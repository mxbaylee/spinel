import { PassThrough, Readable, Writable } from 'node:stream';
import { expect, test, vi } from 'vitest';
import { FEEDBACK_LIMITS } from '../../shared/feedback.ts';
import { transferFeedback } from './feedback-transfer.ts';

test('the transfer deadline aborts a stalled destination after source EOF and destroys the entire pipeline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const final = Promise.withResolvers<void>();
  const source = Readable.from([Buffer.from('SQLite fixture bytes')]);
  const destination = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final() {
      final.resolve(); /* A slow receiver never completes its final flush. */
    },
  });
  const controller = new AbortController();
  const authorize = vi.fn();
  try {
    const transfer = transferFeedback(source, destination, controller.signal, authorize);
    // Install rejection handling before advancing the deadline.
    const failure = expect(transfer).rejects.toMatchObject({ name: 'AbortError' });
    await final.promise;
    expect(source.readableEnded).toBe(true);
    expect(destination.writableFinished).toBe(false);
    expect(authorize).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FEEDBACK_LIMITS.operationTimeoutMs);
    await failure;
    expect(destination.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    controller.abort();
    source.destroy();
    destination.destroy();
    vi.useRealTimers();
  }
});

test('every transmitted chunk rechecks authorization and no next chunk crosses a revoked boundary', async () => {
  const source = new PassThrough();
  const received: string[] = [];
  const first = Promise.withResolvers<void>();
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      received.push(String(chunk));
      first.resolve();
      callback();
    },
  });
  let allowed = true;
  const controller = new AbortController();
  const transfer = transferFeedback(source, destination, controller.signal, () => {
    if (!allowed) throw new Error('Session revoked.');
  });
  const failed = expect(transfer).rejects.toThrow('Session revoked');
  source.write('authorized');
  await first.promise;
  allowed = false;
  source.end('forbidden');
  await failed;
  expect(received).toEqual(['authorized']);
  expect(destination.destroyed).toBe(true);
});

test('truncation or cancellation aborts a live transfer even before the next source chunk', async () => {
  const source = new PassThrough();
  const destination = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const controller = new AbortController();
  const transfer = transferFeedback(source, destination, controller.signal, () => {});
  const failed = expect(transfer).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await failed;
  expect(source.destroyed).toBe(true);
  expect(destination.destroyed).toBe(true);
});
