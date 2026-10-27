import { documentPath, documentSyncPath } from '../documentAccess.ts';
import type { OfflineAccess } from './OfflineAccess.ts';

/** Account binding is checked by the server before access/404 responses. */
export class ScopedHTTP {
  private readonly access: OfflineAccess;
  private readonly isCurrent: () => boolean;
  constructor(access: OfflineAccess, isCurrent: () => boolean) {
    this.access = access;
    this.isCurrent = isCurrent;
  }
  async fetch(path: string, init: RequestInit = {}) {
    const check = this.access.remoteGate(this.isCurrent);
    const scope = this.access.scope;
    const url = new URL(path, scope.origin);
    const roots = [
      documentPath(scope.itemId, scope.spaceId),
      documentSyncPath(scope.itemId, scope.spaceId),
    ];
    if (
      url.origin !== scope.origin ||
      !roots.some((root) => url.pathname === root || url.pathname.startsWith(root + '/'))
    )
      throw new Error('This request does not belong to the downloaded document.');
    const headers = new Headers(init.headers);
    headers.set('X-Spinel-Offline-Account', scope.accountId);
    const response = await fetch(url, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    check();
    return response;
  }
}
