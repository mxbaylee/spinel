import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Sqlite from 'libsql';

type Value = string | number | bigint | Uint8Array | null;
type Row = Record<string, Value>;

/** One SQLite runtime for app and public SDK connections. Mixing node:sqlite with
 * the SDK's libsql in one process can corrupt shared WAL locking on reopen (#68). */
export class DatabaseSync {
  private readonly database: Sqlite.Database;
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
  exec(sql: string) {
    this.database.exec(sql);
  }
  close() {
    this.database.close();
  }
  prepare(sql: string) {
    const statement = this.database.prepare(sql);
    // libsql get() includes driver timing metadata on some platforms. Only SQL
    // columns belong in application records or serialized API responses.
    const row = (value: unknown): Row | undefined =>
      value === undefined
        ? undefined
        : Object.fromEntries(
            statement.columns().map(({ name }) => {
              const column = (value as Record<string, Value | ArrayBuffer>)[name];
              // libsql get() returns Buffer while all() returns ArrayBuffer.
              return [name, column instanceof ArrayBuffer ? Buffer.from(column) : column];
            }),
          );
    return {
      get: (...values: Value[]) => row(statement.get(...values)),
      all: (...values: Value[]) => statement.all(...values).map((value) => row(value)!),
      run: (...values: Value[]) => statement.run(...values),
    };
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
