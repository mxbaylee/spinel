export interface SaveRequest {
  snapshot: unknown;
  revision: number;
  writeId: string;
}
export interface SaveState {
  dirty: boolean;
  message: string;
  failed: boolean;
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
      if (!this.disposed) {
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
