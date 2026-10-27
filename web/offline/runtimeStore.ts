import type { RuntimeCompatibility, ShellManifest } from '../../src/shared/offlineShell.ts';
import {
  LEGACY_COMPATIBILITY,
  parseShellManifest,
  SHELL_CACHE_PREFIX,
  validCompatibility,
} from '../../src/shared/offlineShell.ts';
import { openExistingDatabase } from './existingDatabase.ts';

export const RUNTIME_DATABASE = 'spinel-offline-runtime';
export const RUNTIME_LOCK = 'spinel-offline-runtime';
export type RuntimeState = {
  version: 1;
  builds: ShellManifest[];
  candidate?: ShellManifest;
  accounts: Record<string, RuntimeCompatibility>;
  clients: Record<string, string[]>;
  /** Unknown signed-out legacy accounts can still retain format-1 work. */
  legacyCompatibility?: RuntimeCompatibility;
};
export const emptyRuntimeState = (): RuntimeState => ({
  version: 1,
  builds: [],
  accounts: {},
  clients: {},
});

/** Names only; the caller may exclude its own catalog-locked, verified empty store. */
export async function initialRuntimeState(verify: () => void, verifiedEmptyAccount?: string) {
  const state = emptyRuntimeState();
  const oldCaches = (await caches.keys()).filter((name) => name.startsWith(SHELL_CACHE_PREFIX));
  verify();
  let unknown = true;
  try {
    if (indexedDB.databases) {
      const names = await indexedDB.databases();
      verify();
      // The worker never opens another account's database. Only an explicit
      // preparation's verified empty current account can be excluded; absence
      // of enumeration is still unknown even on an apparently fresh device.
      unknown = names.some(
        (entry) =>
          entry.name?.startsWith('spinel-offline-') &&
          entry.name !== RUNTIME_DATABASE &&
          entry.name !==
            (verifiedEmptyAccount ? `spinel-offline-${verifiedEmptyAccount}` : undefined),
      );
    }
  } catch {
    verify();
    unknown = true;
  }
  if (oldCaches.length || unknown) state.legacyCompatibility = LEGACY_COMPATIBILITY;
  return state;
}

function request<T>(operation: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}
function openForWrite(state: RuntimeState, verify: () => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(RUNTIME_DATABASE, 1);
    let retired = false;
    const timer = setTimeout(() => {
      retired = true;
      opening.transaction?.abort();
      reject(new Error('Offline runtime storage did not respond.'));
    }, 3000);
    opening.onupgradeneeded = (event) => {
      try {
        if (retired) throw new Error('Offline runtime opening expired.');
        verify();
        if (event.oldVersion === 0) {
          // The schema and first valid record commit atomically; an interrupted
          // first preparation never leaves an empty control database behind.
          opening.result.createObjectStore('runtime').put(state, 'state');
        }
      } catch (error) {
        retired = true;
        opening.transaction?.abort();
        clearTimeout(timer);
        reject(error);
      }
    };
    opening.onerror = () => {
      clearTimeout(timer);
      reject(opening.error);
    };
    opening.onsuccess = () => {
      clearTimeout(timer);
      if (retired) opening.result.close();
      else resolve(opening.result);
    };
  });
}
function validState(value: unknown): value is RuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as RuntimeState;
  try {
    return (
      state.version === 1 &&
      Array.isArray(state.builds) &&
      state.builds.length <= 2 &&
      state.builds.every((build) => Boolean(parseShellManifest(JSON.stringify(build)))) &&
      new Set(state.builds.map((build) => build.version)).size === state.builds.length &&
      (!state.candidate || Boolean(parseShellManifest(JSON.stringify(state.candidate)))) &&
      Boolean(state.accounts) &&
      typeof state.accounts === 'object' &&
      !Array.isArray(state.accounts) &&
      Object.values(state.accounts).every(validCompatibility) &&
      Boolean(state.clients) &&
      typeof state.clients === 'object' &&
      !Array.isArray(state.clients) &&
      Object.values(state.clients).every(
        (ids) =>
          Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 2 &&
          ids.every((id) => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id)),
      ) &&
      (!state.legacyCompatibility || validCompatibility(state.legacyCompatibility))
    );
  } catch {
    return false;
  }
}

export async function readRuntimeState(): Promise<RuntimeState | null> {
  const database = await openExistingDatabase(RUNTIME_DATABASE);
  if (!database) return null;
  try {
    if (database.version !== 1 || !database.objectStoreNames.contains('runtime'))
      throw new Error('Offline runtime storage needs attention.');
    const value: unknown = await request(
      database.transaction('runtime').objectStore('runtime').get('state'),
    );
    if (!validState(value)) throw new Error('Offline runtime storage needs attention.');
    return value;
  } finally {
    database.close();
  }
}

/** Caller owns RUNTIME_LOCK. Only explicit preparation or verified adoption calls this. */
export async function writeRuntimeState(state: RuntimeState, verify: () => void) {
  verify();
  if (!validState(state)) throw new Error('Offline runtime storage needs attention.');
  const database = await openForWrite(state, verify);
  database.onversionchange = () => database.close();
  try {
    verify();
    const transaction = database.transaction('runtime', 'readwrite');
    const completion = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error('Offline runtime write failed.'));
    });
    transaction.objectStore('runtime').put(state, 'state');
    await completion;
    verify();
  } finally {
    database.close();
  }
}
