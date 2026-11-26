export const bootstrapPhases = [
  'bootstrap-ready',
  'worker-selection-start',
  'worker-selection-settled',
  'worker-selection-fallback',
  'worker-selection-skipped',
  'application-import-start',
  'application-import-end',
  'styles-start',
  'styles-end',
  'application-start-returned',
  'boot-rejected',
] as const;
export type BootstrapPhase = (typeof bootstrapPhases)[number];
export type BootstrapSnapshot = {
  events: Array<{ phase: BootstrapPhase; at: number }>;
  dropped: number;
  invalidClock: boolean;
  failed: boolean;
  sealed: boolean;
};

/** Public phase names/timing only. No runtime, URL, account, content or error text. */
export function createBootstrapJournal(now: () => number) {
  const start = now();
  const state: BootstrapSnapshot = {
    events: [],
    dropped: 0,
    invalidClock: false,
    failed: false,
    sealed: false,
  };
  return {
    mark(phase: BootstrapPhase) {
      if (state.sealed) return;
      if (phase === 'boot-rejected') state.failed = true;
      const at = now() - start;
      if (!Number.isFinite(at) || at < (state.events.at(-1)?.at ?? 0)) {
        state.invalidClock = true;
        return;
      }
      if (state.events.length === 32) {
        state.dropped++;
        return;
      }
      state.events.push({ phase, at });
    },
    seal() {
      state.sealed = true;
    },
    read(): BootstrapSnapshot {
      return { ...state, events: state.events.map((event) => ({ ...event })) };
    },
  };
}
