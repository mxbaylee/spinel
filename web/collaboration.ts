import { maintenanceFetch as fetch } from './maintenanceFetch.ts';
import { documentPath, guestItemId } from './documentAccess.ts';
import { OfflineSession } from './offline/OfflineSession.ts';
import { UserManagerService } from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import type { SaveState } from '../src/shared/autosave.ts';
import type { ItemAccess } from '../src/shared/workspace.ts';
import type { ConnectionState } from './connectionState.ts';
import { revokeGuestView } from './guestRevocation.ts';
import { getSpinelSync } from './spinelSync.ts';

export { loadSpinelDocument, disposeSpinelSync } from './spinelSync.ts';

export async function prepareCollaboration(
  id: string,
  spaceId?: string,
  isCurrent: () => boolean = () => true,
) {
  const response = await fetch(`${documentPath(id, spaceId)}/collaboration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  // A departed child's late response is not authority over the current editor.
  if (isCurrent() && [401, 403, 404].includes(response.status)) revokeGuestView();
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Could not open live editing.');
  // A cached old server must never silently reopen an obsolete collaboration
  // transport after cutover. Reload can acquire the current application build.
  if (data.syncVersion !== 1)
    throw new Error('Reload this page to use the updated collaboration service.');
  return data as {
    unitId: string;
    access: ItemAccess;
    user: { id: string; name: string };
    syncVersion: 1;
  };
}

/** A local launch never asks a different cookie/account to choose its document. */
export async function prepareEditor(
  id: string,
  spaceId: string | undefined,
  isCurrent: () => boolean,
  localAccountId?: string,
) {
  if (localAccountId) {
    const offline = new OfflineSession(localAccountId, id, spaceId, isCurrent);
    try {
      await offline.activate();
      if (!isCurrent()) throw new DOMException('The editor was closed.', 'AbortError');
      if (!offline.bundle) throw new Error('This document is no longer on this device.');
      return {
        unitId: offline.bundle.unitId,
        access: offline.readOnly ? ('viewer' as const) : offline.bundle.access,
        user: { id: localAccountId, name: '' },
        syncVersion: 1 as const,
        offline,
      };
    } catch (error) {
      offline.dispose();
      throw error;
    }
  }
  const live = await prepareCollaboration(id, spaceId, isCurrent);
  if (!isCurrent() || guestItemId()) return { ...live, offline: undefined };
  let offline: OfflineSession;
  try {
    offline = new OfflineSession(live.user.id, id, spaceId, isCurrent);
  } catch {
    return { ...live, offline: undefined };
  }
  try {
    await offline.activate();
    if (!isCurrent()) throw new DOMException('The editor was closed.', 'AbortError');
    if (
      offline.bundle &&
      (offline.bundle.unitId !== live.unitId || offline.bundle.access !== live.access)
    )
      offline.stopRemote(
        'Access or the document version changed. Your saved device copy is retained.',
      );
    return {
      ...live,
      ...(offline.bundle && {
        unitId: offline.bundle.unitId,
        access: offline.readOnly ? ('viewer' as const) : offline.bundle.access,
      }),
      offline,
    };
  } catch (error) {
    offline.dispose();
    throw error;
  }
}

export function identifyCollaborator(univer: Univer, user: { id: string; name: string }) {
  univer
    .__getInjector()
    .get(UserManagerService)
    .setCurrentUser({ userID: user.id, name: user.name, avatar: '' });
}

export function watchCollaboration(
  univer: Univer,
  publish: (state: SaveState) => void,
  readonly: (preserveInput?: boolean) => Promise<void>,
  publishConnection: (state: ConnectionState) => void = () => {},
) {
  const sync = getSpinelSync(univer);
  if (!sync) throw new Error('Could not open live editing. Reload to try again.');
  return sync.watch({ publish, readonly, connection: publishConnection });
}
