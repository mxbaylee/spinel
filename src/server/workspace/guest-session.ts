import type { GrantRole } from '../../shared/workspace.ts';
import type { AuthStore } from '../auth/store.ts';

/** Raw current capability. Callers must additionally validate the target structure. */
export function currentGuestSession(auth: AuthStore, userId: string) {
  if (!userId.startsWith('guest:')) return undefined;
  return auth.database
    .prepare(
      `SELECT s.item_id AS itemId,l.role,s.token_hash AS tokenHash,s.expires_at AS expires
      FROM workspace_guest_sessions s JOIN workspace_links l ON l.item_id=s.item_id AND l.epoch=s.epoch
      JOIN workspace_items i ON i.id=s.item_id JOIN auth_users u ON u.id=i.owner_id
      WHERE s.id=? AND s.expires_at>? AND l.state='active'
        AND i.trashed_at IS NULL AND i.trash_batch IS NULL AND u.disabled=0 AND u.is_admin=0`,
    )
    .get(userId.slice(6), auth.now()) as
    { itemId: string; role: GrantRole; tokenHash: string; expires: number } | undefined;
}
