import { randomUUID } from 'node:crypto';
import type { HealthJob, HealthJobName } from '../../shared/health.ts';

export interface JobObservation {
  job: HealthJobName;
  runId: string;
  success: boolean;
  durationMs: number;
}

export type ObserveJob = () => (success: boolean) => void;

/** Optional observers must never change the job's outcome, even if an adapter fails. */
export function observeJob(start?: ObserveJob) {
  let finish: ((success: boolean) => void) | undefined;
  try {
    finish = start?.();
  } catch {
    /* best effort */
  }
  return (success: boolean) => {
    try {
      finish?.(success);
    } catch {
      /* best effort */
    }
  };
}

/** Observes existing jobs without changing their retry, error or commit semantics. */
export class HealthJobs {
  private readonly states = new Map<HealthJobName, HealthJob>();
  private readonly active = new Map<HealthJobName, Set<string>>();
  private readonly now: () => number;
  private readonly observe?: (event: JobObservation) => void;
  constructor(options: { now?: () => number; observe?: (event: JobObservation) => void } = {}) {
    this.now = options.now ?? Date.now;
    this.observe = options.observe;
    for (const name of [
      'history-maintenance',
      'trash-expiry',
      'collaboration-purge',
      'space-trash-expiry',
    ] as const)
      this.states.set(name, {
        name,
        configured: false,
        running: false,
        lastAttempt: null,
        lastSuccess: null,
        failedSince: null,
      });
  }
  configure(name: HealthJobName) {
    this.states.get(name)!.configured = true;
  }
  begin(name: HealthJobName) {
    const state = this.states.get(name)!;
    const runId = randomUUID();
    const started = this.now();
    this.configure(name);
    state.lastAttempt = started;
    state.running = true;
    const active = this.active.get(name) ?? new Set<string>();
    active.add(runId);
    this.active.set(name, active);
    let finished = false;
    return (success: boolean) => {
      if (finished) return;
      finished = true;
      active.delete(runId);
      state.running = active.size > 0;
      const ended = this.now();
      if (success) {
        state.lastSuccess = ended;
        state.failedSince = null;
      } else state.failedSince ??= ended;
      // A diagnostics adapter failure cannot fail the operation being measured.
      try {
        this.observe?.({ job: name, runId, success, durationMs: Math.max(0, ended - started) });
      } catch {
        /* best effort */
      }
    };
  }
  snapshot() {
    return [...this.states.values()].map((state) => ({ ...state }));
  }
}
