import { createHash, randomUUID } from 'node:crypto';
import { AuthError } from './store.ts';
import type { AuthStore, User } from './store.ts';
import type { TransferCounts, TransferPreview } from '../../shared/adminRecovery.ts';

// Refuse oversized handovers in full; never transfer a truncated account tree.
export const MAX_TRANSFER_ITEMS = 10_000;
const unavailable = () =>
  new AuthError(409, 'These files need attention before ownership can transfer.');
const overBudget = () => new AuthError(413, 'This account has too many items to transfer at once.');
type Row = {
  id: string;
  parent_id: string | null;
  kind: 'folder' | 'sheet' | 'doc' | 'space';
  space_id: string | null;
  space_position: number | null;
  trashed_at: number | null;
  trash_batch: string | null;
};
type Recovery = {
  item_id: string;
  space_id: string;
  original_parent_id: string;
  original_position: number;
  trashed_at: number;
  trashed_by: string;
  trash_batch: string;
};
type Link = { item_id: string; epoch: number; state: string; role: string };
const position = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Operator-only handover of an entire disabled account. Reads structural
 * metadata, never item names, snapshots, history payloads or image contents.
 * Existing stable IDs keep content and recovery records attached in place.
 */
export class OwnershipTransfer {
  private readonly auth: AuthStore;
  constructor(auth: AuthStore) {
    this.auth = auth;
  }

  private requireAdmin(actor: string) {
    if (!this.auth.user(actor)?.is_admin) throw new AuthError(404, 'Not found.');
  }

  private inspect(actor: string, id: string) {
    this.requireAdmin(actor);
    const db = this.auth.database;
    const source = db
      .prepare('SELECT id,name,is_admin,disabled FROM auth_users WHERE id=?')
      .get(id) as unknown as User | undefined;
    if (!source || source.is_admin) throw new AuthError(404, 'Account not found.');
    if (!source.disabled)
      throw new AuthError(409, 'Disable this account before transferring ownership.');
    const rows = db
      .prepare(
        `SELECT id,parent_id,kind,space_id,space_position,trashed_at,trash_batch
        FROM workspace_items WHERE owner_id=? LIMIT ?`,
      )
      .all(id, MAX_TRANSFER_ITEMS + 1) as unknown as Row[];
    if (rows.length > MAX_TRANSFER_ITEMS) throw overBudget();
    rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Indexed point probes visit the bounded owner's children/members, stopping
    // at the first foreign attachment. Do not sort an unbounded SQL result.
    const foreignChild = db.prepare(
      'SELECT 1 FROM workspace_items WHERE parent_id=? AND owner_id<>? LIMIT 1',
    );
    const foreignMember = db.prepare(
      'SELECT 1 FROM workspace_items WHERE space_id=? AND owner_id<>? LIMIT 1',
    );
    const recoveryItem = db.prepare('SELECT * FROM workspace_space_trash WHERE item_id=?');
    const recoverySpace = db.prepare(
      'SELECT * FROM workspace_space_trash WHERE space_id=? LIMIT ?',
    );
    const recoveries = new Map<string, Recovery>();
    let scopedRecoveries = 0;
    for (const row of rows) {
      if (foreignChild.get(row.id, id) || foreignMember.get(row.id, id)) throw unavailable();
      const direct = recoveryItem.get(row.id) as Recovery | undefined;
      if (direct) recoveries.set(direct.item_id, direct);
      const scoped = recoverySpace.all(
        row.id,
        MAX_TRANSFER_ITEMS - scopedRecoveries + 1,
      ) as unknown as Recovery[];
      scopedRecoveries += scoped.length;
      if (scopedRecoveries > MAX_TRANSFER_ITEMS) throw overBudget();
      for (const record of scoped) recoveries.set(record.item_id, record);
      if (recoveries.size > MAX_TRANSFER_ITEMS) throw overBudget();
    }
    const recovery = [...recoveries.values()].sort((a, b) =>
      a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0,
    );
    for (const row of recovery) {
      const item = byId.get(row.item_id);
      if (
        !item ||
        !item.space_id ||
        item.space_id !== row.space_id ||
        item.parent_id !== row.space_id ||
        item.trashed_at === null ||
        item.trashed_at !== row.trashed_at ||
        item.trash_batch !== row.trash_batch ||
        !row.original_parent_id ||
        !position(row.original_position) ||
        !row.trashed_by
      )
        throw unavailable();
    }
    for (const row of rows) {
      if (
        row.trashed_at === null
          ? row.trash_batch !== null
          : !position(row.trashed_at) || !row.trash_batch
      )
        throw unavailable();
      const parent = row.parent_id === null ? undefined : byId.get(row.parent_id);
      if (row.space_id === null) {
        if (
          row.space_position !== null ||
          (row.parent_id !== null &&
            (!parent || parent.space_id !== null || parent.kind !== 'folder')) ||
          recoveries.has(row.id)
        )
          throw unavailable();
      } else {
        const space = byId.get(row.space_id);
        if (
          !space ||
          space.kind !== 'space' ||
          space.space_id !== null ||
          row.kind === 'space' ||
          !position(row.space_position) ||
          !parent ||
          (parent.id !== row.space_id && parent.space_id !== row.space_id)
        )
          throw unavailable();
        if (parent.id === row.space_id) {
          if ((row.trashed_at !== null) !== recoveries.has(row.id)) throw unavailable();
        } else if (
          recoveries.has(row.id) ||
          row.trashed_at !== parent.trashed_at ||
          row.trash_batch !== parent.trash_batch
        )
          throw unavailable();
      }
    }
    // Resolve each ancestor once. Iterative traversal handles deep valid trees
    // without recursion or a quadratic walk for every descendant.
    const rooted = new Set<string>();
    for (const row of rows) {
      const path = new Set<string>();
      let current: Row | undefined = row;
      while (current && !rooted.has(current.id)) {
        if (path.has(current.id)) throw unavailable();
        path.add(current.id);
        current = current.parent_id === null ? undefined : byId.get(current.parent_id);
      }
      for (const item of path) rooted.add(item);
    }
    const linkRow = db.prepare(
      'SELECT item_id,epoch,state,role FROM workspace_links WHERE item_id=?',
    );
    const links = rows.flatMap((row) => {
      const link = linkRow.get(row.id) as Link | undefined;
      return link ? [link] : [];
    });
    if (links.some((link) => !position(link.epoch) || link.epoch >= Number.MAX_SAFE_INTEGER))
      throw unavailable();
    const counts: TransferCounts = {
      items: rows.filter((row) => row.kind !== 'folder').length,
      folders: rows.filter((row) => row.kind === 'folder').length,
      links: links.length,
    };
    const confirmation = createHash('sha256')
      .update(JSON.stringify({ source: { id, name: source.name }, rows, recovery, links }))
      .digest('hex');
    return { source, counts, confirmation };
  }

