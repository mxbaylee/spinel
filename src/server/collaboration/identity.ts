import type { IncomingHttpHeaders } from 'node:http';
import { cookieToken } from '../auth/routes.ts';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { validateDocumentCredentials } from '../workspace/document-access.ts';

export interface SpaceDocumentScope {
  spaceId: string;
  spaceItem: string;
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
  if (!session?.user_id || workspace.auth.user(session.user_id)?.is_admin)
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

/** Transport middleware runs before route params are populated. Select credentials from the URL. */
export function protocolGuestItem(url: string | undefined, origin: string) {
  const path = new URL(url ?? '/', origin).pathname;
  if (path.startsWith('/guest-space-api/')) {
    const match =
      /^\/guest-space-api\/([a-f\d-]{36})\/items\/([a-f\d-]{36})\/universer-api(?:\/|$)/.exec(path);
    if (!match) throw new AuthError(401, 'This document is not available.');
    return match[1];
  }
  if (!path.startsWith('/guest-api/')) return undefined;
  const match = /^\/guest-api\/([a-f\d-]{36})\/universer-api(?:\/|$)/.exec(path);
  if (!match) throw new AuthError(401, 'This document is not available.');
  return match[1];
}

/** Exact scope selected by the server URL, never a body or query flag. */
export function protocolSpaceScope(
  url: string | undefined,
  origin: string,
  enabled = false,
): SpaceDocumentScope | undefined {
  const path = new URL(url ?? '/', origin).pathname;
  if (!path.startsWith('/space-api/') && !path.startsWith('/guest-space-api/')) return undefined;
  const match =
    /^\/(?:space-api|guest-space-api)\/([a-f\d-]{36})\/items\/([a-f\d-]{36})\/universer-api(?:\/|$)/.exec(
      path,
    );
  if (!enabled || !match) throw new AuthError(401, 'This document is not available.');
  return { spaceId: match[1], spaceItem: match[2] };
}
