import type { DiagnosticSink } from '@spinel/diagnostics';
import { BrowserDiagnostics } from './diagnostics.ts';
import type { ConnectionState } from './connectionState.ts';

export type DiagnosticOperation = { runId: string; sink: DiagnosticSink };

/** Editor state is only a retry hint; its offline view is not proof of an HTTP outage. */
export function diagnosticsConnectionPolicy(browserOnline: boolean, state: ConnectionState) {
  return { available: browserOnline, onlineHint: state === 'online' };
}

/** One tab's verified account lifetime; never a global telemetry singleton. */
export class AccountDiagnostics {
  private owner: string | null = null;
  private client?: BrowserDiagnostics;
  private available = false;
  private stopped = false;
  private readonly create: (accountId: string) => BrowserDiagnostics;
  constructor(create = (accountId: string) => new BrowserDiagnostics({ accountId })) {
    this.create = create;
  }
  account(id: string | null) {
    if (id === this.owner) return;
    this.client?.stop();
    this.owner = id;
    this.client = id ? this.create(id) : undefined;
    this.available = false;
    this.stopped = false;
  }
  connection(available: boolean) {
    if (!this.client || this.stopped) return;
    if (available) {
      this.available = true;
      void this.client.resume();
      return;
    }
    if (!this.available) return;
    this.available = available;
    this.client.suspend();
  }
  /** The run ID and sink share one initiating account/collection lifetime. */
  begin(): DiagnosticOperation | undefined {
    try {
      if (!this.available || this.stopped) return;
      const sink = this.client?.capture();
      return sink ? { runId: crypto.randomUUID(), sink } : undefined;
    } catch {
      return undefined;
    }
  }
  stop() {
    this.stopped = true;
    this.available = false;
    this.client?.stop();
  }
}
