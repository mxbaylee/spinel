import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from '../../server/database.ts';
import { desktopSyncObservation } from './desktop-sync-observation.ts';

test('native sync evidence is bounded, content-free, schema checked and read-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-sync-evidence-'));
  const path = join(directory, 'diagnostics.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE events(received_at INTEGER, file_id TEXT, name TEXT, details TEXT)');
    const insert = db.prepare('INSERT INTO events VALUES(?,?,?,?)');
    const details = {
      reason: 'stale',
      outcome: 'handed-off',
      durationMs: 12,
      pendingCount: 1,
      oldestPendingAgeMs: 30,
    };
    for (let index = 0; index < 260; index++) {
      insert.run(
        index,
        'private-item-id',
        'sync.client.resync',
        JSON.stringify(index === 0 ? { ...details, text: 'private-document-content' } : details),
      );
    }
    insert.run(0, 'private-item-id', 'unknown', JSON.stringify({ token: 'private-token' }));
    const result = desktopSyncObservation(path, ['private-item-id']);
    assert.equal(result.available, true);
    if (!result.available) return;
    assert.equal(result.total, 260);
    assert.equal(result.dropped, 4);
    assert.equal(result.unreadable, 1);
    assert.equal(result.records.length, 255);
    assert.deepEqual(result.records[0], {
      itemOrdinal: 1,
      receivedAt: 1,
      event: { name: 'sync.client.resync', details },
    });
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(db.prepare('SELECT count(*) AS count FROM events').get()?.count, 261);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('missing or malformed diagnostics cannot replace the journey result or create a database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-sync-missing-'));
  try {
    assert.deepEqual(desktopSyncObservation(join(directory, 'missing.sqlite'), []), {
      available: false,
    });
    assert.equal(existsSync(join(directory, 'missing.sqlite')), false);
    const db = new DatabaseSync(join(directory, 'malformed.sqlite'));
    db.close();
    assert.deepEqual(desktopSyncObservation(join(directory, 'malformed.sqlite'), []), {
      available: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
