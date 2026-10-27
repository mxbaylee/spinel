import type { IncomingHttpHeaders } from 'node:http';
import { cookieToken } from '../auth/routes.ts';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { validateDocumentCredentials } from '../workspace/document-access.ts';

export interface SpaceDocumentScope {
  spaceId: string;
  spaceItem: string;
}

/** Bind offline requests before any role or document-access denial. */
export function checkOfflineAccount(headers: IncomingHttpHeaders, userId: string) {
  const expectedAccount = headers['x-spinel-offline-account'];
  if (expectedAccount !== undefined && expectedAccount !== userId)
    throw new AuthError(409, 'The signed-in account changed. Reopen Spinel.');
}

export function documentIdentity(
  workspace: WorkspaceStore,
  headers: IncomingHttpHeaders,
  guestItem?: string,
  space?: SpaceDocumentScope,
) {
  if (guestItem) {
    if (space && (!workspace.spacesEnabled || space.spaceId !== guestItem))
      throw new AuthError(401, 'This document is not available.');
    const guest = workspace.links.principal(headers, guestItem);
    return {
      userId: guest.userId,
      customData: { guestHash: guest.guestHash, guestItem, ...space },
    };
  }
  const session = workspace.auth.session(cookieToken({ headers }));
  if (!session?.user_id) throw new AuthError(401, 'Sign in with your everyday account.');
  // An offline refresh must never interpret another account's 404 as removal
  // of the downloading account's copy. Check before document authorization.
  checkOfflineAccount(headers, session.user_id);
  if (workspace.auth.user(session.user_id)?.is_admin)
    throw new AuthError(401, 'Sign in with your everyday account.');
  return {
    userId: session.user_id,
    customData: { sessionHash: session.token_hash, ...space },
  };
}
export function validateIdentity(
  workspace: WorkspaceStore,
  userId: string,
  custom: Record<string, unknown>,
  edit = false,
) {
  const family = validateDocumentCredentials(workspace, userId, custom, edit);
  if (family === 'trusted' || family === 'history')
    throw new AuthError(401, 'This document credential is no longer available.');
}
