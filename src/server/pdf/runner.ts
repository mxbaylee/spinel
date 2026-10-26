import { fork, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { DocPrintInput, SheetPrintInput } from '@spinel/print';
import {
  PDF_LIMITS,
  PDF_DEADLINE_MS,
  PDF_WORKER_RSS_BYTES,
  PDF_COMBINED_RSS_BYTES,
  PDF_MEMORY_SAMPLE_MS,
  PdfError,
} from './limits.ts';
import type { PdfErrorCode } from './limits.ts';
import { checkPdfCapacity, pdfMemory, pdfMemoryExceeded } from './capacity.ts';

type Fonts = 'fonts' | 'defaultFamily' | 'fallbackFamilies';
export type PdfJob =
  | { kind: 'sheet'; input: Omit<SheetPrintInput, Fonts>; worksheetIds?: string[] }
  | { kind: 'doc'; input: Omit<DocPrintInput, Fonts> };
export type PdfResult = {
  bytes: Buffer;
  pages: number;
  mediaBox: { width: number; height: number };
  durationMs: number;
  peakRssBytes: number;
};
export type PdfWorkerReply =
  | { type: 'complete'; byteLength: number } & Omit<PdfResult, 'bytes'>
  | { type: 'chunk'; bytes: Uint8Array }
  | { type: 'failure'; code: PdfErrorCode };

const exec = promisify(execFile);
let active = false;

function admitJob(job: PdfJob) {
  if (!job || !['doc', 'sheet'].includes(job.kind) || !job.input)
    throw new PdfError('unsupported');
  let nodes = 0;
  let bytes = 0;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number) => {
    if (++nodes > PDF_LIMITS.snapshotNodes || depth > 64) throw new PdfError('limit');
    if (typeof value === 'string') bytes += Buffer.byteLength(value);
    else if (value && typeof value === 'object') {
      if (seen.has(value)) throw new PdfError('unsupported');
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        bytes += Buffer.byteLength(key);
        visit(child, depth + 1);
      }
    }
    if (bytes > PDF_LIMITS.snapshotBytes) throw new PdfError('limit');
  };
  visit(job.input.snapshot, 0);
  if (job.kind === 'doc') visit(job.input.formulas, 0);
  if (
    Buffer.byteLength(JSON.stringify([job.input.snapshot, job.kind === 'doc' && job.input.formulas])) >
    PDF_LIMITS.snapshotBytes
  )
    throw new PdfError('limit');
  const images = job.input.images;
  if (!Array.isArray(images) || images.length > PDF_LIMITS.images) throw new PdfError('limit');
  let imageBytes = 0;
  for (const image of images) {
    if (
      !image ||
      !(image.bytes instanceof Uint8Array) ||
      typeof image.source !== 'string' ||
      image.source.length > 8192
    )
      throw new PdfError('unsupported');
    imageBytes += image.bytes.byteLength;
    if (imageBytes > PDF_LIMITS.encodedImageBytes) throw new PdfError('limit');
  }
  if (
    job.kind === 'sheet' &&
    job.worksheetIds !== undefined &&
    (!Array.isArray(job.worksheetIds) ||
      job.worksheetIds.length > PDF_LIMITS.worksheets ||
      job.worksheetIds.some((id) => typeof id !== 'string' || id.length > 512))
  )
    throw new PdfError('unsupported');
}

