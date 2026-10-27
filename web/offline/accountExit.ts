import { offlineCancellation, setPreparedAccount } from './offlineStore.ts';

const EXIT = 'spinel.offline.sign-out';
const ONLINE_ACCOUNT = 'spinel.offline.online-account';
const GENERATION = 'spinel.auth.generation';
const ACTIVE = 'spinel.auth.active:';
const LOCK = 'spinel-auth-transition';
const CHANGED = 'spinel-account-exit-changed';
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Identifiers only: never a credential, document title or authentication response. */
export type ExitIntent = {
  version: 1;
  id: string;
  accountId: string | null;
  cancellation: string;
  authGeneration: string;
  hasOfflineAccount: boolean;
};
export type AccountExit = {
  intent: ExitIntent;
  persisted: boolean;
  /** Remains valid after remote settlement, but not after another account transition. */
  verifyCurrent(): void;
};

let memoryExit: ExitIntent | null = null;
let memoryGeneration: string | null = null;
let transition: Promise<unknown> = Promise.resolve();
const activeHere = new Set<string>();

const changed = () => window.dispatchEvent(new Event(CHANGED));
const cancelled = () =>
  new DOMException('The account changed. Its offline data was kept.', 'AbortError');
function control() {
  try {
    const local = window.localStorage;
    local.getItem(GENERATION);
    return local;
  } catch {
    return undefined;
  }
}
function read(key: string) {
  try {
    return control()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function generation() {
  const local = control();
  return local ? local.getItem(GENERATION) : memoryGeneration;
}
function writeGeneration() {
  const value = crypto.randomUUID();
  memoryGeneration = value;
  const local = control();
  if (local) {
    local.setItem(GENERATION, value);
    if (local.getItem(GENERATION) !== value) throw cancelled();
  }
  return value;
}
function decode(value: string | null): ExitIntent | null {
  if (!value) return null;
  try {
    const intent = JSON.parse(value) as Partial<ExitIntent>;
    return intent &&
      typeof intent === 'object' &&
      !Array.isArray(intent) &&
      Object.keys(intent).sort().join(',') ===
        'accountId,authGeneration,cancellation,hasOfflineAccount,id,version' &&
      intent.version === 1 &&
      uuid(intent.id) &&
      (uuid(intent.accountId) || intent.accountId === null) &&
      uuid(intent.cancellation) &&
      uuid(intent.authGeneration) &&
      typeof intent.hasOfflineAccount === 'boolean' &&
      (intent.accountId !== null || !intent.hasOfflineAccount)
      ? (intent as ExitIntent)
      : null;
  } catch {
    return null;
  }
}

function sameIntent(left: ExitIntent | null, right: ExitIntent) {
  return (
    left !== null &&
    Object.keys(right).every(
      (key) => left[key as keyof ExitIntent] === right[key as keyof ExitIntent],
    )
  );
}

export function accountExitPending() {
  return memoryExit !== null || read(EXIT) !== null;
}

/** Web Locks covers a dispatched verification until its actual response settles. */
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = () => (globalThis.navigator?.locks ? navigator.locks.request(LOCK, work) : work());
  const pending = transition.then(run, run);
  transition = pending.catch(() => {});
  return pending;
}

function operations() {
  const local = control();
  if (!local) return null;
  try {
    // Snapshot the supported property names. Indexed key(i) scans can skip an
    // older live marker if another tab removes an earlier key during the scan.
    return Object.keys(local).filter((key) => key.startsWith(ACTIVE));
  } catch {
    return null;
  }
}

function operation(intent: ExitIntent, persisted: boolean): AccountExit {
  const cancellation = offlineCancellation();
  const localGeneration = generation();
  return {
    intent,
    persisted,
    verifyCurrent() {
      if (
        (persisted &&
          (offlineCancellation() !== intent.cancellation ||
            generation() !== intent.authGeneration)) ||
        (!persisted && (offlineCancellation() !== cancellation || generation() !== localGeneration))
      )
        throw cancelled();
      const pending = read(EXIT);
      if (pending !== null && !sameIntent(decode(pending), intent)) throw cancelled();
      if (memoryExit && memoryExit.id !== intent.id) throw cancelled();
    },
  };
}

/** Called only after the existing unfinished-input warning was accepted. */
export function beginAccountExit(
  accountId: string | null,
  hasOfflineAccount: boolean,
): AccountExit {
  if (accountId !== null && !uuid(accountId))
    throw new Error('This account could not be identified.');
  // Fence native writers before any asynchronous request or inventory read.
  try {
    setPreparedAccount(null);
  } catch {
    // App closes its private view regardless of blocked local storage.
  }
  const cancellation = offlineCancellation();
  let authGeneration = generation();
  if (!uuid(authGeneration)) {
    try {
      authGeneration = writeGeneration();
    } catch {
      authGeneration = crypto.randomUUID();
    }
  }
  const intent: ExitIntent = {
    version: 1,
    id: crypto.randomUUID(),
    accountId,
    cancellation: uuid(cancellation) ? cancellation : crypto.randomUUID(),
    authGeneration,
    hasOfflineAccount: accountId !== null && hasOfflineAccount,
  };
  memoryExit = intent;
  let persisted = false;
  try {
    const local = control();
    if (local && uuid(cancellation) && local.getItem(GENERATION) === authGeneration) {
      const encoded = JSON.stringify(intent);
      local.setItem(EXIT, encoded);
      persisted = local.getItem(EXIT) === encoded;
    }
  } catch {
    // Keep the in-memory retry and say that closing this tab loses the queue.
  }
  if (persisted) memoryExit = null;
  changed();
  return operation(intent, persisted);
}

/** Restored legacy exits never infer eligibility for private inventory. */
export async function restoreAccountExit(): Promise<AccountExit | 'unknown' | null> {
  return exclusive(async () => {
    const raw = read(EXIT);
    if (raw === null) return memoryExit ? operation(memoryExit, false) : null;
    let intent = decode(raw);
    if (raw === '1') {
      const accountId = read(ONLINE_ACCOUNT);
      const cancellation = offlineCancellation();
      if (!uuid(accountId) || !uuid(cancellation)) return 'unknown';
      let authGeneration = generation();
      if (!uuid(authGeneration)) {
        try {
          authGeneration = writeGeneration();
        } catch {
          return 'unknown';
        }
      }
      intent = {
        version: 1,
        id: crypto.randomUUID(),
        accountId,
        cancellation,
        authGeneration,
        hasOfflineAccount: false,
      };
      try {
        const local = control();
        if (!local || local.getItem(EXIT) !== raw || local.getItem(GENERATION) !== authGeneration)
          return 'unknown';
        local.setItem(EXIT, JSON.stringify(intent));
        if (local.getItem(EXIT) !== JSON.stringify(intent)) return 'unknown';
      } catch {
        return 'unknown';
      }
    }
    return intent ? operation(intent, true) : 'unknown';
  });
}

/** The only success condition is this operation's verified HTTP 204. */
export async function finishAccountExit(exit: AccountExit, current: () => void = () => {}) {
  return exclusive(async () => {
    const verify = () => {
      current();
      exit.verifyCurrent();
    };
    verify();
    const active = operations();
    if (activeHere.size || active?.length)
      throw new Error('Finish or cancel the sign-in in your other Spinel tabs, then try again.');
    if (active === null && !globalThis.navigator?.locks)
      throw new Error(
        'Sign-out is unconfirmed because this browser cannot check other sign-in requests.',
      );
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Spinel-Offline-Account': exit.intent.accountId ?? 'anonymous',
      },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    await response.text();
    verify();
    if (response.status !== 204)
      throw new Error(
        response.status === 409
          ? 'Another sign-in changed this browser. The earlier server sign-out is unconfirmed.'
          : 'The server has not confirmed sign-out. Reconnect and try again.',
      );
    // Recheck after HTTP: no intervening operation may be discarded by this completion.
    if (operations()?.length || activeHere.size)
      throw new Error('Another sign-in is still finishing. Server sign-out remains unconfirmed.');
    const local = control();
    const raw = read(EXIT);
    if (raw !== null) {
      if (!sameIntent(decode(raw), exit.intent)) throw cancelled();
      local?.removeItem(EXIT);
      if (read(EXIT) !== null)
        throw new Error('Could not finish the saved sign-out request. Try again.');
    }
    if (memoryExit?.id === exit.intent.id) memoryExit = null;
    changed();
  });
}

