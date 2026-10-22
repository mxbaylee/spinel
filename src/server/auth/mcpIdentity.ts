import { AuthError } from './store.ts';
import type { AuthStore } from './store.ts';
import { accessTokenIdentity } from './tokens.ts';
import { oauthAccessIdentity } from './oauth.ts';

/** Credential type is selected by trusted ingress, never by a client changeset. */
export function currentMcpIdentity(auth: AuthStore, custom: Record<string, unknown>, edit = false) {
  if (typeof custom.mcpTokenHash !== 'string')
    throw new AuthError(401, 'This assistant credential is no longer available.');
  if (Object.hasOwn(custom, 'mcpConnectionId')) {
    const identity = oauthAccessIdentity(auth, custom.mcpTokenHash);
    if (
      identity.connectionId !== custom.mcpConnectionId ||
      identity.resource !== custom.mcpResource
    )
      throw new AuthError(401, 'This assistant connection is no longer available.');
    if (!identity.scopes.includes(edit ? 'documents:write' : 'documents:read'))
      throw new AuthError(403, 'This assistant has not been granted the required document access.');
    return identity;
  }
  return accessTokenIdentity(auth, custom.mcpTokenHash);
}
