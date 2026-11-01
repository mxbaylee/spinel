import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { DiagnosticsStatus } from '../../shared/diagnostics.ts';
import { FEEDBACK_LIMITS } from '../../shared/feedback.ts';
import type { FeedbackPair, FeedbackPreparation, FeedbackScope } from '../../shared/feedback.ts';
import { DiagnosticsError } from './errors.ts';

export interface FeedbackExportOwner {
  actorId: string;
  sessionHash: string;
}
interface Job {
  id: string;
  owner: FeedbackExportOwner;
  directory: string;
  controller: AbortController;
  finished: Promise<void>;
  cleanup?: Promise<void>;
  pair?: FeedbackPair;
  expiry?: NodeJS.Timeout;
  sending: boolean;
}

/** One bounded preparation/retained pair/transfer; no live SQLite lock while idle. */
export class FeedbackExports {
  private job?: Job;
  private readonly source: string;
  private readonly build: string;
  private readonly status: () => DiagnosticsStatus;
  private readonly now: () => number;
  constructor(source: string, build: string, status: () => DiagnosticsStatus, now: () => number) {
    this.source = source;
    this.build = build;
    this.status = status;
    this.now = now;
  }
  get busy() {
    return !!this.job && (!this.job.pair || this.job.sending);
  }
  async prepare(
    actorId: string,
    owner: FeedbackExportOwner,
    signal?: AbortSignal,
  ): Promise<FeedbackPreparation> {
    let state = this.status();
    if (!state.available || !state.generation)
      throw new DiagnosticsError(503, 'Diagnostics are unavailable.');
    if (signal?.aborted) throw new DiagnosticsError(503, 'Feedback preparation was cancelled.');
    const existing = this.job;
    if (
      existing &&
      (existing.controller.signal.aborted ||
        (existing.pair &&
          (this.now() >= existing.pair.expiresAt || state.generation !== existing.pair.generation)))
    )
      await this.dispose(existing);
    if (this.job) {
      // Recover a lost ready acknowledgement without allocating another pair or
      // silently moving its window. A different account/session has no such lease.
      if (
        this.job.pair &&
        !this.job.sending &&
        this.job.pair.actorId === actorId &&
        this.job.owner.actorId === owner.actorId &&
        this.job.owner.sessionHash === owner.sessionHash
      )
        return this.job.pair;
      throw new DiagnosticsError(
        409,
        'A feedback download is already prepared. Close it before preparing another.',
      );
    }
    // Expired-pair disposal awaited the worker. Recheck the shared admission
    // boundary before creating another directory, since a generic export may
    // have started during that await.
    state = this.status();
    if (!state.available || !state.generation)
      throw new DiagnosticsError(503, 'Diagnostics are unavailable.');
    if (state.exporting)
      throw new DiagnosticsError(409, 'A diagnostics download is already active.');
    if (signal?.aborted) throw new DiagnosticsError(503, 'Feedback preparation was cancelled.');
    const volume = statfsSync(dirname(this.source));
    if (volume.bavail * volume.bsize < FEEDBACK_LIMITS.stagingBytes + 256 * 1024 * 1024)
      throw new DiagnosticsError(
        503,
        'There is not enough space to prepare complete feedback downloads.',
      );
    const directory = mkdtempSync(join(dirname(this.source), '.diagnostics-feedback-'));
    chmodSync(directory, 0o700);
    let finish!: () => void;
    const job: Job = {
      id: randomUUID(),
      owner,
      directory,
      controller: new AbortController(),
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      sending: false,
    };
    this.job = job;
    const abort = () => job.controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let worker: Worker | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let diskCheck: NodeJS.Timeout | undefined;
    const startedAt = this.now();
    try {
      worker = new Worker(new URL('./feedback-export-worker.ts', import.meta.url), {
        workerData: {
          source: this.source,
          directory,
          id: job.id,
          actorId,
          generation: state.generation,
          createdAt: startedAt,
          build: this.build,
          dropped: state.dropped,
        },
        resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 },
      });
      let result: FeedbackPreparation | undefined;
      let failed = false;
      const terminate = () => {
        void worker!.terminate();
      };
      job.controller.signal.addEventListener('abort', terminate, { once: true });
      timeout = setTimeout(abort, FEEDBACK_LIMITS.operationTimeoutMs);
      timeout.unref();
      diskCheck = setInterval(() => {
        try {
          const current = statfsSync(dirname(this.source));
          if (current.bavail * current.bsize < 256 * 1024 * 1024) abort();
        } catch {
          abort();
        }
      }, 250);
      diskCheck.unref();
      try {
        await new Promise<void>((resolve, reject) => {
          worker!.on('message', (value: FeedbackPreparation) => {
            result = value;
          });
          worker!.once('error', () => {
            failed = true;
          });
          worker!.once('exit', (code) => {
            if (code === 0 && !failed && !job.controller.signal.aborted && result) resolve();
            else reject(new Error('Feedback preparation unavailable.'));
          });
          if (job.controller.signal.aborted) terminate();
        });
      } finally {
        job.controller.signal.removeEventListener('abort', terminate);
        finish();
      }
      if (job.controller.signal.aborted || this.status().generation !== state.generation)
        throw new DiagnosticsError(410, 'Diagnostics changed. Prepare both downloads again.');
      if (result!.state === 'empty') {
        await this.dispose(job);
        return result!;
      }
      job.pair = result as FeedbackPair;
      if (this.now() >= job.pair.expiresAt)
        throw new DiagnosticsError(410, 'Feedback downloads expired. Prepare both again.');
      job.expiry = setTimeout(
        () => {
          void this.dispose(job).catch(() => {
            /* Keep the cancelled lease occupied for cleanup retry. */
          });
        },
        Math.max(1, job.pair.expiresAt - this.now()),
      );
      job.expiry.unref();
      return job.pair;
    } catch (error) {
      // Worker construction can fail before its exit handler exists.
      if (!worker) finish();
      await this.dispose(job);
      if (error instanceof DiagnosticsError) throw error;
      throw new DiagnosticsError(
        503,
        'Complete feedback downloads could not be prepared. Try again.',
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      if (diskCheck) clearInterval(diskCheck);
      signal?.removeEventListener('abort', abort);
    }
  }
  private owned(id: string, owner: FeedbackExportOwner) {
    const job = this.job;
    if (!job || job.id !== id)
      throw new DiagnosticsError(
        410,
        'Feedback downloads expired or were cleared. Prepare both again.',
      );
    if (job.owner.actorId !== owner.actorId || job.owner.sessionHash !== owner.sessionHash)
      throw new DiagnosticsError(404, 'Not found.');
    if (
      !job.pair ||
      job.controller.signal.aborted ||
      this.now() >= job.pair.expiresAt ||
      this.status().generation !== job.pair.generation
    ) {
      void this.dispose(job).catch(() => {
        /* Keep the cancelled lease occupied for cleanup retry. */
      });
      throw new DiagnosticsError(
        410,
        'Feedback downloads expired or were cleared. Prepare both again.',
      );
    }
    return job;
  }
  download(id: string, owner: FeedbackExportOwner, scope: FeedbackScope) {
    const job = this.owned(id, owner);
    if (job.sending)
      throw new DiagnosticsError(409, 'A feedback download is active. Wait for it to finish.');
    job.sending = true;
    return {
      path: join(job.directory, `${scope}.sqlite`),
      signal: job.controller.signal,
      generation: job.pair!.generation,
      expiresAt: job.pair!.expiresAt,
      finish: async (cancelled: boolean) => {
        job.sending = false;
        if (cancelled) await this.dispose(job);
      },
    };
  }
  async cancel(id: string, owner: FeedbackExportOwner) {
    const job = this.job;
    if (!job || job.id !== id) return;
    if (job.owner.actorId !== owner.actorId || job.owner.sessionHash !== owner.sessionHash)
      throw new DiagnosticsError(404, 'Not found.');
    await this.dispose(job);
  }
  /** Successful explicit truncate invalidates preparation, retained files and transfer. */
  invalidate() {
    if (this.job)
      void this.dispose(this.job).catch(() => {
        /* A cancelled lease cannot be downloaded or replaced. */
      });
  }
  async close() {
    if (this.job) await this.dispose(this.job);
  }
  private dispose(job: Job): Promise<void> {
    if (job.cleanup) return job.cleanup;
    job.controller.abort();
    if (job.expiry) clearTimeout(job.expiry);
    job.cleanup = (async () => {
      await job.finished;
      try {
        rmSync(job.directory, { recursive: true, force: true });
      } catch {
        // Do not admit more staging space or silently leave an orphaned pair.
        // Explicit cancel/close can retry; startup also removes interrupted pairs.
        job.cleanup = undefined;
        throw new DiagnosticsError(
          503,
          'Temporary feedback downloads could not be removed. Try closing them again.',
        );
      }
      if (this.job === job) this.job = undefined;
    })();
    return job.cleanup;
  }
}