/** A fresh explicit browser-wide exit, never an automatic retarget of an old intent. */
export async function exitCurrentBrowser(current: () => void = () => {}) {
  return exclusive(async () => {
    current();
    const active = operations();
    if (active?.length || activeHere.size)
      throw new Error('Finish or cancel the sign-in in your other Spinel tabs, then try again.');
    if (active === null && !globalThis.navigator?.locks)
      throw new Error(
        'Sign-out is unconfirmed because this browser cannot check other sign-in requests.',
      );
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as {
      user?: { id?: string; isAdmin?: boolean };
    } | null;
    current();
    if (
      response.status !== 401 &&
      (!response.ok || !uuid(body?.user?.id) || typeof body?.user?.isAdmin !== 'boolean')
    )
      throw new Error('Could not identify this browser’s current sign-in. Try again.');
    return beginAccountExit(
      response.status === 401 ? null : body!.user!.id!,
      response.ok && body?.user?.isAdmin === false,
    );
  });
}

/** Read-only startup must not claim an account during a credential replacement. */
export async function withAccountRead<T>(
  current: () => void,
  work: (verify: () => void) => Promise<T>,
) {
  return exclusive(async () => {
    const before = generation();
    const verify = () => {
      current();
      if (accountExitPending() || generation() !== before) throw cancelled();
    };
    verify();
    if (operations()?.length)
      throw new Error(
        'A sign-in is still finishing in another Spinel tab. Try again when it finishes.',
      );
    return work(verify);
  });
}

