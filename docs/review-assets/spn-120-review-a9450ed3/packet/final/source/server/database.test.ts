import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'libsql';
import { expect, test } from 'vitest';
import { openDatabase, DatabaseSync, backup } from './database.ts';

test('read-only databases reject data and schema writes and preserve literal filename characters', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-database-readonly-'));
  const path = join(directory, 'Retained ?mode=rw#100% résumé.sqlite');
  const writer = new DatabaseSync(path);
  writer.exec("CREATE TABLE records(value TEXT); INSERT INTO records VALUES('Saved edit')");
  writer.close();
  const reader = new DatabaseSync(path, { readOnly: true });
  try {
    expect(reader.prepare('SELECT value FROM records').get()?.value).toBe('Saved edit');
    expect(() => reader.exec("UPDATE records SET value='Overwritten'")).toThrow(/readonly/i);
    expect(() => reader.prepare('DELETE FROM records').run()).toThrow(/readonly/i);
    expect(() => reader.exec('CREATE TABLE unexpected(id INTEGER)')).toThrow(/readonly/i);
    // Offline export still needs SQLite's consistent copy from a read-only source.
    const copy = join(directory, 'copy.sqlite');
    await backup(reader, copy);
    const copied = new DatabaseSync(copy, { readOnly: true });
    try {
      expect(copied.prepare('SELECT value FROM records').get()?.value).toBe('Saved edit');
    } finally {
      copied.close();
    }
  } finally {
    reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a missing read-only database is refused without creating a file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-database-missing-'));
  const path = join(directory, 'missing.sqlite');
  let reader: DatabaseSync | undefined;
  try {
    expect(() => {
      reader = new DatabaseSync(path, { readOnly: true });
    }).toThrow();
    expect(existsSync(path)).toBe(false);
  } finally {
    reader?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a read-only last connection reads committed WAL data without checkpointing or deleting it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-database-wal-'));
  const path = join(directory, 'retained.sqlite');
  try {
    // A stopped writer leaves a committed WAL without any live connection that
    // could hide the reader's last-close checkpoint. No GC timing is required.
    const seeded = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { openDatabase } from ${JSON.stringify(new URL('./database.ts', import.meta.url).href)};
      const db = openDatabase(process.argv[1]);
      db.exec("PRAGMA wal_autocheckpoint=0; CREATE TABLE latest_edits(value TEXT); INSERT INTO latest_edits VALUES('Committed in WAL')");
      process.exit(0);
    `,
        path,
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(seeded.error).toBeUndefined();
    expect(seeded.status, seeded.stderr).toBe(0);
    const main = readFileSync(path);
    const wal = readFileSync(`${path}-wal`);
    expect(wal.length).toBeGreaterThan(0);
    const reader = new DatabaseSync(path, { readOnly: true });
    try {
      // This table exists only in WAL. exec avoids a retained prepared statement
      // so close exercises the real last-connection boundary synchronously.
      reader.exec('SELECT value FROM latest_edits');
    } finally {
      reader.close();
    }
    expect(readFileSync(path).equals(main), 'main database bytes').toBe(true);
    expect(readFileSync(`${path}-wal`).equals(wal), 'committed WAL bytes').toBe(true);
    const reopened = new DatabaseSync(path, { readOnly: true });
    try {
      expect(reopened.prepare('SELECT value FROM latest_edits').get()?.value).toBe(
        'Committed in WAL',
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

test('two application connections preserve integrity through paired writes, closes and repeated reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-database-reopen-'));
  try {
    // Retain the paired-connection WAL/backup regression from #68 even though
    // sync now shares the application's own SQLite connection.
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
