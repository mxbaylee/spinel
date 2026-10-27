import {
  appearanceSchema,
  readAppearance,
  readAppearances,
  initialIcon,
} from '../appearance/data.ts';
import { LinkAccess, linkGone } from './links.ts';
import { randomUUID } from 'node:crypto';
import { AuthError, AuthStore } from '../auth/store.ts';
import { ITEM_KINDS } from '../../shared/workspace.ts';
import { classifyOrdinaryItems, isOrdinaryItem, MAX_ANCESTOR_READS } from './ordinary-scope.ts';
import type { ItemKind, WorkspaceItem, ItemAccess, SharePerson } from '../../shared/workspace.ts';
import type { SnapshotSaved } from './snapshots.ts';
import { resolveSpaceScope } from './space-scope.ts';

const columns =
  'id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt';
export class WorkspaceStore {
  auth: AuthStore;
  readonly links: LinkAccess;
  readonly spacesEnabled: boolean;
  private readonly snapshotListeners = new Set<(event: SnapshotSaved) => void>();
  onSnapshotSaved(listener: (event: SnapshotSaved) => void) {
    this.snapshotListeners.add(listener);
    return {
      dispose: () => {
        this.snapshotListeners.delete(listener);
      },
    };
  }
  snapshotSaved(event: SnapshotSaved) {
    for (const listener of this.snapshotListeners) listener(event);
  }
  constructor(auth: AuthStore, options: { spacesEnabled?: boolean } = {}) {
    this.auth = auth;
    this.spacesEnabled = options.spacesEnabled === true;
    auth.database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_items (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES workspace_items(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL CHECK(kind IN ('folder','sheet','doc')),
        name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workspace_items_owner_parent ON workspace_items(owner_id,parent_id);
      CREATE INDEX IF NOT EXISTS workspace_items_parent ON workspace_items(parent_id);
      CREATE TABLE IF NOT EXISTS workspace_tags (
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        PRIMARY KEY(user_id,name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workspace_tag_assignments (
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        PRIMARY KEY(user_id,item_id,name),
        FOREIGN KEY(user_id,name) REFERENCES workspace_tags(user_id,name) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workspace_tag_assignments_item ON workspace_tag_assignments(item_id);
      CREATE INDEX IF NOT EXISTS workspace_tag_assignments_user_name
        ON workspace_tag_assignments(user_id,name,item_id);
      CREATE TABLE IF NOT EXISTS workspace_grants (
        item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('viewer','editor','admin')),
        PRIMARY KEY(item_id,user_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workspace_grants_user_item ON workspace_grants(user_id,item_id);
      CREATE TABLE IF NOT EXISTS workspace_placements (
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES workspace_items(id) ON DELETE CASCADE,
        PRIMARY KEY(user_id,item_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workspace_placements_parent ON workspace_placements(parent_id);
    `);
    // Zero records an unknown legacy share date rather than inventing one from
    // document modification time. Role changes preserve it; a new grant records now.
    if (
      !auth.database
        .prepare('PRAGMA table_info(workspace_grants)')
        .all()
        .some((field) => field.name === 'shared_at')
    )
      auth.database.exec(
        'ALTER TABLE workspace_grants ADD COLUMN shared_at INTEGER NOT NULL DEFAULT 0',
      );
    // Grants have no incoming foreign keys. Rebuild only this leaf table to
    // extend its CHECK while preserving existing roles and original share dates.
    if (
      !String(
        auth.database.prepare("SELECT sql FROM sqlite_master WHERE name='workspace_grants'").get()
          ?.sql,
      ).includes("'admin'")
    )
      auth.transaction(() => {
        auth.database.exec(`
          CREATE TABLE workspace_grants_admin (
            item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('viewer','editor','admin')),
            shared_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(item_id,user_id)
          ) STRICT;
          INSERT INTO workspace_grants_admin SELECT item_id,user_id,role,shared_at FROM workspace_grants;
          DROP TABLE workspace_grants;
          ALTER TABLE workspace_grants_admin RENAME TO workspace_grants;
          CREATE INDEX workspace_grants_user_item ON workspace_grants(user_id,item_id);
        `);
      });
    const fields = auth.database.prepare('PRAGMA table_info(workspace_items)').all();
    // Additive migration preserves existing native snapshots and image foreign keys.
    if (!fields.some((field) => field.name === 'trashed_at'))
      auth.database.exec('ALTER TABLE workspace_items ADD COLUMN trashed_at INTEGER');
    if (!fields.some((field) => field.name === 'trash_batch'))
      auth.database.exec('ALTER TABLE workspace_items ADD COLUMN trash_batch TEXT');
    auth.database.exec(
      'CREATE INDEX IF NOT EXISTS workspace_items_trash ON workspace_items(trashed_at)',
    );
    // Retired workspace_pins tables in older databases are left untouched.
    // No feature reads or writes them; existing item/user foreign keys remain safe.
    appearanceSchema(auth.database);
    this.links = new LinkAccess(auth, this.spacesEnabled);
  }
  ownTags(userId: string, id: string): string[] {
    // Item/trash callers establish document access first; only this person's
    // labels are returned. Suggestions may retain names after access is revoked.
    this.owner(userId);
    if (!isOrdinaryItem(this.auth.database, id))
      throw new AuthError(404, 'This item is not available.');
    return this.assignedTags(userId, id);
  }
  // Call only after current ordinary-item access/structure is established.
  // Discovery must not repeat an entire ancestor walk for every tag projection.
  private assignedTags(userId: string, id: string): string[] {
    return (
      this.auth.database
        .prepare(
          'SELECT name FROM workspace_tag_assignments WHERE user_id=? AND item_id=? ORDER BY name',
        )
        .all(userId, id) as { name: string }[]
    ).map((row) => row.name);
  }
  /** Root-only metadata; this does not admit a Space member to ordinary services. */
  spaceRootTags(userId: string, id: string): string[] {
    if (!this.spacesEnabled) throw new AuthError(404, 'This item is not available.');
    resolveSpaceScope(this.auth, userId, id, id);
    return this.assignedTags(userId, id);
  }
  changeSpaceRootTag(userId: string, id: string, value: unknown, remove = false) {
    return this.auth.transaction(() => {
      this.spaceRootTags(userId, id);
      this.writeTag(userId, id, value, remove);
      return this.spaceRootTags(userId, id);
    });
  }
  tagSuggestions(userId: string): string[] {
    return this.auth.transaction(() => {
      this.owner(userId);
      const rows = this.auth.database
        .prepare(
          `SELECT t.name,a.item_id AS itemId FROM workspace_tags t
         LEFT JOIN workspace_tag_assignments a ON a.user_id=t.user_id AND a.name=t.name
         WHERE t.user_id=? ORDER BY t.name LIMIT ?`,
        )
        .all(userId, MAX_ANCESTOR_READS + 1) as { name: string; itemId: string | null }[];
      if (rows.length > MAX_ANCESTOR_READS)
        throw new AuthError(413, 'These tag suggestions are too large to process at once.');
      const ids = [...new Set(rows.flatMap((row) => (row.itemId === null ? [] : [row.itemId])))];
      const ordinary = classifyOrdinaryItems(this.auth.database, ids);
      if (!ordinary)
        throw new AuthError(413, 'These tag suggestions are too large to process at once.');
      // Personal suggestions survive ordinary revocation, trash and untagging,
      // but an assignment exclusively inside a hidden Space cannot expose a label.
      return [
        ...new Set(
          rows
            .filter((row) => row.itemId === null || ordinary.has(row.itemId))
            .map((row) => row.name),
        ),
      ];
    });
  }
  changeTag(userId: string, id: string, value: unknown, remove = false): WorkspaceItem {
    return this.auth.transaction(() => {
      const item = this.get(userId, id);
      if (item.kind === 'folder') throw new AuthError(400, 'Choose a document to tag.');
      this.writeTag(userId, id, value, remove);
      return this.get(userId, id);
    });
  }
  private writeTag(userId: string, id: string, value: unknown, remove: boolean) {
    if (typeof value !== 'string' || /[\p{Cc}\p{Cs}]/u.test(value))
      throw new AuthError(400, 'Use a tag of 1–64 characters without control characters.');
    const name = value
      .trim()
      .replace(/^#/, '')
      .trim()
      .normalize('NFC')
      .toLowerCase()
      .normalize('NFC');
    if (name.startsWith('#')) throw new AuthError(400, 'Use at most one leading # in a tag.');
    if (!name || name.length > 64)
      throw new AuthError(400, 'Use a tag of 1–64 characters without control characters.');
    if (remove)
      this.auth.database
        .prepare('DELETE FROM workspace_tag_assignments WHERE user_id=? AND item_id=? AND name=?')
        .run(userId, id, name);
    else {
      this.auth.database
        .prepare('INSERT OR IGNORE INTO workspace_tags(user_id,name) VALUES(?,?)')
        .run(userId, name);
      this.auth.database
        .prepare(
          'INSERT OR IGNORE INTO workspace_tag_assignments(user_id,item_id,name) VALUES(?,?,?)',
        )
        .run(userId, id, name);
    }
  }
  owner(ownerId: string) {
    const user = this.auth.user(ownerId);
    if (!user) throw new AuthError(401, 'Sign in to continue.');
    if (user.is_admin) throw new AuthError(403, 'Use your everyday account for documents.');
  }
  list(ownerId: string): WorkspaceItem[] {
    return this.auth.transaction(() => {
      this.owner(ownerId);
      const fields = new Set(
        this.auth.database
          .prepare('PRAGMA table_info(workspace_items)')
          .all()
          .map((row) => row.name),
      );
      // A full hidden Space must not consume the ordinary discovery budget.
      // Check the current schema because this store can predate startup migration.
      const membership = ['space_id', 'space_position']
        .filter((field) => fields.has(field))
        .map((field) => ` AND ${field} IS NULL`)
        .join('');
      const items = this.auth.database
        .prepare(
          `SELECT ${columns}, 'owner' AS access FROM workspace_items
           WHERE owner_id=? AND trashed_at IS NULL
             AND kind IN (${ITEM_KINDS.map(() => '?').join(',')})${membership}
           ORDER BY name COLLATE NOCASE,id LIMIT ?`,
        )
        .all(ownerId, ...ITEM_KINDS, MAX_ANCESTOR_READS + 1) as unknown as WorkspaceItem[];
      // Ownership is established by the query; one request-local classification
      // checks live same-owner folder ancestry without n independent role walks.
      const ordinary = classifyOrdinaryItems(
        this.auth.database,
        items.map((item) => item.id),
        'live',
      );
      if (!ordinary) throw new AuthError(413, 'This item list is too large to process at once.');
      const appearances = readAppearances(
        this.auth.database,
        items.filter((item) => ordinary.has(item.id)).map((item) => item.id),
      );
      return items
        .filter((item) => ordinary.has(item.id))
        .map((item) => ({
          ...item,
          appearance: appearances.get(item.id),
          tags: this.assignedTags(ownerId, item.id),
        }));
    });
  }
  shared(userId: string): WorkspaceItem[] {
    this.owner(userId);
    return this.auth.transaction(() => {
      this.cleanPlacements();
      const fields = new Set(
        this.auth.database
          .prepare('PRAGMA table_info(workspace_items)')
          .all()
          .map((row) => row.name),
      );
      const membership = (alias: string) =>
        ['space_id', 'space_position']
          .filter((field) => fields.has(field))
          .map((field) => ` AND ${alias}.${field} IS NULL`)
          .join('');
      const rows = this.auth.database
        .prepare(
          `
        WITH RECURSIVE accessible(id,owner_id,shared_at) AS (
          SELECT i.id,i.owner_id,g.shared_at FROM workspace_items i
          JOIN workspace_grants g ON g.item_id=i.id
          WHERE g.user_id=? AND i.owner_id<>? AND i.trashed_at IS NULL
            AND i.kind IN ('folder','sheet','doc')${membership('i')}
          UNION
          SELECT c.id,c.owner_id,CASE WHEN a.shared_at=0 THEN 0 ELSE max(a.shared_at,c.created_at) END
          FROM workspace_items c JOIN accessible a ON c.parent_id=a.id AND c.owner_id=a.owner_id
          WHERE c.trashed_at IS NULL AND c.kind IN ('folder','sheet','doc')${membership('c')}
        ) SELECT id,max(shared_at) AS sharedAt FROM accessible GROUP BY id
          ORDER BY sharedAt DESC,id
      `,
        )
        .all(userId, userId) as { id: string; sharedAt: number }[];
      return rows.flatMap((row) => {
        // Discovery can include a Space or malformed descendant, or a direct
        // grant below trash. Apply the same ordinary resolver as document reads.
        if (!this.role(userId, row.id)) return [];
        const placement = this.auth.database
          .prepare(
            'SELECT parent_id AS parentId FROM workspace_placements WHERE user_id=? AND item_id=?',
          )
          .get(userId, row.id) as { parentId: string | null } | undefined;
        return [
          {
            ...this.get(userId, row.id),
            sharedAt: row.sharedAt,
            ...(placement ? { placementParentId: placement.parentId } : {}),
          },
        ];
      });
    });
  }
  place(userId: string, id: string, destination: unknown, remove = false): WorkspaceItem[] {
    this.owner(userId);
    return this.auth.transaction(() => {
      if (!isOrdinaryItem(this.auth.database, id))
        throw new AuthError(404, 'This item is not available.');
      this.cleanPlacements();
      if (remove) {
        this.auth.database
          .prepare('DELETE FROM workspace_placements WHERE user_id=? AND item_id=?')
          .run(userId, id);
      } else {
        const item = this.get(userId, id);
        if (item.access === 'owner')
          throw new AuthError(400, 'File a shared item; use Move for your own items.');
        const parentId = this.parent(userId, destination);
        this.auth.database
          .prepare(
            `INSERT INTO workspace_placements(user_id,item_id,parent_id) VALUES(?,?,?)
          ON CONFLICT(user_id,item_id) DO UPDATE SET parent_id=excluded.parent_id`,
          )
          .run(userId, id, parentId);
      }
      return this.shared(userId);
    });
  }
  cleanPlacements() {
    const rows = this.auth.database
      .prepare('SELECT user_id,item_id,parent_id FROM workspace_placements')
      .all() as {
      user_id: string;
      item_id: string;
      parent_id: string | null;
    }[];
    const remove = this.auth.database.prepare(
      'DELETE FROM workspace_placements WHERE user_id=? AND item_id=?',
    );
    const destination = this.auth.database.prepare('SELECT kind FROM workspace_items WHERE id=?');
    for (const row of rows) {
      let access = this.role(row.user_id, row.item_id);
      if (!access && destination.get(row.item_id)?.kind === 'space') {
        try {
          // The runtime switch hides Space services, not changes to authority
          // or destinations. Check dormant roots internally so revoke/regrant
          // and trash/restore cannot revive a removed personal placement.
          // This admits only root references; public Space gates stay closed.
          access = resolveSpaceScope(this.auth, row.user_id, row.item_id, row.item_id).access;
        } catch (error) {
          if (!(error instanceof AuthError) || ![401, 403, 404].includes(error.status)) throw error;
        }
      }
      if (
        !access ||
        access === 'owner' ||
        (row.parent_id !== null &&
          (this.role(row.user_id, row.parent_id) !== 'owner' ||
            destination.get(row.parent_id)?.kind !== 'folder'))
      )
        remove.run(row.user_id, row.item_id);
    }
  }
  // Ordinary content, metadata and image callers share this boundary. Space
  // services authorize explicitly; no child grant can opt a hidden item in here.
  private role(userId: string, id: string): ItemAccess | null {
    if (!isOrdinaryItem(this.auth.database, id)) return null;
    const row = this.auth.database
      .prepare(
        `
      WITH RECURSIVE ancestors(id,parent_id,owner_id,trashed_at) AS (
        SELECT id,parent_id,owner_id,trashed_at FROM workspace_items WHERE id=?
        UNION
        SELECT p.id,p.parent_id,p.owner_id,p.trashed_at FROM workspace_items p
        JOIN ancestors a ON p.id=a.parent_id AND p.owner_id=a.owner_id
      )
      SELECT CASE WHEN count(a.trashed_at)>0 THEN 0 ELSE max(CASE WHEN a.owner_id=? THEN 4 WHEN g.role='admin' THEN 3 WHEN g.role='editor' THEN 2
        WHEN g.role='viewer' THEN 1 ELSE 0 END) END AS strength
      FROM ancestors a LEFT JOIN workspace_grants g ON g.item_id=a.id AND g.user_id=?
    `,
      )
      .get(id, userId, userId) as { strength: number | null };
    return row.strength === 4
      ? 'owner'
      : row.strength === 3
        ? 'admin'
        : row.strength === 2
          ? 'editor'
          : row.strength === 1
            ? 'viewer'
            : null;
  }
  get(
    userId: string,
    id: string,
    needed: 'read' | 'edit' | 'admin' | 'owner' = 'read',
  ): WorkspaceItem {
    if (userId.startsWith('guest:')) {
      if (!isOrdinaryItem(this.auth.database, id)) throw linkGone();
      const guest = this.links.access(userId, id);
      if (!guest) throw linkGone();
      if (
        needed === 'owner' ||
        needed === 'admin' ||
        (needed === 'edit' && guest.role !== 'editor')
      )
        throw new AuthError(403, 'This link allows viewing only.');
      const item = this.auth.database
        .prepare(`SELECT ${columns} FROM workspace_items WHERE id=?`)
        .get(id) as unknown as WorkspaceItem;
      if (!item || !['sheet', 'doc'].includes(item.kind)) throw linkGone();
      return {
        ...item,
        appearance: readAppearance(this.auth.database, id),
        parentId: null,
        tags: [],
        access: guest.role,
      };
    }
    this.owner(userId);
    const access = this.role(userId, id);
    if (!access) throw new AuthError(404, 'This item is not available.');
    if (
      (needed === 'owner' && access !== 'owner') ||
      (needed === 'admin' && access !== 'owner' && access !== 'admin') ||
      (needed === 'edit' && access === 'viewer')
    )
      throw new AuthError(
        403,
        needed === 'admin'
          ? 'Only the owner or a file admin can manage this item.'
          : needed === 'owner'
            ? 'Only the owner can change this item or its sharing.'
            : 'You can view this document, but cannot edit it.',
      );
    const item = this.auth.database
      .prepare(`SELECT ${columns} FROM workspace_items WHERE id=?`)
      .get(id) as unknown as WorkspaceItem;
    // A direct share must not disclose the owner's private parent chain.
    return {
      ...item,
      appearance: readAppearance(this.auth.database, id),
      access,
      ...(access !== 'owner'
        ? {
            ownerName: (
              this.auth.database
                .prepare(
                  'SELECT u.name FROM auth_users u JOIN workspace_items i ON i.owner_id=u.id WHERE i.id=?',
                )
                .get(id) as { name: string }
            ).name,
          }
        : {}),
      tags: this.assignedTags(userId, id),
      parentId: item.parentId && this.role(userId, item.parentId) ? item.parentId : null,
    };
  }
  children(userId: string, id: string): WorkspaceItem[] {
    const parent = this.get(userId, id);
    if (parent.kind !== 'folder') return [];
    return (
      this.auth.database
        .prepare(
          'SELECT id FROM workspace_items WHERE parent_id=? AND trashed_at IS NULL ORDER BY name COLLATE NOCASE,id',
        )
        .all(id) as { id: string }[]
    )
      .filter((row) => this.role(userId, row.id) !== null)
      .map((row) => this.get(userId, row.id));
  }
  ancestors(userId: string, id: string): WorkspaceItem[] {
    let item = this.get(userId, id);
    const result: WorkspaceItem[] = [];
    const seen = new Set([id]);
    // get() stops at the first inaccessible parent, so breadcrumbs cannot reveal
    // private folder names or bridge a gap in the recipient's access.
    while (item.parentId && !seen.has(item.parentId)) {
      seen.add(item.parentId);
      item = this.get(userId, item.parentId);
      result.unshift(item);
    }
    return result;
  }
  sharing(userId: string, id: string): SharePerson[] {
    this.get(userId, id, 'admin');
    return (
      this.auth.database
        .prepare(
          `SELECT u.id,u.name,u.disabled,g.role AS directRole
      FROM auth_users u LEFT JOIN workspace_grants g ON g.user_id=u.id AND g.item_id=?
      WHERE u.is_admin=0 AND u.id<>? AND u.id<>(SELECT owner_id FROM workspace_items WHERE id=?) AND (u.disabled=0 OR g.role IS NOT NULL)
      ORDER BY u.name COLLATE NOCASE,u.id`,
        )
        .all(id, userId, id) as unknown as Omit<SharePerson, 'effectiveRole'>[]
    ).map((person) => ({
      ...person,
      effectiveRole: person.disabled
        ? null
        : (this.role(person.id, id) as SharePerson['effectiveRole']),
    }));
  }
  share(userId: string, id: string, recipient: unknown, role: unknown) {
    return this.auth.transaction(() => {
      this.get(userId, id, 'admin');
      if (
        typeof recipient !== 'string' ||
        recipient === userId ||
        recipient === this.fileOwner(id) ||
        !['viewer', 'editor', 'admin', null].includes(role as string | null)
      )
        throw new AuthError(
          400,
          'Choose a person and Viewer, Editor, File admin or No direct access.',
        );
      if (role === null)
        this.auth.database
          .prepare('DELETE FROM workspace_grants WHERE item_id=? AND user_id=?')
          .run(id, recipient);
      else {
        const user = this.auth.user(recipient);
        if (!user || user.is_admin) throw new AuthError(400, 'Choose an active everyday account.');
        this.auth.database
          .prepare(
            `INSERT INTO workspace_grants(item_id,user_id,role,shared_at) VALUES(?,?,?,?)
          ON CONFLICT(item_id,user_id) DO UPDATE SET role=excluded.role`,
          )
          .run(id, recipient, role as string, this.auth.now());
      }
      this.cleanPlacements();
      return this.sharing(userId, id);
    });
  }
  name(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 120 ||
      /[\p{Cc}/\\]/u.test(value)
    )
      throw new AuthError(
        400,
        'Use a name of 1–120 characters without slashes or control characters.',
      );
    return value.trim();
  }
  parent(ownerId: string, value: unknown, movingId?: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string') throw new AuthError(400, 'Choose a destination folder.');
    let cursor: string | null = value;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (cursor === movingId || seen.has(cursor))
        throw new AuthError(409, 'A folder cannot be moved into itself or one of its subfolders.');
      seen.add(cursor);
      const folder = this.get(ownerId, cursor, 'owner');
      if (folder.kind !== 'folder') throw new AuthError(400, 'The destination must be a folder.');
      cursor = folder.parentId;
    }
    return value;
  }
  /** Call only after authorizing the file; ownership is not a grant. */
  fileOwner(id: string): string {
    const row = this.auth.database
      .prepare('SELECT owner_id FROM workspace_items WHERE id=?')
      .get(id);
    if (!row) throw new AuthError(404, 'This item is not available.');
    return String(row.owner_id);
  }
  /** Destination authority is independent of source authority and never transfers ownership. */
  moveParent(actor: string, id: string, value: unknown): string | null {
    const owner = this.fileOwner(id);
    if (value === null) {
      if (actor !== owner)
        throw new AuthError(403, 'Choose a folder you administer for this owner.');
      return null;
    }
    if (typeof value !== 'string') throw new AuthError(400, 'Choose a destination folder.');
    const destination = this.get(actor, value, 'admin');
    if (destination.kind !== 'folder' || this.fileOwner(value) !== owner)
      throw new AuthError(403, 'Choose a folder you administer for this owner.');
    // Walk raw parents only after full structural authorization. Hidden ancestors
    // participate in cycle detection but are never returned to the caller.
    const parent = this.auth.database.prepare('SELECT parent_id FROM workspace_items WHERE id=?');
    let cursor: string | null = value;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (cursor === id || seen.has(cursor))
        throw new AuthError(409, 'A folder cannot be moved into itself or one of its subfolders.');
      seen.add(cursor);
      if (seen.size > MAX_ANCESTOR_READS)
        throw new AuthError(413, 'This folder tree is too large.');
      cursor = parent.get(cursor)?.parent_id as string | null;
    }
    return value;
  }
  create(
    ownerId: string,
    input: {
      name?: unknown;
      kind?: unknown;
      parentId?: unknown;
      iconColor?: unknown;
      icon?: unknown;
    },
  ): WorkspaceItem {
    this.owner(ownerId);
    const name = this.name(input.name);
    if (!ITEM_KINDS.includes(input.kind as ItemKind))
      throw new AuthError(400, 'Choose Folder, Sheet or Doc.');
    return this.auth.transaction(() => {
      const parentId = this.parent(ownerId, input.parentId);
      const id = randomUUID();
      const now = this.auth.now();
      this.auth.database
        .prepare(
          'INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, ownerId, parentId, input.kind as string, name, now, now);
      initialIcon(this.auth.database, id, input.icon, input.iconColor);
      return this.get(ownerId, id);
    });
  }
  update(
    ownerId: string,
    id: string,
    input: { name?: unknown; parentId?: unknown },
  ): WorkspaceItem {
    return this.auth.transaction(() => {
      const item = this.get(ownerId, id, 'admin');
      const actualOwner = this.fileOwner(id);
      const name = input.name === undefined ? item.name : this.name(input.name);
      const parentId =
        input.parentId === undefined
          ? (this.auth.database.prepare('SELECT parent_id FROM workspace_items WHERE id=?').get(id)!
              .parent_id as string | null)
          : this.moveParent(ownerId, id, input.parentId);
      this.auth.database
        .prepare(
          'UPDATE workspace_items SET name=?,parent_id=?,updated_at=? WHERE id=? AND owner_id=?',
        )
        .run(name, parentId, this.auth.now(), id, actualOwner);
      this.cleanPlacements();
      return this.get(ownerId, id);
    });
  }
}
