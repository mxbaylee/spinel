import type { IncomingHttpHeaders } from 'node:http';
import { cookieToken } from '../auth/routes.ts';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from '../workspace/store.ts';

export function documentIdentity(
  workspace: WorkspaceStore,
  headers: IncomingHttpHeaders,
  guestItem?: string,
) {
  if (guestItem) {
    const guest = workspace.links.principal(headers, guestItem);
    return { userId: guest.userId, customData: { guestHash: guest.guestHash, guestItem } };
  }
  const session = workspace.auth.session(cookieToken({ headers }));
  if (!session?.user_id || workspace.auth.user(session.user_id)?.is_admin)
    throw new AuthError(401, 'Sign in with your everyday account.');
  return { userId: session.user_id, customData: { sessionHash: session.token_hash } };
}
export function validateIdentity(
  workspace: WorkspaceStore,
  userId: string,
  custom: Record<string, unknown>,
) {
  if (userId.startsWith('guest:')) {
    const guest = workspace.links.session(userId, custom.guestHash);
    if (guest.itemId !== custom.guestItem) throw new AuthError(403, 'This link no longer works.');
  } else {
    if (
      typeof custom.sessionHash !== 'string' ||
      workspace.auth.sessionByHash(custom.sessionHash)?.user_id !== userId
    )
      throw new AuthError(401, 'Your session expired.');
    workspace.owner(userId);
  }
}