/** RSS includes native allocations; a V8 heap cap alone cannot bound Canvas/Skia. */
async function residentBytes(pid: number): Promise<number | null> {
  if (process.platform === 'linux') {
    let status: string;
    try {
      status = await readFile(`/proc/${pid}/status`, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    // A zombie may briefly have no RSS while its close event is still pending.
    if (!match && /^State:\s+Z/m.test(status)) return 0;
    if (!match) throw new Error('Worker memory unavailable.');
    return Number(match[1]) * 1024;
  }
  const { stdout } = await exec('ps', ['-o', 'rss=', '-p', String(pid)], {
    timeout: 1000,
    maxBuffer: 1024,
  });
  const rss = Number(stdout.trim()) * 1024;
  if (!Number.isFinite(rss) || rss <= 0) throw new Error('Worker memory unavailable.');
  return rss;
}

/**
 * One disposable process, no queue and no published bytes until it has closed.
 * The caller retains shared transfer/Formula admission through final authorization.
 */
export async function runPdf(job: PdfJob, signal?: AbortSignal): Promise<PdfResult> {
  if (signal?.aborted) throw new PdfError('cancelled');
  if (active) throw new PdfError('busy');
  if (process.memoryUsage().rss > PDF_COMBINED_RSS_BYTES - PDF_WORKER_RSS_BYTES)
    throw new PdfError('limit');
  active = true;
  try {
    admitJob(job);
    checkPdfCapacity();
    // Own all input before asynchronous IPC. Caller edits cannot change this render.
    const owned = structuredClone(job);
    const workerBudget = checkPdfCapacity();
    if (signal?.aborted) throw new PdfError('cancelled');
    return await new Promise<PdfResult>((resolve, reject) => {
      const worker = fork(new URL('./worker.ts', import.meta.url), [], {
        // Do not inherit sessions, database paths, tokens, NODE_OPTIONS or test loaders.
        env: { DISABLE_SYSTEM_FONTS_LOAD: '1', LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production' },
        execArgv: [
          `--max-old-space-size=${Math.min(256, Math.floor(workerBudget / (2 * 1024 * 1024)))}`,
          '--max-semi-space-size=16',
        ],
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const started = performance.now();
      const deadline = started + PDF_DEADLINE_MS;
      let failure: PdfError | undefined;
      let reply: Extract<PdfWorkerReply, { type: 'complete' }> | undefined;
      let outputBytes = 0;
      let peakRssBytes = 0;
      let sampling = false;
      let closed = false;
      const chunks: Buffer[] = [];
      const stop = (code: PdfErrorCode) => {
        failure ??= new PdfError(code);
        chunks.length = 0;
        // Native rendering need not yield to JavaScript. Kill, then await close.
        if (!closed) worker.kill('SIGKILL');
      };
      const abort = () => stop('cancelled');
      const timer = setTimeout(() => stop('limit'), PDF_DEADLINE_MS);
      const monitor = setInterval(() => {
        if (sampling || closed || failure || worker.pid === undefined) return;
        sampling = true;
        void residentBytes(worker.pid)
          .then((rss) => {
            if (closed || failure) return;
            peakRssBytes = Math.max(peakRssBytes, rss ?? 0);
            if (pdfMemoryExceeded(pdfMemory(), rss ?? 0, workerBudget))
              stop('limit');
          })
          .catch(() => {
            // Exit/close may be waiting behind this memory read's continuation.
            if (!closed && worker.exitCode === null && worker.signalCode === null) stop('failed');
          })
          .finally(() => {
            sampling = false;
          });
      }, PDF_MEMORY_SAMPLE_MS);
      worker.on('message', (value: unknown) => {
        if (failure || closed) return;
        if (!value || typeof value !== 'object') return stop('failed');
        const message = value as PdfWorkerReply;
        if (message.type === 'chunk') {
          if (!(message.bytes instanceof Uint8Array) || !message.bytes.byteLength || reply)
            return stop('failed');
          outputBytes += message.bytes.byteLength;
          if (message.bytes.byteLength > 64 * 1024 || outputBytes > PDF_LIMITS.outputBytes)
            return stop('limit');
          chunks.push(Buffer.from(message.bytes));
        } else if (message.type === 'failure') {
          const code = ['limit', 'cancelled', 'unsupported'].includes(message.code)
            ? message.code
            : 'failed';
          stop(code);
        } else if (message.type === 'complete' && !reply) reply = message;
        else stop('failed');
      });
      worker.once('error', () => stop('failed'));
      worker.once('close', (code) => {
        closed = true;
        clearTimeout(timer);
        clearInterval(monitor);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) failure ??= new PdfError('cancelled');
        if (performance.now() >= deadline) failure ??= new PdfError('limit');
        if (
          code !== 0 ||
          !reply ||
          reply.byteLength !== outputBytes ||
          !outputBytes ||
          !Number.isSafeInteger(reply.pages) ||
          reply.pages < 1 ||
          reply.pages > PDF_LIMITS.pages ||
          !reply.mediaBox ||
          ![reply.mediaBox.width, reply.mediaBox.height, reply.durationMs, reply.peakRssBytes].every(
            (value) => Number.isFinite(value) && value > 0,
          )
        )
          failure ??= new PdfError('failed');
        if (reply && reply.peakRssBytes > workerBudget)
          failure ??= new PdfError('limit');
        if (failure) {
          chunks.length = 0;
          reject(failure);
          return;
        }
        const bytes = Buffer.concat(chunks, outputBytes);
        if (bytes.subarray(0, 5).toString() !== '%PDF-') {
          reject(new PdfError('failed'));
          return;
        }
        resolve({
          bytes,
          pages: reply!.pages,
          mediaBox: reply!.mediaBox,
          durationMs: performance.now() - started,
          peakRssBytes: Math.max(peakRssBytes, reply!.peakRssBytes),
        });
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else {
        try {
          worker.send(owned, (error) => {
            if (error) stop('failed');
          });
        } catch {
          stop('failed');
        }
      }
    });
  } catch (error) {
    throw error instanceof PdfError ? error : new PdfError('failed');
  } finally {
    active = false;
  }
}
