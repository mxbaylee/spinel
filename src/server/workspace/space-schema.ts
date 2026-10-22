import type { DatabaseSync } from '../../../server/database.ts';

const replacement = 'workspace_items_space_new';
const existingColumns = ['id', 'owner_id', 'parent_id', 'kind', 'name', 'created_at', 'updated_at'];
const optionalColumns = ['trashed_at', 'trash_batch', 'space_id', 'space_position'];
const recoveryTable = `CREATE TABLE IF NOT EXISTS workspace_space_trash (
  item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE RESTRICT,
  original_parent_id TEXT NOT NULL,
  original_position INTEGER NOT NULL CHECK(original_position BETWEEN 0 AND 9007199254740991),
  trashed_at INTEGER NOT NULL,
  trashed_by TEXT NOT NULL,
  trash_batch TEXT NOT NULL UNIQUE,
  CHECK(item_id<>space_id)
) STRICT`;

function tableBody(sql: string) {
  // SQLite may quote the renamed table. Its stored body is otherwise preserved.
  return sql.slice(sql.indexOf('(')).replace(/\s+/g, ' ').trim();
}

function itemsTable(name: 'workspace_items' | typeof replacement) {
  return `CREATE TABLE ${name} (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES workspace_items(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK(kind IN ('folder','sheet','doc','space')),
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    trashed_at INTEGER,
    trash_batch TEXT,
    space_id TEXT REFERENCES workspace_items(id) ON DELETE RESTRICT,
    space_position INTEGER,
    CHECK (
      (space_id IS NULL AND space_position IS NULL) OR
      (space_id IS NOT NULL AND space_position IS NOT NULL AND space_id<>id
        AND kind IN ('folder','sheet','doc')
        AND space_position BETWEEN 0 AND 9007199254740991)
    )
  ) STRICT`;
}

function checkDatabase(database: DatabaseSync) {
  if (database.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Space schema migration found invalid foreign keys.');
  const checks = database.prepare('PRAGMA integrity_check').all();
  if (checks.length !== 1 || checks[0].integrity_check !== 'ok')
    throw new Error('Space schema migration failed the database integrity check.');
}

/**
 * SPN-078 storage migration, called by application startup before the SDK opens.
 * Run after AuthStore, before opening other application/SDK connections or transactions.
 * This changes storage only: it does not enable ordinary Space creation or child routes.
 *
 * Widening the kind CHECK follows SQLite's safe create/copy/drop/rename order:
 * https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes
 * Renaming the old table first can retarget the native-content foreign keys.
 */
export function migrateSpaceSchema(database: DatabaseSync): void {
  if (database.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1)
    throw new Error('Space schema migration requires foreign-key enforcement.');

  const columns = database
    .prepare('PRAGMA table_info(workspace_items)')
    .all()
    .map((column) => String(column.name));
  const present = new Set(columns);
  if (
    columns.length &&
    (existingColumns.some((name) => !present.has(name)) ||
      columns.some((name) => ![...existingColumns, ...optionalColumns].includes(name)))
  )
    throw new Error('Space schema migration does not recognize the existing item columns.');
  const spaceColumns = ['space_id', 'space_position'].filter((name) => present.has(name));
  if (spaceColumns.length === 1)
    throw new Error('Space schema migration found an incomplete previous schema.');
  const tableSql = (name: string) =>
    database.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(name)?.sql;
  if (
    spaceColumns.length === 2 &&
    tableBody(String(tableSql('workspace_items'))) !== tableBody(itemsTable('workspace_items'))
  )
    throw new Error('Space schema migration does not recognize the existing Space schema.');
  const recoverySql = tableSql('workspace_space_trash');
  if (recoverySql && tableBody(String(recoverySql)) !== tableBody(recoveryTable))
    throw new Error('Space schema migration does not recognize the recovery schema.');
  if (database.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(replacement))
    throw new Error('Space schema migration found an existing replacement table.');

  // SQLite ignores this PRAGMA inside a transaction. Verify the change before
  // BEGIN so rejecting a nested invocation never rolls back its caller's work.
  database.exec('PRAGMA foreign_keys=OFF');
  if (database.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 0)
    throw new Error('Run Space schema migration outside an existing transaction.');

  let begun = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    begun = true;
    if (!columns.length) database.exec(itemsTable('workspace_items'));
    else if (!spaceColumns.length) {
      const definitions = database
        .prepare(
          `SELECT sql FROM sqlite_schema WHERE tbl_name='workspace_items'
          AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name`,
        )
        .all();
      database.exec(itemsTable(replacement));
      const copied = [...existingColumns, 'trashed_at', 'trash_batch'];
      database.exec(
        `INSERT INTO ${replacement} (${copied.join(',')})
        SELECT ${copied.map((name) => (present.has(name) ? name : 'NULL')).join(',')}
        FROM workspace_items`,
      );
      database.exec('DROP TABLE workspace_items');
      database.exec(`ALTER TABLE ${replacement} RENAME TO workspace_items`);
      // DROP removes table-owned indexes and triggers. Recreate their original
      // definitions, including collaboration/generation deletion cleanup hooks.
      for (const definition of definitions) database.exec(String(definition.sql));
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS workspace_items_owner_parent ON workspace_items(owner_id,parent_id);
      CREATE INDEX IF NOT EXISTS workspace_items_parent ON workspace_items(parent_id);
      CREATE INDEX IF NOT EXISTS workspace_items_trash ON workspace_items(trashed_at);
      CREATE INDEX IF NOT EXISTS workspace_items_space_parent_position
        ON workspace_items(space_id,parent_id,space_position,id);
      CREATE INDEX IF NOT EXISTS workspace_items_owner_kind
        ON workspace_items(owner_id,kind,space_id,trashed_at);
      CREATE INDEX IF NOT EXISTS workspace_space_discovery_children
        ON workspace_items(owner_id,parent_id)
        WHERE space_id IS NULL AND space_position IS NULL AND trashed_at IS NULL
          AND trash_batch IS NULL AND kind IN ('folder','space');
      ${recoveryTable};
      CREATE INDEX IF NOT EXISTS workspace_space_trash_space_date
        ON workspace_space_trash(space_id,trashed_at,item_id);
    `);
    // Original parent and actor deliberately have no FK: a missing parent can
    // restore at the Space root, and deleting an actor must not erase recovery.
    // Scope, sole ownership and rooted ancestry are checked by the Space service.
    checkDatabase(database);
    database.exec('COMMIT');
    begun = false;
  } catch (error) {
    if (begun) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys=ON');
  }
}
