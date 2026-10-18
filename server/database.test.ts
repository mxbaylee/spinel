import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Sqlite from 'libsql';
import { expect, test } from 'vitest';
import { openDatabase, DatabaseSync, backup } from './database.ts';

test('application and SDK adapter resolve the same native SQLite package', () => {
  const require = createRequire(import.meta.url);
  const sdk = createRequire(require.resolve('@univerjs-pro/collaboration-database-sqlite'));
  expect(sdk.resolve('libsql')).toBe(require.resolve('libsql'));
});

test('single-row reads expose only SQL columns, consistently with multi-row reads', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE TABLE records(id INTEGER, name TEXT, content BLOB)');
    database.prepare('INSERT INTO records VALUES(?,?,?)').run(1, 'Document', Buffer.from('data'));
    const statement = database.prepare('SELECT id, name AS title, content FROM records WHERE id=?');
    const result = statement.get(1);
    expect(Object.keys(result!).sort()).toEqual(['content', 'id', 'title']);
    expect(result).toEqual(statement.all(1)[0]);
    expect(statement.get(1)).toEqual(result);
    expect(statement.get(2)).toBeUndefined();
  } finally {
    database.close();
  }
});

test('app and SDK-runtime connections preserve integrity through paired writes, closes and repeated reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-database-reopen-'));
  try {
    // Two SQLite implementations in one process failed this sequence (#68).
    // Exercise the same public libsql connection boundary as the SDK adapter.
    for (let round = 0; round < 5; round++) {
      const app = openDatabase(join(directory, 'data.sqlite'));
      const sdk = new Sqlite(join(directory, 'data.sqlite'));
      try {
        app.exec('CREATE TABLE IF NOT EXISTS app_data(id INTEGER PRIMARY KEY,data BLOB) STRICT');
        sdk.exec('CREATE TABLE IF NOT EXISTS sdk_data(id INTEGER PRIMARY KEY,data BLOB) STRICT');
        for (let id = 0; id < 100; id++) {
          app
            .prepare('INSERT OR REPLACE INTO app_data VALUES(?,?)')
            .run(id, Buffer.alloc(5000, round));
          sdk
            .prepare('INSERT OR REPLACE INTO sdk_data VALUES(?,?)')
            .run(id, Buffer.alloc(5000, round));
        }
        expect(app.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
        expect(sdk.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
        const copy = join(directory, `snapshot-${round}.sqlite`);
        await backup(app, copy);
        const snapshot = new DatabaseSync(copy);
        try {
          expect(snapshot.prepare('PRAGMA integrity_check').all()).toEqual([
            { integrity_check: 'ok' },
          ]);
          expect(snapshot.prepare('SELECT count(*) AS n FROM app_data').get()?.n).toBe(100);
          expect(snapshot.prepare('SELECT count(*) AS n FROM sdk_data').get()?.n).toBe(100);
          expect(
            Buffer.from(
              snapshot.prepare('SELECT data FROM sdk_data WHERE id=99').get()!.data as Uint8Array,
            ),
          ).toEqual(Buffer.alloc(5000, round));
        } finally {
          snapshot.close();
        }
      } finally {
        sdk.close();
        expect(app.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
        app.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
