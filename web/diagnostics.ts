import {
  exactKeys,
  isDiagnosticRecord,
  isObject,
  isUuid,
  MAX_BATCH_BYTES,
  MAX_BATCH_EVENTS,
  MAX_EVENT_BYTES,
} from '@spinel/diagnostics';
import type { DiagnosticRecord, DiagnosticSink } from '@spinel/diagnostics';

/** One authenticated account lifecycle. No guest adapter and no persistent queue. */
export class BrowserDiagnostics {
  private generation: string | null = null;
  private binding: string | null = null;
  private readonly accountId: string;
  private queue: DiagnosticRecord[] = [];
  private queuedBytes = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private epoch = 0;
  private flight?: { count: number; settled: boolean };
  private readonly request: typeof fetch;
  private readonly now: () => number;
  dropped = 0;
  constructor(options: { accountId: string; fetch?: typeof fetch; now?: () => number }) {
    this.accountId = options.accountId;
    this.request = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  /** Call on authenticated entry/reconnect. Events before this completes are dropped. */
  async start() {
    if (this.closed) return;
    this.suspend();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.request('/api/diagnostics/collection', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Spinel-Diagnostic-Account': this.accountId },
        signal: controller.signal,
      });
      if (this.epoch !== epoch || this.closed || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        this.stop();
        return;
      }
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (this.epoch !== epoch || this.closed || controller.signal.aborted) return;
      if (
        isObject(body) &&
        exactKeys(body, ['generation', 'binding']) &&
        isUuid(body.generation) &&
        typeof body.binding === 'string' &&
        /^[a-f0-9]{64}$/.test(body.binding)
      ) {
        this.generation = body.generation;
        this.binding = body.binding;
      }
    } catch {
      /* Reconnection is explicit; diagnostics never retries edit traffic. */
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  /** Capture at operation start: never reassign a late observation to a new collection. */
  capture(): DiagnosticSink | undefined {
    if (this.closed || !this.generation || !this.binding) return;
    const epoch = this.epoch, generation = this.generation, binding = this.binding;
    return (event, context) => {
      if (this.closed || this.epoch !== epoch || this.generation !== generation || this.binding !== binding) {
        this.drop();
        return;
      }
      this.emit(event, context);
    };
  }

  readonly emit: DiagnosticSink = (event, context) => {
    try {
      if (this.closed || !this.generation) {
        this.drop();
        return;
      }
      const record = { id: crypto.randomUUID(), occurredAt: this.now(), event, context };
      if (!isDiagnosticRecord(record)) {
        this.drop();
        return;
      }
      const encoded = JSON.stringify(record);
      const bytes = new TextEncoder().encode(encoded).length;
      if (
        bytes > MAX_EVENT_BYTES ||
        this.queue.length >= 256 ||
        this.queuedBytes + bytes > 1024 * 1024
      ) {
        this.drop();
        return;
      }
      this.queue.push(JSON.parse(encoded) as DiagnosticRecord);
      this.queuedBytes += bytes;
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 2000);
    } catch {
      this.drop();
    }
  };

  private drop(count = 1) {
    this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + count);
  }
  private settle(flight: { count: number; settled: boolean }, lost = flight.count) {
    if (flight.settled) return;
    flight.settled = true;
    this.drop(lost);
    if (this.flight === flight) this.flight = undefined;
  }

  async flush() {
    if (this.closed || this.controller || !this.generation || !this.binding || !this.queue.length)
      return;
    const generation = this.generation;
    const binding = this.binding;
    const epoch = this.epoch;
    const records: DiagnosticRecord[] = [];
    while (this.queue.length && records.length < MAX_BATCH_EVENTS) {
      const next = this.queue[0];
      if (
        new TextEncoder().encode(
          JSON.stringify({ generation, binding, records: [...records, next] }),
        ).length > MAX_BATCH_BYTES
      )
        break;
      records.push(this.queue.shift()!);
      this.queuedBytes -= new TextEncoder().encode(JSON.stringify(next)).length;
    }
    const controller = new AbortController();
    const flight = { count: records.length, settled: false };
    this.flight = flight;
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.request('/api/diagnostics/events', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Spinel-Diagnostic-Account': this.accountId,
        },
        body: JSON.stringify({ generation, binding, records }),
        signal: controller.signal,
      });
      if (this.epoch !== epoch || this.closed || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        this.settle(flight);
        this.stop();
        return;
      }
      if (response.status === 409) {
        this.settle(flight);
        // The old queue is discarded, never relabelled with the new generation.
        await this.start();
        return;
      }
      if (!response.ok) {
        this.settle(flight);
        this.suspend();
        return;
      }
      const body: unknown = await response.json();
      if (this.epoch !== epoch || this.closed || controller.signal.aborted) return;
      if (
        isObject(body) &&
        exactKeys(body, ['accepted', 'dropped']) &&
        typeof body.accepted === 'number' &&
        Number.isSafeInteger(body.accepted) &&
        body.accepted >= 0 &&
        typeof body.dropped === 'number' &&
        Number.isSafeInteger(body.dropped) &&
        body.dropped >= 0 &&
        body.accepted + body.dropped === records.length
      )
        this.settle(flight, body.dropped);
      else this.settle(flight);
    } catch {
      if (this.epoch === epoch) {
        this.settle(flight);
        this.suspend();
      }
    } finally {
      clearTimeout(timeout);
      this.settle(flight);
      if (this.controller === controller) this.controller = undefined;
      if (!this.closed && this.generation && this.queue.length)
        this.timer ??= setTimeout(() => {
          this.timer = undefined;
          void this.flush();
        }, 2000);
    }
  }

  /** Offline, hidden tab or account transition: discard, abort, then explicitly restart. */
  suspend() {
    this.epoch++;
    this.generation = null;
    this.binding = null;
    if (this.flight) this.settle(this.flight);
    this.drop(this.queue.length);
    this.queue = [];
    this.queuedBytes = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
  }
  stop() {
    this.closed = true;
    this.suspend();
  }
}
