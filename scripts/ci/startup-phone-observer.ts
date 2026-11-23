// Imported only by startup-phone.config.ts's diagnostic build. Never production.
export const phoneEvents = [
  'page',
  'online',
  'offline',
  'visible',
  'hidden',
  'pagehide',
  'app code',
  'styles',
  'service worker',
  'account exit check',
  'sign-in lock',
  'sign-in check',
  'saved files',
  'done',
  'request-start',
  'headers',
  'body',
  'verified',
  'request-error',
  'request-settled',
  'account-claim',
  'runtime-start',
  'runtime-end',
  'device-claim-start',
  'device-claim-end',
  'account-published',
] as const;
export type PhoneEvent = (typeof phoneEvents)[number];
export type PhoneRow = {
  event: PhoneEvent;
  page: number;
  at: number;
  request: number;
  value: number;
};
export const phoneCapacity = 128;
export const phoneStorageKey = 'spinel.fixture.spn164.timings';

/** Only fixed names and finite numbers cross the fixture's evidence boundary. */
export function phoneReport(
  value: unknown,
): { rows: PhoneRow[]; dropped: number; unavailable: boolean } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { rows?: PhoneRow[]; dropped?: number; unavailable?: boolean };
  if (
    !Array.isArray(candidate.rows) ||
    candidate.rows.length > phoneCapacity ||
    !Number.isSafeInteger(candidate.dropped) ||
    candidate.dropped! < 0 ||
    (candidate.unavailable !== undefined && typeof candidate.unavailable !== 'boolean')
  )
    return null;
  const rows: PhoneRow[] = [];
  for (const row of candidate.rows) {
    if (
      !row ||
      !phoneEvents.includes(row.event) ||
      ![row.page, row.at, row.request, row.value].every(Number.isFinite) ||
      row.page < 0 ||
      row.at < 0 ||
      !Number.isSafeInteger(row.request) ||
      row.request < 0 ||
      !Number.isInteger(row.value) ||
      row.value < 0 ||
      row.value > 599
    )
      return null;
    rows.push({
      event: row.event,
      page: row.page,
      at: row.at,
      request: row.request,
      value: row.value,
    });
  }
  return { rows, dropped: candidate.dropped!, unavailable: candidate.unavailable ?? false };
}

/** All observer dependencies are inside a fail-closed, operation-independent boundary. */
export function createPhoneObserver(deps: {
  now: () => number;
  page: () => number;
  read: () => string | null;
  write: (value: string) => void;
}) {
  let state: { rows: PhoneRow[]; dropped: number } = { rows: [], dropped: 0 };
  let unavailable = false;
  try {
    const saved = deps.read();
    if (saved) {
      const report = phoneReport(JSON.parse(saved));
      if (!report) unavailable = true;
      else {
        state = report;
        unavailable = report.unavailable;
      }
    }
  } catch {
    unavailable = true;
  }
  let request = 0;
  return {
    next() {
      return ++request;
    },
    mark(event: string, id = 0, value = 0) {
      try {
        const row = { event, page: deps.page(), at: deps.now(), request: id, value };
        const previous = state.rows.at(-1);
        if (
          !phoneReport({ rows: [row], dropped: 0 }) ||
          (previous?.page === row.page && previous.at > row.at)
        ) {
          unavailable = true;
          return;
        }
        if (state.rows.length === phoneCapacity) {
          state.dropped++;
          state.rows.shift();
        }
        state.rows.push(row as PhoneRow);
        deps.write(JSON.stringify({ ...state, unavailable }));
      } catch {
        unavailable = true;
      }
    },
    read() {
      return { ...phoneReport(state)!, unavailable };
    },
  };
}

let observer: ReturnType<typeof createPhoneObserver> | undefined;
try {
  if (typeof window !== 'undefined') {
    observer = createPhoneObserver({
      now: () => performance.now(),
      page: () => performance.timeOrigin,
      read: () => sessionStorage.getItem(phoneStorageKey),
      write: (value) => sessionStorage.setItem(phoneStorageKey, value),
    });
    const mark = (event: PhoneEvent) => observer!.mark(event, 0, navigator.onLine ? 1 : 0);
    mark('page');
    window.addEventListener('online', () => mark('online'));
    window.addEventListener('offline', () => mark('offline'));
    window.addEventListener('pagehide', () => mark('pagehide'));
    document.addEventListener('visibilitychange', () =>
      mark(document.hidden ? 'hidden' : 'visible'),
    );
    Object.defineProperty(window, '__spinelStartupPhoneEvidence', {
      value: () => observer!.read(),
    });
    // Deliberate fixture control: no automatic network probe perturbs reconnect.
    window.addEventListener('DOMContentLoaded', () => {
      const button = document.createElement('button');
      button.textContent = 'Send test timings';
      button.style.cssText =
        'position:fixed;z-index:2147483647;right:8px;top:8px;font:12px system-ui;padding:6px';
      button.onclick = async () => {
        button.disabled = true;
        try {
          const result = await fetch('/__spn164/timings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(observer!.read()),
            signal: AbortSignal.timeout(5000),
          });
          button.textContent = result.ok ? 'Timings sent' : 'Timings not sent';
        } catch {
          button.textContent = 'Timings not sent';
        } finally {
          button.disabled = false;
        }
      };
      document.body.append(button);
    });
  }
} catch {
  /* Fixture instrumentation must never prevent application startup. */
}

export const phoneMark = (event: string, request = 0, value = 0) =>
  observer?.mark(event, request, value);
export const phoneRequest = () => observer?.next() ?? 0;
// Error classes only: 1 timeout, 2 network TypeError, 3 abort, 4 other. No message.
export function phoneError(error: unknown) {
  try {
    return error instanceof DOMException && error.name === 'TimeoutError'
      ? 1
      : error instanceof TypeError
        ? 2
        : error instanceof DOMException && error.name === 'AbortError'
          ? 3
          : 4;
  } catch {
    return 4;
  }
}
