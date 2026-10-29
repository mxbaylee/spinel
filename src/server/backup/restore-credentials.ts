import type { DatabaseSync } from '../../../server/database.ts';
import { statSync } from 'node:fs';

const cleared = [
  'auth_invite_ceremonies',
  'auth_admin_recovery_ceremonies',
  'auth_challenges',
  'auth_sessions',
  'auth_invites',
  'auth_setup',
  'auth_admin_recovery',
  'auth_access_tokens',
  'oauth_codes',
  'oauth_access',
  'oauth_refresh',
  'oauth_pending',
  'oauth_connections',
  'oauth_clients',
] as const;
const knownAuthority = new Set<string>([
  ...cleared,
  'auth_users',
  'auth_passkeys',
  'auth_profiles',
]);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const incompatible = () =>
  new Error('This backup needs compatible authority and schema reconciliation before restore.');
const recoverySql =
  'CREATE TABLE spinel_recovery (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL, inventory TEXT) STRICT';

function schema(db: DatabaseSync) {
  const rows = db
    .prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name LIMIT 1025')
    .all();
  if (rows.length > 1024) throw incompatible();
  const tables = new Set(
    rows.filter((row) => row.type === 'table').map((row) => String(row.name).toLowerCase()),
  );
  for (const name of tables)
    if (/^(?:auth_|oauth_)/.test(name) && !knownAuthority.has(name)) throw incompatible();
  for (const name of [
    'auth_users',
    'auth_passkeys',
    'auth_sessions',
    'auth_challenges',
    'workspace_links',
    'workspace_guest_sessions',
  ])
    if (!tables.has(name)) throw incompatible();
  const definitions = rows.filter((row) => {
    if (row.type === 'table' && row.name === 'spinel_recovery') {
      if (row.sql !== recoverySql) throw incompatible();
      return false;
    }
    // Triggers attached to recovery metadata are executable too, and must never
    // disappear from this comparison when the metadata table itself is excluded.
    return true;
  });
  return { tables, definitions };
}

/** Run before any credential reaches a candidate. Same image alone cannot make
 * an uploaded trigger, view or foreign-key cascade safe to execute.
 */
export function requireCompatibleRestoreSchema(current: DatabaseSync, candidate: DatabaseSync) {
  const source = schema(current),
    target = schema(candidate);
  if (JSON.stringify(source.definitions) !== JSON.stringify(target.definitions))
    throw incompatible();
  const users = current
    .prepare('PRAGMA table_info(auth_users)')
    .all()
    .map((row) => row.name)
    .sort();
  if (JSON.stringify(users) !== JSON.stringify(['disabled', 'id', 'is_admin', 'name']))
    throw incompatible();
  return target.tables;
}

export function readRestoreRows(db: DatabaseSync, table: string, max: number, selected?: string[]) {
  const columns =
    selected ??
    db
      .prepare(`PRAGMA table_info(${quote(table)})`)
      .all()
      .map((row) => String(row.name));
  if (!columns.length || columns.length > 256) throw incompatible();
  const selection = columns.map(quote).join(',');
  const sizes = columns
    .map((column) => `coalesce(length(CAST(${quote(column)} AS BLOB)),0)`)
    .join('+');
  // SQLite measures bytes before Node materializes even one potentially large
  // value. Both connections are frozen disposable copies throughout this step.
  const size = db
    .prepare(
      `SELECT count(*) AS n,coalesce(sum(bytes),0) AS bytes FROM
    (SELECT ${sizes} AS bytes FROM ${quote(table)} LIMIT ?)`,
    )
    .get(max + 1)!;
  if (Number(size.n) > max || Number(size.bytes) > 8 * 1024 ** 2) throw incompatible();
  const rows: Record<string, string | number | bigint | Uint8Array | null>[] = [];
  let bytes = 0;
  for (const row of db.iterate(`SELECT ${selection} FROM ${quote(table)} LIMIT ?`, max + 1)) {
    for (const value of Object.values(row)) {
      bytes +=
        typeof value === 'string'
          ? Buffer.byteLength(value)
          : value instanceof Uint8Array
            ? value.byteLength
            : 8;
      if (bytes > 8 * 1024 ** 2) throw incompatible();
    }
    rows.push(row);
    if (rows.length > max) throw incompatible();
  }
  return rows;
}

/** Internal step against two disposable, closed-generation copies only.
 * This does not authorize activation or reconcile document ownership/grants.
 * The caller must freeze CURRENT authority after drain, then validate the full
 * reconciled candidate and its fresh retry/generation boundaries before cutover.
 */
export function reconcileRestoreCredentials(current: DatabaseSync, candidate: DatabaseSync) {
  const sourceFile = statSync(current.path, { bigint: true });
  const targetFile = statSync(candidate.path, { bigint: true });
  if (sourceFile.dev === targetFile.dev && sourceFile.ino === targetFile.ino) throw incompatible();
  const tables = requireCompatibleRestoreSchema(current, candidate);
  const users = readRestoreRows(current, 'auth_users', 1024);
  const passkeys = readRestoreRows(current, 'auth_passkeys', 8192);
  const profiles = tables.has('auth_profiles')
    ? readRestoreRows(current, 'auth_profiles', 1024)
    : [];
  const links = readRestoreRows(candidate, 'workspace_links', 100_000, ['item_id', 'epoch']);
  const currentLink = current.prepare('SELECT epoch FROM workspace_links WHERE item_id=?');
  const copyRows = (table: string, rows: ReturnType<typeof readRestoreRows>) => {
    const columns = current
      .prepare(`PRAGMA table_info(${quote(table)})`)
      .all()
      .map((row) => String(row.name));
    const insert = candidate.prepare(
      `INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
    );
    for (const row of rows) insert.run(...columns.map((column) => row[column]));
  };
  candidate.exec('BEGIN IMMEDIATE');
  try {
    for (const table of cleared)
      if (tables.has(table)) candidate.exec(`DELETE FROM ${quote(table)}`);
    candidate.exec('DELETE FROM auth_passkeys; DELETE FROM workspace_guest_sessions');
    // Never delete/replace users: FK cascades would destroy retained documents.
    candidate.exec('UPDATE auth_users SET disabled=1,is_admin=0');
    const saveUser =
      candidate.prepare(`INSERT INTO auth_users(id,name,is_admin,disabled) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,is_admin=excluded.is_admin,disabled=excluded.disabled`);
    for (const user of users) saveUser.run(user.id, user.name, user.is_admin, user.disabled);
    copyRows('auth_passkeys', passkeys);
    if (tables.has('auth_profiles')) {
      candidate.exec('DELETE FROM auth_profiles');
      copyRows('auth_profiles', profiles);
    }
    const disableLink = candidate.prepare(
      `UPDATE workspace_links SET epoch=?,state='off',token_hash=NULL,preview_hash=NULL,enabled_at=NULL,expires_at=NULL WHERE item_id=?`,
    );
    for (const link of links) {
      const previous = currentLink.get(link.item_id)?.epoch ?? 0;
      if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(link.epoch))
        throw incompatible();
      const epoch = Math.max(Number(previous), Number(link.epoch)) + 1;
      if (!Number.isSafeInteger(epoch) || epoch < 1) throw incompatible();
      disableLink.run(epoch, link.item_id);
    }
    for (const row of candidate.iterate('PRAGMA foreign_key_check')) if (row) throw incompatible();
    candidate.exec('COMMIT');
  } catch (error) {
    candidate.exec('ROLLBACK');
    throw error;
  }
  return { currentAccounts: users.length, currentPasskeys: passkeys.length };
}
