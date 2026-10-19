import { randomUUID } from 'node:crypto';
import { DatabaseSync } from '../../../server/database.ts';
import { afterEach, expect, test } from 'vitest';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { SheetStore } from './sheets.ts';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  databases.push(db);
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const workspace = new WorkspaceStore(auth);
  const sheets = new SheetStore(workspace);
  const item = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const snapshot = {
    id: item.id,
    name: 'Budget',
    appVersion: '1.1.0',
    locale: 'enUS',
    sheetOrder: ['first', 'second'],
    sheets: {
      first: {
        id: 'first',
        name: 'Sheet1',
        rowCount: 100,
        columnCount: 26,
        cellData: { 0: { 0: { v: 4 }, 1: { v: 8, f: '=A1*2', s: 'bold' } } },
      },
      second: { id: 'second', name: 'Sheet2', rowCount: 100, columnCount: 26, cellData: {} },
    },
    styles: { bold: { bl: 1 } },
    resources: [{ name: 'future-plugin', data: 'preserve exactly' }],
  };
  return { db, auth, owner, workspace, sheets, item, snapshot };
}
test('full native snapshot round trip preserves formulas, formatting, tab order and plugin resources', () => {
  const f = fixture();
  expect(f.sheets.load(f.owner.id, f.item.id)).toEqual({
    access: 'owner',
    snapshot: null,
    revision: 0,
  });
  f.sheets.save(f.owner.id, f.item.id, {
    snapshot: f.snapshot,
    revision: 0,
    writeId: randomUUID(),
  });
  expect(new SheetStore(f.workspace).load(f.owner.id, f.item.id)).toEqual({
    access: 'owner',
    snapshot: f.snapshot,
    revision: 1,
  });
});
test('stale device saves and write ID reuse cannot overwrite confirmed edits; exact retries are idempotent', () => {
  const f = fixture();
  const payload = { snapshot: f.snapshot, revision: 0, writeId: randomUUID() };
  expect(f.sheets.save(f.owner.id, f.item.id, payload)).toEqual({ revision: 1 });
  expect(f.sheets.save(f.owner.id, f.item.id, payload)).toEqual({ revision: 1 });
  for (const request of [
    { ...payload, writeId: randomUUID() },
    { ...payload, revision: 1, snapshot: { ...f.snapshot, name: 'changed' } },
  ])
    expect(() => f.sheets.save(f.owner.id, f.item.id, request)).toThrow('newer version');
  expect(f.sheets.load(f.owner.id, f.item.id)).toEqual({
    access: 'owner',
    snapshot: f.snapshot,
    revision: 1,
  });
});
test('failed database writes roll back both content and revision and remain retryable', () => {
  const f = fixture();
  const payload = { snapshot: f.snapshot, revision: 0, writeId: randomUUID() };
  f.db.exec(
    "CREATE TRIGGER fail_update BEFORE UPDATE ON workspace_items BEGIN SELECT RAISE(ABORT, 'disk failure'); END;",
  );
  expect(() => f.sheets.save(f.owner.id, f.item.id, payload)).toThrow('disk failure');
  expect(f.sheets.load(f.owner.id, f.item.id).revision).toBe(0);
  f.db.exec('DROP TRIGGER fail_update');
  expect(f.sheets.save(f.owner.id, f.item.id, payload)).toEqual({ revision: 1 });
});
test('owner, admin and disabled-account boundaries cover snapshot reads and writes', () => {
  const f = fixture();
  for (const user of [f.auth.createUser('Other'), f.auth.createUser('Admin', true)]) {
    expect(() => f.sheets.load(user.id, f.item.id)).toThrow();
    expect(() =>
      f.sheets.save(user.id, f.item.id, {
        snapshot: f.snapshot,
        revision: 0,
        writeId: randomUUID(),
      }),
    ).toThrow();
  }
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.sheets.load(f.owner.id, f.item.id)).toThrow('Sign in');
});
test('invalid IDs, missing sheets, duplicate tabs and oversize data cannot corrupt the stored sheet', () => {
  const f = fixture();
  for (const snapshot of [
    null,
    { ...f.snapshot, id: 'wrong' },
    { ...f.snapshot, sheetOrder: ['missing'] },
    { ...f.snapshot, sheetOrder: ['first', 'first'] },
  ])
    expect(() =>
      f.sheets.save(f.owner.id, f.item.id, { snapshot, revision: 0, writeId: randomUUID() }),
    ).toThrow('Invalid spreadsheet');
  expect(() =>
    f.sheets.save(f.owner.id, f.item.id, {
      snapshot: { ...f.snapshot, padding: 'x'.repeat(10 * 1024 * 1024) },
      revision: 0,
      writeId: randomUUID(),
    }),
  ).toThrow('too large');
  expect(f.sheets.load(f.owner.id, f.item.id).snapshot).toBeNull();
});

test('Sheet image sources cannot bypass item-scoped validation through save or legacy stored data', () => {
  const f = fixture();
  for (const source of [
    'https://outside.invalid/pixel.png',
    `/api/items/other/images/${'a'.repeat(64)}`,
    `/api/items/${f.item.id}/images/${'a'.repeat(64)}`,
  ]) {
    for (const snapshot of [
      {
        ...f.snapshot,
        resources: [
          {
            name: 'SHEET_DRAWING_PLUGIN',
            data: JSON.stringify({ first: { data: { image: { source } } } }),
          },
        ],
      },
      {
        ...f.snapshot,
        sheets: {
          ...f.snapshot.sheets,
          first: { ...f.snapshot.sheets.first, backgroundImage: { source } },
        },
      },
      {
        ...f.snapshot,
        sheets: {
          ...f.snapshot.sheets,
          first: {
            ...f.snapshot.sheets.first,
            cellData: { 0: { 0: { p: { drawings: { image: { source } } } } } },
          },
        },
      },
    ]) {
      expect(() =>
        f.sheets.save(f.owner.id, f.item.id, { snapshot, revision: 0, writeId: randomUUID() }),
      ).toThrow('Insert images from a file');
      f.db
        .prepare('INSERT OR REPLACE INTO sheet_snapshots VALUES(?,?,?,?)')
        .run(f.item.id, JSON.stringify(snapshot), 1, randomUUID());
      expect(() => f.sheets.load(f.owner.id, f.item.id)).toThrow('Insert images from a file');
    }
  }
});
