import type { DiagnosticSink } from '@spinel/diagnostics';
import { BrowserDiagnostics } from './diagnostics.ts';

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
    if (!this.client || this.stopped || available === this.available) return;
    this.available = available;
    if (available) void this.client.start();
    else this.client.suspend();
  }
  readonly emit: DiagnosticSink = (event, context) => {
    if (this.available && !this.stopped) this.client?.emit(event, context);
  };
  runId() {
    try {
      return this.available && !this.stopped ? crypto.randomUUID() : undefined;
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