  preview(actor: string, id: string): TransferPreview {
    return this.auth.transaction(() => {
      const view = this.inspect(actor, id);
      const recipients = this.auth.database
        .prepare('SELECT id,name FROM auth_users WHERE disabled=0 AND is_admin=0 AND id<>? LIMIT ?')
        .all(id, MAX_TRANSFER_ITEMS + 1) as { id: string; name: string }[];
      if (recipients.length > MAX_TRANSFER_ITEMS) throw overBudget();
      recipients.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return {
        source: { id: view.source.id, name: view.source.name },
        recipients,
        counts: view.counts,
        confirmation: view.confirmation,
      };
    });
  }

  transfer(actor: string, id: string, targetId: unknown, confirmation: unknown): void {
    this.auth.transaction(() => {
      const view = this.inspect(actor, id);
      const target = typeof targetId === 'string' ? this.auth.user(targetId) : undefined;
      if (!target || target.is_admin || target.id === id)
        throw new AuthError(400, 'Choose an active everyday account to receive these files.');
      if (typeof confirmation !== 'string' || confirmation !== view.confirmation)
        throw new AuthError(
          409,
          'These files changed. Review the transfer again before confirming.',
        );
      if (!view.counts.items && !view.counts.folders)
        throw new AuthError(409, 'This account has no owned files or folders to transfer.');
      const db = this.auth.database;
      // The receiving dashboard must remain able to list the entire account,
      // including its new containing folder. Count all statuses and Space rows
      // conservatively; no partial handover or hidden overflow is acceptable.
      const remaining = MAX_TRANSFER_ITEMS - view.counts.items - view.counts.folders - 1;
      if (
        remaining < 0 ||
        db
          .prepare('SELECT id FROM workspace_items WHERE owner_id=? LIMIT ?')
          .all(target.id, remaining + 1).length > remaining
      )
        throw new AuthError(
          413,
          'This recipient would have too many files and folders. Choose another account.',
        );
      // A disabled owner's surviving token must not revive under a new owner.
      db.prepare(
        `DELETE FROM workspace_guest_sessions WHERE item_id IN
        (SELECT id FROM workspace_items WHERE owner_id=?)`,
      ).run(id);
      db.prepare(
        `UPDATE workspace_links SET state='off',epoch=epoch+1,token_hash=NULL,preview_hash=NULL
        WHERE item_id IN (SELECT id FROM workspace_items WHERE owner_id=?)`,
      ).run(id);
      // Personal placements never grant content access. Keep valid third-party
      // filing, but remove placements into folders whose ownership is changing.
      db.prepare(
        `DELETE FROM workspace_placements WHERE parent_id IN
        (SELECT id FROM workspace_items WHERE owner_id=?) OR
        (user_id IN (?,?) AND item_id IN (SELECT id FROM workspace_items WHERE owner_id=?))`,
      ).run(id, id, target.id, id);
      db.prepare(
        `DELETE FROM workspace_grants WHERE user_id IN (?,?) AND item_id IN
        (SELECT id FROM workspace_items WHERE owner_id=?)`,
      ).run(id, target.id, id);
      const folderId = randomUUID();
      // Account names allow separators that folder names forbid. Preserve a
      // recognizable account label without asking the Operator for file names.
      const name = view.source.name.replace(/[\p{Cc}/\\]/gu, ' ').trim() || 'Transferred files';
      const now = this.auth.now();
      db.prepare(
        `INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at)
        VALUES(?,?,NULL,'folder',?,?,?)`,
      ).run(folderId, target.id, name, now, now);
      db.prepare(
        `UPDATE workspace_items SET owner_id=?,
        parent_id=CASE WHEN space_id IS NULL AND parent_id IS NULL THEN ? ELSE parent_id END
        WHERE owner_id=?`,
      ).run(target.id, folderId, id);
    });
  }
}
