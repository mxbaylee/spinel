import { parseSearch } from '../src/shared/search.ts';
import type { SearchQuery } from '../src/shared/search.ts';

export type DashboardRetrieval = {
  folderId: string | null;
  shared: boolean;
  query: SearchQuery;
  draft: string;
  allFiles: boolean;
  layout: 'list' | 'grid';
  scroll: number;
};
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const sessionKey = 'spinel:dashboard-navigation-session';
const returnKey = (accountId: string) => `spinel:dashboard-return:${encodeURIComponent(accountId)}`;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
type Envelope = { version: 1; accountId: string; generation: string; value: DashboardRetrieval };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Navigation hints only; no result metadata, paths, names or document content. */
export function parseDashboardRetrieval(input: unknown): DashboardRetrieval | null {
  if (
    !object(input) ||
    !(
      input.folderId === null ||
      (typeof input.folderId === 'string' && uuid.test(input.folderId))
    ) ||
    typeof input.shared !== 'boolean' ||
    (input.shared && input.folderId !== null) ||
    typeof input.draft !== 'string' ||
    input.draft.length > 2048 ||
    typeof input.allFiles !== 'boolean' ||
    (input.layout !== 'list' && input.layout !== 'grid') ||
    typeof input.scroll !== 'number' ||
    !Number.isFinite(input.scroll) ||
    input.scroll < 0 ||
    input.scroll > 10_000_000 ||
    !object(input.query)
  )
    return null;
  try {
    return {
      folderId: input.folderId,
      shared: input.shared,
      draft: input.draft,
      allFiles: input.allFiles,
      layout: input.layout as 'list' | 'grid',
      scroll: input.scroll,
      query: parseSearch(input.query),
    };
  } catch {
    return null;
  }
}

export function clearDashboardNavigation(storage?: StorageAccess) {
  try {
    storage ??= window.sessionStorage;
    const raw = storage.getItem(sessionKey);
    const active = raw && raw.length < 512 ? JSON.parse(raw) : null;
    if (object(active) && typeof active.accountId === 'string')
      storage.removeItem(returnKey(active.accountId));
  } catch {
    /* Optional storage must never block signing out. */
  } finally {
    try {
      storage?.removeItem(sessionKey);
    } catch {
      /* Unavailable storage cannot restore a session. */
    }
  }
}

/** A noncredential epoch invalidates old history even after the same account signs in again. */
export function dashboardSession(accountId: string, storage?: StorageAccess): string | null {
  try {
    storage ??= window.sessionStorage;
    const raw = storage.getItem(sessionKey);
    const active = raw && raw.length < 512 ? JSON.parse(raw) : null;
    if (
      object(active) &&
      active.accountId === accountId &&
      typeof active.generation === 'string' &&
      uuid.test(active.generation)
    )
      return active.generation;
    clearDashboardNavigation(storage);
    const generation = crypto.randomUUID();
    storage.setItem(sessionKey, JSON.stringify({ accountId, generation }));
    return generation;
  } catch {
    return null;
  }
}

export function retrievalHref(value: DashboardRetrieval) {
  return value.shared ? '/?shared=1' : value.folderId ? `/?item=${value.folderId}` : '/';
}

export function rememberDashboardRetrieval(
  accountId: string,
  value: DashboardRetrieval,
  storage?: StorageAccess,
) {
  const clean = parseDashboardRetrieval(value),
    generation = dashboardSession(accountId, storage);
  if (!clean || !generation) {
    try {
      (storage ?? window.sessionStorage).removeItem(returnKey(accountId));
    } catch {
      /* No usable snapshot. */
    }
    return null;
  }
  const envelope: Envelope = { version: 1, accountId, generation, value: clean };
  try {
    (storage ?? window.sessionStorage).setItem(returnKey(accountId), JSON.stringify(envelope));
  } catch {
    /* History still works. */
  }
  return envelope;
}

export function restoreDashboardRetrieval(
  accountId: string,
  envelope: unknown,
  target: string,
  storage?: StorageAccess,
): DashboardRetrieval | null {
  if (
    !object(envelope) ||
    envelope.version !== 1 ||
    envelope.accountId !== accountId ||
    typeof envelope.generation !== 'string' ||
    !uuid.test(envelope.generation)
  )
    return null;
  const generation = dashboardSession(accountId, storage);
  if (!generation || envelope.generation !== generation) return null;
  const value = parseDashboardRetrieval(envelope.value);
  return value && retrievalHref(value) === target ? value : null;
}

export function dashboardReturnHref(accountId: string, storage?: StorageAccess): string | null {
  try {
    storage ??= window.sessionStorage;
    const raw = storage.getItem(returnKey(accountId));
    if (!raw || raw.length > 6000) return null;
    const envelope = JSON.parse(raw);
    const value = parseDashboardRetrieval(envelope.value);
    if (!value || !restoreDashboardRetrieval(accountId, envelope, retrievalHref(value), storage))
      return null;
    const url = retrievalHref(value);
    return `${url}${url.includes('?') ? '&' : '?'}files-return=1`;
  } catch {
    return null;
  }
}

export function consumeDashboardReturn(accountId: string, target: string, storage?: StorageAccess) {
  try {
    storage ??= window.sessionStorage;
    const raw = storage.getItem(returnKey(accountId));
    storage.removeItem(returnKey(accountId));
    return raw && raw.length <= 6000
      ? restoreDashboardRetrieval(accountId, JSON.parse(raw), target, storage)
      : null;
  } catch {
    return null;
  }
}
