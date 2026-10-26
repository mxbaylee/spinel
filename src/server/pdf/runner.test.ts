import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PdfJob, PdfWorkerReply } from './runner.ts';
import { PDF_DEADLINE_MS, PDF_LIMITS, PDF_WORKER_RSS_BYTES } from './limits.ts';

const mocks = vi.hoisted(() => ({ fork: vi.fn(), memory: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  fork: mocks.fork,
}));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  readFile: mocks.memory,
}));
const { runPdf } = await import('./runner.ts');

class Child extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  pid: number | undefined = undefined;
  kill = vi.fn(() => true);
  send = vi.fn();
  close(code: number | null) {
    this.exitCode = code;
    this.emit('close', code, null);
  }
  complete(bytes = Buffer.from('%PDF-complete'), extra: Partial<PdfWorkerReply> = {}) {
    this.emit('message', { type: 'chunk', bytes });
    this.emit('message', {
      type: 'complete',
      byteLength: bytes.length,
      pages: 1,
      mediaBox: { width: 595, height: 842 },
      durationMs: 1,
      peakRssBytes: 100 * 1024 * 1024,
      ...extra,
    });
  }
}

const job = (): Extract<PdfJob, { kind: 'doc' }> => ({
  kind: 'doc',
  input: { snapshot: { id: 'one', documentStyle: {}, body: { dataStream: 'Private content\r\n' } }, images: [] },
});
let child: Child;
beforeEach(() => {
  child = new Child();
  mocks.fork.mockReset().mockReturnValue(child as unknown as ChildProcess);
  mocks.memory.mockReset().mockResolvedValue('State:\tR\nVmRSS:\t1024 kB\n');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

test('holds completed bytes and admission until the child closes successfully', async () => {
  const pending = runPdf(job());
  let settled = false;
  void pending.then(() => (settled = true));
  child.complete();
  await Promise.resolve();
  expect(settled).toBe(false);
  await expect(runPdf(job())).rejects.toMatchObject({ code: 'busy' });
  child.close(0);
  expect((await pending).bytes.toString()).toBe('%PDF-complete');
  const next = runPdf(job());
  child.complete();
  child.close(0);
  await expect(next).resolves.toMatchObject({ pages: 1 });
});

test('cancellation discards an already buffered PDF and retains admission until close', async () => {
  const controller = new AbortController();
  const pending = runPdf(job(), controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  child.complete();
  controller.abort();
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  await expect(runPdf(job())).rejects.toMatchObject({ code: 'busy' });
  child.close(0);
  await rejected;
  await expect(runPdf(job(), controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  expect(mocks.fork).toHaveBeenCalledTimes(1);
});

test('a hard deadline kills native work and does not free capacity before termination', async () => {
  const pending = runPdf(job());
  const rejected = expect(pending).rejects.toMatchObject({ code: 'limit' });
  await vi.advanceTimersByTimeAsync(PDF_DEADLINE_MS);
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  await expect(runPdf(job())).rejects.toMatchObject({ code: 'busy' });
  child.close(null);
  await rejected;
});

test('output caps and nonzero exits never return partial bytes', async () => {
  const pending = runPdf(job());
  const rejected = expect(pending).rejects.toMatchObject({ code: 'limit' });
  const chunk = Buffer.alloc(64 * 1024);
  for (let offset = 0; offset <= PDF_LIMITS.outputBytes; offset += chunk.length)
    child.emit('message', { type: 'chunk', bytes: chunk });
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  child.close(null);
  await rejected;
  const failed = runPdf(job());
  const failedRejection = expect(failed).rejects.toMatchObject({ code: 'failed' });
  child.complete();
  child.close(1);
  await failedRejection;
});

test('malformed worker output and a missing completion marker fail closed', async () => {
  const pending = runPdf(job());
  const rejected = expect(pending).rejects.toMatchObject({ code: 'failed' });
  child.complete(Buffer.from('not a PDF'));
  child.close(0);
  await rejected;
  const missing = runPdf(job());
  const missingRejection = expect(missing).rejects.toMatchObject({ code: 'failed' });
  child.emit('message', { type: 'chunk', bytes: Buffer.from('%PDF-partial') });
  child.close(0);
  await missingRejection;
});

test('worker errors never expose exception text, source data or process output', async () => {
  const pending = runPdf(job());
  const rejected = expect(pending).rejects.toMatchObject({
    code: 'failed',
    message: 'Could not create a complete PDF. Try again.',
  });
  child.emit('error', new Error('PRIVATE URL, account name and file data'));
  child.close(1);
  await rejected;
});

test('copies admitted input and gives workers no inherited secrets or loader flags', async () => {
  const input = job();
  const pending = runPdf(input);
  input.input.snapshot.id = 'changed-after-start';
  const sent = child.send.mock.calls[0][0] as PdfJob;
  expect(sent.input.snapshot.id).toBe('one');
  const options = mocks.fork.mock.calls[0][2];
  expect(options.env).toEqual({
    DISABLE_SYSTEM_FONTS_LOAD: '1',
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    NODE_ENV: 'production',
  });
  expect(options.execArgv).toEqual(['--max-old-space-size=256', '--max-semi-space-size=16']);
  expect(options.stdio).toEqual(['ignore', 'ignore', 'ignore', 'ipc']);
  child.complete();
  child.close(0);
  await pending;
});

test('rejects oversize input before spawning or copying it into the worker', async () => {
  const input = job();
  input.input.snapshot.body!.dataStream = 'x'.repeat(PDF_LIMITS.snapshotBytes + 1);
  await expect(runPdf(input)).rejects.toMatchObject({ code: 'limit' });
  expect(mocks.fork).not.toHaveBeenCalled();
});

test('a synchronous IPC failure still waits for process close', async () => {
  child.send.mockImplementation(() => {
    throw new Error('IPC closed');
  });
  const pending = runPdf(job());
  const rejected = expect(pending).rejects.toMatchObject({ code: 'failed' });
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  await expect(runPdf(job())).rejects.toMatchObject({ code: 'busy' });
  child.close(1);
  await rejected;
});

test('native RSS over budget kills work and retains its reservation until close', async () => {
  if (process.platform !== 'linux') return;
  child.pid = 42;
  mocks.memory.mockResolvedValue(`State:\tR\nVmRSS:\t${PDF_WORKER_RSS_BYTES / 1024 + 1} kB\n`);
  const pending = runPdf(job());
  const rejected = expect(pending).rejects.toMatchObject({ code: 'limit' });
  await vi.advanceTimersByTimeAsync(100);
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  await expect(runPdf(job())).rejects.toMatchObject({ code: 'busy' });
  child.close(1);
  await rejected;
});

test('an unsampled worker high-water mark above budget invalidates an otherwise complete PDF', async () => {
  const pending = runPdf(job());
  const rejected = expect(pending).rejects.toMatchObject({ code: 'limit' });
  child.complete(undefined, { peakRssBytes: PDF_WORKER_RSS_BYTES + 1 });
  child.close(0);
  await rejected;
});
