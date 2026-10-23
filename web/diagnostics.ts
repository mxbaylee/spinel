import {
  exactKeys, isDiagnosticRecord, isObject, isUuid, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, MAX_EVENT_BYTES,
} from '@spinel/diagnostics';
import type { DiagnosticRecord, DiagnosticSink } from '@spinel/diagnostics';

/** One authenticated account lifecycle. No guest adapter and no persistent queue. */
export class BrowserDiagnostics {
  private generation: string | null = null;
  private queue: DiagnosticRecord[] = [];
  private queuedBytes = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private epoch = 0;
  private readonly request: typeof fetch;
  private readonly now: () => number;
  dropped = 0;
  constructor(options: { fetch?: typeof fetch; now?: () => number } = {}) {
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
      const response = await this.request('/api/diagnostics/collection', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (this.epoch !== epoch || this.closed || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { this.stop(); return; }
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (this.epoch !== epoch || this.closed || controller.signal.aborted) return;
      if (isObject(body) && exactKeys(body, ['generation']) && isUuid(body.generation)) this.generation = body.generation;
    } catch { /* Reconnection is explicit; diagnostics never retries edit traffic. */ }
    finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  readonly emit: DiagnosticSink = (event, context) => {
    try {
      if (this.closed || !this.generation) { this.drop(); return; }
      const record = { id: crypto.randomUUID(), occurredAt: this.now(), event, context };
      if (!isDiagnosticRecord(record)) { this.drop(); return; }
      const encoded = JSON.stringify(record);
      const bytes = new TextEncoder().encode(encoded).length;
      if (bytes > MAX_EVENT_BYTES || this.queue.length >= 256 || this.queuedBytes + bytes > 1024 * 1024) { this.drop(); return; }
      this.queue.push(JSON.parse(encoded) as DiagnosticRecord);
      this.queuedBytes += bytes;
      this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, 2000);
    } catch { this.drop(); }
  };

  private drop(count = 1) { this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + count); }

  async flush() {
    if (this.closed || this.controller || !this.generation || !this.queue.length) return;
    const generation = this.generation;
    const epoch = this.epoch;
    const records: DiagnosticRecord[] = [];
    while (this.queue.length && records.length < MAX_BATCH_EVENTS) {
      const next = this.queue[0];
      if (new TextEncoder().encode(JSON.stringify({ generation, records: [...records, next] })).length > MAX_BATCH_BYTES) break;
      records.push(this.queue.shift()!);
      this.queuedBytes -= new TextEncoder().encode(JSON.stringify(next)).length;
    }
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.request('/api/diagnostics/events', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generation, records }), signal: controller.signal,
      });
      if (this.epoch !== epoch || this.closed || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { this.drop(records.length); this.stop(); return; }
      if (response.status === 409) {
        this.drop(records.length);
        // The old queue is discarded, never relabelled with the new generation.
        await this.start();
        return;
      }
      if (!response.ok) { this.drop(records.length); this.suspend(); return; }
      const body: unknown = await response.json();
      if (this.epoch !== epoch || this.closed) return;
      if (isObject(body) && typeof body.dropped === 'number' && Number.isSafeInteger(body.dropped) && body.dropped >= 0 && body.dropped <= records.length) this.drop(body.dropped);
      else this.drop(records.length);
    } catch {
      if (this.epoch === epoch) { this.drop(records.length); this.suspend(); }
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = undefined;
      if (!this.closed && this.generation && this.queue.length) this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, 2000);
    }
  }

  /** Offline, hidden tab or account transition: discard, abort, then explicitly restart. */
  suspend() {
    this.epoch++;
    this.generation = null;
    this.drop(this.queue.length);
    this.queue = [];
    this.queuedBytes = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
  }
  stop() { this.closed = true; this.suspend(); }
}
