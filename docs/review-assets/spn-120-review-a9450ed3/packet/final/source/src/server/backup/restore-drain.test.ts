import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { captureTerminalRestoreFingerprint } from './restore-drain.ts';
import { restoreSnapshotFingerprint } from './inventory.ts';
import { MaintenanceGate } from '../maintenance/gate.ts';

test('terminal capture sees final writes and permanently denies later writes including lifecycle work', () => {
  const db = new DatabaseSync(':memory:');
  const gate = new MaintenanceGate();
  db.setMaintenanceGate(gate);
  try {
    db.exec(
      "CREATE TABLE final_state(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO final_state VALUES(1,'before')",
    );
    const before = restoreSnapshotFingerprint(db);
    db.prepare('UPDATE final_state SET value=?').run('flushed');
    const final = captureTerminalRestoreFingerprint(db);
    expect(final).not.toBe(before);
    expect(final).toBe(restoreSnapshotFingerprint(db));
    db.assertQuiescent();
    for (const write of [
      () => db.exec('DELETE FROM final_state'),
      () => db.prepare('UPDATE final_state SET value=? RETURNING value').get('late'),
      () => gate.initialize(() => db.prepare('DELETE FROM final_state').run()),
    ])
      expect(write).toThrow('sealed');
    expect(db.prepare('SELECT value FROM final_state').get()!.value).toBe('flushed');
  } finally {
    db.close();
  }
});

test('an unfinished transaction cannot become a final witness', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('BEGIN; CREATE TABLE pending(id INTEGER PRIMARY KEY)');
    expect(() => captureTerminalRestoreFingerprint(db)).toThrow('transaction');
    db.exec('ROLLBACK');
    expect(() => db.exec('CREATE TABLE late(id INTEGER PRIMARY KEY)')).toThrow('sealed');
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='pending'").get()).toBeUndefined();
  } finally {
    db.close();
  }
});

test('inventory refusal rolls back its read transaction without reopening writes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (let i = 0; i < 257; i++) db.exec(`CREATE TABLE many_${i}(id INTEGER PRIMARY KEY)`);
    expect(() => captureTerminalRestoreFingerprint(db)).toThrow('table limit');
    db.assertQuiescent();
    expect(() => db.exec('DROP TABLE many_0')).toThrow('sealed');
  } finally {
    db.close();
  }
});
