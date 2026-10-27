import type { OfflineRecoveryState } from './offlineRecovery.ts';

export interface SaveRequest {
  snapshot: unknown;
  revision: number;
  writeId: string;
}
export interface SaveState {
  dirty: boolean;
  message: string;
  failed: boolean;
  /** Explicit durability meanings for opted-in downloaded documents. */
  local?: 'saving' | 'saved' | 'synced' | 'attention' | 'failed';
  /** Downloaded work keeps an unavailable page mounted without a dirty warning. */
  retained?: boolean;
  /** Retained work can continue to sign-in once local saving and host input finish. */
  signInRequired?: boolean;
  recovery?: OfflineRecoveryState;
}
export class SaveFailure extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// One outstanding snapshot at a time. Retry its exact ID/payload before sending
// newer edits, so a lost response cannot cause a duplicate save or silent overwrite.
export class Autosave {
  revision: number;
  latest: string;
  saved: string;
  pending?: { text: string; request: SaveRequest };
  timer?: ReturnType<typeof setTimeout>;
  sending = false;
  disposed = false;
  blocked = false;
  rejected = false;
  send: (request: SaveRequest) => Promise<{ revision: number }>;
  state: (state: SaveState) => void;
  constructor(
    revision: number,
    snapshot: unknown,
    send: Autosave['send'],
    state: Autosave['state'],
  ) {
    this.revision = revision;
    this.latest = this.saved = JSON.stringify(snapshot);
    this.send = send;
    this.state = state;
  }
  get dirty() {
    return this.latest !== this.saved || Boolean(this.pending);
  }
  changed(snapshot: unknown) {
    this.latest = JSON.stringify(snapshot);
    this.acceptCorrection();
    if (this.blocked) return;
    this.state({
      dirty: this.dirty,
      message: this.dirty ? 'Changes not saved yet.' : 'All changes saved.',
      failed: false,
    });
    this.schedule(500);
  }
  schedule(delay: number) {
    clearTimeout(this.timer);
    if (!this.disposed && !this.blocked) this.timer = setTimeout(() => void this.flush(), delay);
  }
  retry() {
    this.blocked = false;
    void this.flush();
  }
  acceptCorrection() {
    // Only explicit validation/size rejection proves the pending write never committed.
    // A corrected snapshot may replace it; uncertain responses must replay exactly.
    if (this.rejected && this.pending && this.latest !== this.pending.text) {
      this.pending = undefined;
      this.blocked = false;
      this.rejected = false;
    }
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.sending || this.disposed || this.blocked || !this.dirty) return;
    this.pending ??= {
      text: this.latest,
      request: {
        snapshot: JSON.parse(this.latest),
        revision: this.revision,
        writeId: crypto.randomUUID(),
      },
    };
    const pending = this.pending;
    this.sending = true;
    this.state({ dirty: true, message: 'Saving changes…', failed: false });
    try {
      const result = await this.send(pending.request);
      this.revision = result.revision;
      this.saved = pending.text;
      this.pending = undefined;
      this.rejected = false;
      if (!this.disposed) {
        this.state({
          dirty: this.dirty,
          message: this.dirty ? 'Changes not saved yet.' : 'All changes saved.',
          failed: false,
        });
        if (this.dirty) this.schedule(0);
      }
    } catch (error) {
      this.blocked = error instanceof SaveFailure && error.status >= 400 && error.status < 500;
      this.rejected = error instanceof SaveFailure && [400, 413].includes(error.status);
      this.acceptCorrection();
      if (!this.disposed) {
        if (!this.dirty) {
          this.state({ dirty: false, message: 'All changes saved.', failed: false });
          return;
        }
        this.state({
          dirty: true,
          message:
            error instanceof SaveFailure
              ? /not saved/i.test(error.message)
                ? error.message
                : `Changes are not saved. Keep this tab open. ${error.message}`
              : 'Changes are not saved. Keep this tab open; saving will retry when the connection returns.',
          failed: true,
        });
        this.schedule(3000);
      }
    } finally {
      this.sending = false;
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
