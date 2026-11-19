import type { BrowserContext } from '@playwright/test';

// 🎲 SPN-167: a replacement worker that installed but never activates is held by
// an unfinished extendable event in the old worker. A page cannot see those, so the
// test installs this observer inside the old worker and reads it when the wait fails.
// Test-owned and observe-only: it wraps `waitUntil` and `respondWith` to follow each
// promise, never changes it and never throws into the worker. Content-free: only the
// event type, a fixed allowlist of request types, a path with id-like segments collapsed and an age.

export type InflightEvent = { type: string; detail: string | null; ageMs: number };

type Scope = {
  ExtendableEvent?: { prototype: { waitUntil: (promise: Promise<unknown>) => void } };
  FetchEvent?: { prototype: { respondWith: (response: unknown) => void } };
  __spn167Inflight?: Map<number, { type: string; detail: string | null; started: number }>;
};

/** Runs inside the service worker, so it must stay self-contained. */
export function installInflightTracker(scope: Scope = globalThis as unknown as Scope): void {
  if (scope.__spn167Inflight) return;
  const open = new Map<number, { type: string; detail: string | null; started: number }>();
  scope.__spn167Inflight = open;
  let next = 0;
  const requestTypes = ['bootstrap', 'claim', 'admit', 'prepare', 'readiness', 'release'];
  const describe = (event: unknown): string | null => {
    try {
      const value = event as {
        data?: { type?: unknown; request?: { type?: unknown } };
        request?: { url: string; mode: string };
      };
      if (value.request) {
        // Any segment with a digit or 16+ characters may be an id or a file name.
        const path = new URL(value.request.url).pathname
          .split('/')
          .map((part) => (/\d/.test(part) || part.length >= 16 ? '<id>' : part))
          .join('/');
        return `${value.request.mode} ${path}`.slice(0, 120);
      }
      const requestType = value.data?.request?.type;
      if (typeof requestType === 'string' && requestTypes.includes(requestType)) return requestType;
      return typeof value.data?.type === 'string' ? 'legacy-message' : null;
    } catch {
      return null;
    }
  };
  const follow = (event: { type: string }, value: unknown) => {
    const id = next++;
    open.set(id, { type: event.type, detail: describe(event), started: Date.now() });
    const done = () => void open.delete(id);
    Promise.resolve(value).then(done, done);
  };
  const extendable = scope.ExtendableEvent?.prototype;
  if (extendable) {
    const original = extendable.waitUntil;
    extendable.waitUntil = function (this: { type: string }, promise: Promise<unknown>) {
      try {
        follow(this, promise);
      } catch {
        // Observing must never change the worker.
      }
      return original.call(this, promise);
    };
  }
  const fetching = scope.FetchEvent?.prototype;
  if (fetching) {
    const original = fetching.respondWith;
    fetching.respondWith = function (this: { type: string }, response: unknown) {
      try {
        follow(this, response);
      } catch {
        // Observing must never change the worker.
      }
      return original.call(this, response);
    };
  }
}

/** Runs inside the service worker: events still unfinished, oldest first. */
export function readInflight(
  scope: Scope = globalThis as unknown as Scope,
): InflightEvent[] | string {
  const open = scope.__spn167Inflight;
  if (!open) return 'not tracking';
  return [...open.values()]
    .sort((a, b) => a.started - b.started)
    .slice(0, 20)
    .map(({ type, detail, started }) => ({ type, detail, ageMs: Date.now() - started }));
}

/** Waits for `work` for at most 2 s, then gives `fallback`; the timer never outlives the call. */
async function within<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function trackOldWorkers(context: BrowserContext): Promise<void> {
  // Bounded like the report: a wedged worker must not stall the test.
  await Promise.all(
    context.serviceWorkers().map((worker) =>
      within(
        worker.evaluate(installInflightTracker as () => void).catch(() => undefined),
        undefined,
      ),
    ),
  );
}

/** A bounded, best-effort report for a failure message; never throws. */
export async function inflightReport(context: BrowserContext): Promise<string> {
  const reports = await Promise.all(
    context.serviceWorkers().map((worker) =>
      within<InflightEvent[] | string>(
        worker.evaluate(readInflight as () => InflightEvent[] | string).catch(() => 'unavailable'),
        'timed out',
      ),
    ),
  );
  return JSON.stringify(reports.length ? reports : 'no worker');
}