/**
 * Register before checking the exit barrier. Unique keys cannot overwrite another
 * pending verification; unknown keys are never expired into permission to proceed.
 */
export async function withAuthentication<T>(
  replaceIdentity: boolean,
  current: () => void,
  work: (verify: () => void) => Promise<T>,
) {
  return exclusive(async () => {
    current();
    const id = crypto.randomUUID();
    const key = ACTIVE + id;
    const local = control();
    const before = operations();
    if (before && before.length >= 8)
      throw new Error(
        'Other sign-in requests are unfinished. Finish or cancel them before trying again.',
      );
    let recorded = false;
    try {
      local?.setItem(key, id);
      recorded = local?.getItem(key) === id;
    } catch {
      // No offline account is admitted through an untracked ceremony.
    }
    if (!recorded && !globalThis.navigator?.locks)
      throw new Error(
        'This browser cannot protect a concurrent sign-in. Allow browser storage and try again.',
      );
    activeHere.add(id);
    try {
      if (accountExitPending())
        throw new Error('Finish signing out before starting another sign-in.');
      if (operations()?.some((entry) => entry !== key))
        throw new Error(
          'A sign-in is already open in another Spinel tab. Finish or cancel it first.',
        );
      const expected = replaceIdentity ? writeGeneration() : generation();
      const verify = () => {
        current();
        if (accountExitPending() || generation() !== expected || (recorded && read(key) !== id))
          throw cancelled();
      };
      verify();
      return await work(verify);
    } finally {
      activeHere.delete(id);
      if (recorded && read(key) === id) {
        try {
          local?.removeItem(key);
        } catch {
          // Leave the unknown marker locked; never claim an unfinished response ended.
        }
      }
      changed();
    }
  });
}

export function watchAccountExit(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === EXIT ||
      event.key === GENERATION ||
      event.key?.startsWith(ACTIVE)
    )
      listener();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(CHANGED, listener);
  };
}
