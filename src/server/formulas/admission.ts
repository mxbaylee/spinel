import { AuthError } from '../auth/store.ts';

export const FORMULA_QUEUE_WAIT_MS = 12_000;
export class FormulaQueueTimeout extends AuthError {
  constructor() {
    // Unlike overflow, expiration must not enter the client's automatic busy retry loop.
    super(503, 'Calculation timed out while waiting. Try again.');
  }
}

type Waiter = { promote: () => void; cancel: (error: unknown) => void };

/** One materialization/calculation, two bounded inputs, shared by every Formula router. */
export class FormulaAdmission {
  private active = false;
  private readonly waiting: Waiter[] = [];

  acquire(verify: () => void, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    verify();
    if (!this.active) {
      this.active = true;
      return Promise.resolve(this.release());
    }
    if (this.waiting.length >= 2)
      throw new AuthError(429, 'Another formula is loading. Try again shortly.');
    const deadline = performance.now() + FORMULA_QUEUE_WAIT_MS;
    return new Promise((resolve, reject) => {
      const remove = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const index = this.waiting.indexOf(waiter);
        if (index !== -1) this.waiting.splice(index, 1);
      };
      const waiter: Waiter = {
        promote: () => {
          remove();
          try {
            signal?.throwIfAborted();
            // Promise continuations can run before an overdue timer after an event-loop stall.
            if (performance.now() >= deadline) throw new FormulaQueueTimeout();
            verify();
            resolve(this.release());
          } catch (error) {
            reject(error);
            this.advance();
          }
        },
        cancel: (error) => {
          remove();
          reject(error);
        },
      };
      const abort = () =>
        waiter.cancel(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
      const timer = setTimeout(
        () => waiter.cancel(new FormulaQueueTimeout()),
        FORMULA_QUEUE_WAIT_MS,
      );
      this.waiting.push(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.advance();
    };
  }
  private advance() {
    // Keep the active reservation while promoting; even reentrant callers cannot overtake FIFO.
    const next = this.waiting.shift();
    if (next) next.promote();
    else this.active = false;
  }
}
export const formulaAdmission = new FormulaAdmission();
