import { monitorEventLoopDelay } from 'node:perf_hooks';
import { observe } from '@spinel/diagnostics';
import type { DiagnosticSink } from '@spinel/diagnostics';

interface DelayHistogram {
  readonly mean: number;
  readonly max: number;
  enable(): unknown;
  disable(): unknown;
  reset(): void;
}
interface RuntimeSources {
  now?: () => number;
  cpu?: () => { user: number; system: number };
  delay?: () => DelayHistogram;
}

/** One bounded histogram and two cumulative readings, sampled with existing health work. */
export class RuntimeDiagnostics {
  private readonly now: () => number;
  private readonly cpu: () => { user: number; system: number };
  private delay?: DelayHistogram;
  private previous?: { at: number; cpu: number };
  private closed = false;

  constructor(sources: RuntimeSources = {}) {
    this.now = sources.now ?? (() => performance.now());
    this.cpu = sources.cpu ?? (() => process.cpuUsage());
    try {
      this.delay = sources.delay?.() ?? monitorEventLoopDelay({ resolution: 20 });
      this.previous = this.read();
      this.delay.enable();
    } catch {
      // A sampling facility must never become a server startup requirement.
      this.close();
    }
  }

  private read() {
    const { user, system } = this.cpu();
    return { at: this.now(), cpu: (user + system) / 1000 };
  }

  sample(sink: DiagnosticSink | undefined) {
    if (this.closed || !this.previous || !this.delay) return;
    try {
      const next = this.read();
      const windowMs = next.at - this.previous.at;
      // The startup health sample is too close to initialization to be useful.
      if (windowMs < 1000) return;
      const cpuMs = next.cpu - this.previous.cpu;
      const mean = this.delay.mean / 1_000_000;
      const max = this.delay.max / 1_000_000;
      this.previous = next;
      this.delay.reset();
      if (Number.isFinite(windowMs) && Number.isFinite(cpuMs) && cpuMs >= 0)
        observe(
          sink,
          {
            name: 'runtime.cpu',
            metric: { kind: 'gauge', unit: 'milliseconds', value: cpuMs },
            details: { windowMs },
          },
          { component: 'health' },
        );
      for (const [statistic, value] of [
        ['mean', mean],
        ['max', max],
      ] as const)
        if (Number.isFinite(windowMs) && Number.isFinite(value) && value >= 0)
          observe(
            sink,
            {
              name: 'runtime.event-loop',
              metric: { kind: 'gauge', unit: 'milliseconds', value },
              details: { statistic, windowMs },
            },
            { component: 'health' },
          );
    } catch {
      // Keep all sampling, reset and observer failures out of health/maintenance authority.
    }
  }

  close() {
    this.closed = true;
    this.previous = undefined;
    try {
      this.delay?.disable();
    } catch {
      /* Diagnostic teardown cannot prevent application shutdown. */
    }
  }
}
