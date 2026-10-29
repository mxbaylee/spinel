import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Sqlite from 'libsql';
import type { MaintenanceGate } from '../src/server/maintenance/gate.ts';

type Value = string | number | bigint | Uint8Array | null;
type Row = Record<string, Value>;
const normalizeRow = (columns: { name: string }[], value: unknown): Row | undefined =>
  value === undefined
    ? undefined
    : Object.fromEntries(
        columns.map(({ name }) => {
          const column = (value as Record<string, Value | ArrayBuffer>)[name];
          // libsql get() returns Buffer while all()/iterate() may return ArrayBuffer.
          return [name, column instanceof ArrayBuffer ? Buffer.from(column) : column];
        }),
      );

/** One SQLite runtime for app and public SDK connections. Mixing node:sqlite with
 * the SDK's libsql in one process can corrupt shared WAL locking on reopen (#68). */
export class DatabaseSync {
  private readonly database: Sqlite.Database;
  private writeGuard?: () => void;
  private admittedTransaction = false;
  maintenance?: MaintenanceGate;
  readonly path: string;
  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.path = path;
    this.database = new Sqlite(
      path,
      options.readOnly ? { readonly: true, fileMustExist: true } : undefined,
    );
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }
  get isOpen() {
    return this.database.open;
  }
  assertQuiescent() {
    if (this.database.inTransaction) throw new Error('A database transaction is still open.');
  }
  /** Application admission is checked again at every actual write, including RETURNING. */
  setWriteGuard(guard: () => void) {
    this.writeGuard = guard;
  }
  setMaintenanceGate(gate: MaintenanceGate) {
    this.maintenance = gate;
    this.setWriteGuard(() => gate.assertWrite());
  }
  runBackground<T>(work: () => T): T | undefined {
    return this.maintenance ? this.maintenance.job(work) : work();
  }
  exec(sql: string) {
    let denied: unknown;
    try {
      this.writeGuard?.();
    } catch (error) {
      denied = error;
    }
    const parts = sql
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean);
    const rollback =
      parts.every((part) =>
        /^(?:ROLLBACK(?:\s+TO(?:\s+SAVEPOINT)?\s+[A-Za-z_][\w]*)?|RELEASE(?:\s+SAVEPOINT)?\s+[A-Za-z_][\w]*)$/i.test(
          part,
        ),
      ) && /^\s*ROLLBACK\b/i.test(sql);
    if (denied && !rollback) {
      const controls =
        parts.length > 0 &&
        parts.every((part) =>
          /^(?:BEGIN(?:\s+(?:IMMEDIATE|DEFERRED|EXCLUSIVE))?(?:\s+TRANSACTION)?|COMMIT(?:\s+TRANSACTION)?|SAVEPOINT\s+[A-Za-z_][\w]*|RELEASE(?:\s+SAVEPOINT)?\s+[A-Za-z_][\w]*)$/i.test(
            part,
          ),
        );
      if (!controls || (this.admittedTransaction && this.database.inTransaction)) throw denied;
      // Permission reads reuse AuthStore's transaction helper. Outside admitted
      // work they take a read transaction; SQL below still enforces query_only.
      this.database.exec(sql.replace(/\bBEGIN\s+(?:IMMEDIATE|EXCLUSIVE)\b/i, 'BEGIN'));
    } else {
      if (!this.database.inTransaction && /^\s*(?:BEGIN|SAVEPOINT)\b/i.test(sql))
        this.admittedTransaction = !!this.writeGuard;
      this.database.exec(sql);
    }
    if (!this.database.inTransaction) this.admittedTransaction = false;
  }
  close() {
    this.database.close();
  }
  prepare(sql: string) {
    const statement = this.database.prepare(sql);
    const execute = <T>(work: () => T): T => this.readOrAdmitted(sql, work);
    // libsql get() includes driver timing metadata on some platforms. Only SQL
    // columns belong in application records or serialized API responses.
    const row = (value: unknown): Row | undefined => normalizeRow(statement.columns(), value);
    return {
      get: (...values: Value[]) => {
        return execute(() => row(statement.get(...values)));
      },
      all: (...values: Value[]) => {
        return execute(() => statement.all(...values).map((value) => row(value)!));
      },
      run: (...values: Value[]) => {
        return execute(() => statement.run(...values));
      },
    };
  }
  /** Stream bounded rows without materializing a complete recovery dataset. */
  *iterate(sql: string, ...values: Value[]) {
    const statement = this.database.prepare(sql);
    const columns = statement.columns();
    const iterator = this.readOrAdmitted(sql, () => statement.iterate(...values));
    for (;;) {
      const result = this.readOrAdmitted(sql, () => iterator.next());
      if (result.done) break;
      yield normalizeRow(columns, result.value)!;
    }
  }
  private readOrAdmitted<T>(sql: string, work: () => T): T {
    let denied: unknown;
    try {
      this.writeGuard?.();
    } catch (error) {
      denied = error;
    }
    if (!denied) return work();
    // libsql's types advertise Statement.readonly, but its runtime does not
    // implement it. SQLite itself enforces read-only CTEs/RETURNING here. Never
    // allow ATTACH or a pragma that changes the connection's safety settings.
    const read =
      /^\s*(?:SELECT|WITH|EXPLAIN)\b/i.test(sql) ||
      /^\s*PRAGMA\s+(?:table_info|table_xinfo|index_list|index_info|index_xinfo|foreign_key_list|foreign_key_check|integrity_check|quick_check)(?:\s*\([^;]*\))?\s*;?\s*$/i.test(
        sql,
      ) ||
      /^\s*PRAGMA\s+(?:database_list|user_version|page_count|page_size|freelist_count)\s*;?\s*$/i.test(
        sql,
      );
    if (!read) throw denied;
    const prior = this.database.prepare('PRAGMA query_only').get() as { query_only: number };
    this.database.exec('PRAGMA query_only=ON');
    try {
      return work();
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith('SQLITE_READONLY')) throw denied;
      throw error;
    } finally {
      this.database.exec(`PRAGMA query_only=${prior.query_only ? 'ON' : 'OFF'}`);
    }
  }
}

/** SQLite's consistent snapshot copy; never copy an active DB/WAL as raw files.
 * libsql's JS backup method is not implemented. VACUUM INTO is supported and
 * briefly queues this process's other work while the synchronous copy runs. */
export async function backup(database: DatabaseSync, destination: string) {
  database.prepare('VACUUM INTO ?').run(destination);
}

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  // Keep the file and schema compatible; wait briefly for other local writers.
  database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return database;
}
