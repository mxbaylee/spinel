import type { WorkspaceItem } from '../../shared/workspace.ts';
import { currentMcpIdentity } from '../auth/mcpIdentity.ts';
import { AuthError } from '../auth/store.ts';
import { resolveSpaceScope } from './space-scope.ts';
import type { WorkspaceStore } from './store.ts';

export type DocumentCredential = 'account' | 'guest' | 'mcp' | 'history' | 'trusted';
const credentialKeys = [
  'sessionHash',
  'guestHash',
  'guestItem',
  'mcpTokenHash',
  'mcpConnectionId',
  'mcpResource',
  'historyRead',
] as const;
interface HistoryRead {
  workspace: WorkspaceStore;
  userId: string;
  spaceId: string;
  itemId: string;
}
// Only this module can mint a capability; JSON/custom protocol data cannot forge one.
// Keeping the proof on a nested object preserves it through SDK customData copies.
const historyReads = new WeakMap<object, HistoryRead>();
const unavailable = () => new AuthError(401, 'This document credential is no longer available.');
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function context(custom: Record<string, unknown>) {
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw unavailable();
  const root = Object.hasOwn(custom, 'spaceId');
  const child = Object.hasOwn(custom, 'spaceItem');
  if (root !== child || (root && (!text(custom.spaceId) || !text(custom.spaceItem))))
    throw unavailable();
}

/** Presence, not truthiness: a partial or undefined scope must never become ordinary access. */
export function hasSpaceContext(custom: Record<string, unknown>): boolean {
  context(custom);
  return Object.hasOwn(custom, 'spaceId');
}

/** Validate exactly one ingress-selected credential family, including all present fields. */
export function validateDocumentCredentials(
  workspace: WorkspaceStore,
  userId: string,
  customData: Record<string, unknown> = {},
  edit = false,
): DocumentCredential {
  context(customData);
  const has = (key: string) => Object.hasOwn(customData, key);
  const account = has('sessionHash');
  const guest = has('guestHash') || has('guestItem');
  const mcp = has('mcpTokenHash') || has('mcpConnectionId') || has('mcpResource');
  const history = has('historyRead');
  if (Number(account) + Number(guest) + Number(mcp) + Number(history) > 1) throw unavailable();
  if (account) {
    if (
      !text(customData.sessionHash) ||
      userId.startsWith('guest:') ||
      workspace.auth.sessionByHash(customData.sessionHash)?.user_id !== userId
    )
      throw unavailable();
    workspace.owner(userId);
    return 'account';
  }
  if (guest) {
    if (!text(customData.guestHash) || !text(customData.guestItem) || !userId.startsWith('guest:'))
      throw unavailable();
    const current = workspace.links.session(userId, customData.guestHash);
    if (
      current.itemId !== customData.guestItem ||
      (hasSpaceContext(customData) && current.itemId !== customData.spaceId)
    )
      throw unavailable();
    if (edit && current.role !== 'editor')
      throw new AuthError(403, 'This link allows viewing only.');
    return 'guest';
  }
  if (mcp) {
    if (
      !text(customData.mcpTokenHash) ||
      userId.startsWith('guest:') ||
      has('mcpConnectionId') !== has('mcpResource') ||
      (has('mcpConnectionId') &&
        (!text(customData.mcpConnectionId) || !text(customData.mcpResource)))
    )
      throw unavailable();
    if (currentMcpIdentity(workspace.auth, customData, edit).userId !== userId) throw unavailable();
    workspace.owner(userId);
    return 'mcp';
  }
  if (history) {
    const token = customData.historyRead;
    const proof = token && typeof token === 'object' ? historyReads.get(token) : undefined;
    if (
      edit ||
      !workspace.spacesEnabled ||
      !proof ||
      proof.workspace !== workspace ||
      proof.userId !== userId ||
      proof.spaceId !== customData.spaceId ||
      proof.itemId !== customData.spaceItem
    )
      throw unavailable();
    workspace.owner(userId);
    return 'history';
  }
  // Existing in-process ordinary services may use their established actor ID.
  // No unauthenticated Space or network ingress is admitted through this branch.
  if (hasSpaceContext(customData) || userId.startsWith('guest:')) throw unavailable();
  return 'trusted';
}

/** A current native-document projection. Ordinary get() never learns Space membership. */
export function resolveDocument(
  workspace: WorkspaceStore,
  userId: string,
  itemId: string,
  mode: 'read' | 'edit' = 'read',
  customData: Record<string, unknown> = {},
): WorkspaceItem {
  return workspace.auth.transaction(() => {
    validateDocumentCredentials(workspace, userId, customData, mode === 'edit');
    if (!hasSpaceContext(customData)) return workspace.get(userId, itemId, mode);
    if (!workspace.spacesEnabled || customData.spaceItem !== itemId)
      throw new AuthError(404, 'This Space page is not available.');
    const scope = resolveSpaceScope(
      workspace.auth,
      userId,
      customData.spaceId as string,
      itemId,
      mode,
    );
    if (scope.item.kind === 'space') throw new AuthError(404, 'Choose a page inside this Space.');
    return { ...scope.item, kind: scope.item.kind, access: scope.access, tags: [] };
  });
}

/** Build an independently authorized source scope from server-owned current membership. */
export function sourceDocumentContext(
  workspace: WorkspaceStore,
  userId: string,
  hostId: string,
  sourceId: string,
  customData: Record<string, unknown> = {},
): Record<string, unknown> {
  return workspace.auth.transaction(() => {
    resolveDocument(workspace, userId, hostId, 'read', customData);
    const family = validateDocumentCredentials(workspace, userId, customData);
    if (family === 'history' && sourceId !== hostId) throw unavailable();
    const next: Record<string, unknown> = {};
    for (const key of credentialKeys)
      if (Object.hasOwn(customData, key)) next[key] = customData[key];
    // A legacy trusted caller stays ordinary-only even when the schema is present.
    if (workspace.spacesEnabled && family !== 'trusted') {
      const row = workspace.auth.database
        .prepare('SELECT space_id FROM workspace_items WHERE id=?')
        .get(sourceId) as { space_id: string | null } | undefined;
      if (row?.space_id) {
        next.spaceId = row.space_id;
        next.spaceItem = sourceId;
      }
    }
    if (
      family === 'guest' &&
      (hasSpaceContext(customData) ? next.spaceId !== customData.spaceId : sourceId !== hostId)
    )
      throw new AuthError(404, 'This source is not available.');
    resolveDocument(workspace, userId, sourceId, 'read', next);
    return next;
  });
}

/** Private background capture can read one exact live page as a current everyday actor. */
export function createHistoryReadContext(
  workspace: WorkspaceStore,
  userId: string,
  spaceId: string,
  itemId: string,
): Record<string, unknown> {
  return workspace.auth.transaction(() => {
    if (!workspace.spacesEnabled) throw new AuthError(404, 'This Space is not available.');
    workspace.owner(userId);
    const scope = resolveSpaceScope(workspace.auth, userId, spaceId, itemId);
    if (!['doc', 'sheet'].includes(scope.item.kind)) throw new AuthError(404, 'Choose a page.');
    const token = Object.freeze({});
    historyReads.set(token, { workspace, userId, spaceId, itemId });
    return { spaceId, spaceItem: itemId, historyRead: token };
  });
}
