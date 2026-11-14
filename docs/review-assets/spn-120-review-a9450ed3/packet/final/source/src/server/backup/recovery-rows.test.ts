import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { recoveryRows } from './recovery-rows.ts';
import { recoveryInventory } from './inventory.ts';

test('bounded scans preserve composite/null keys, hidden aliases and 64-bit row identity', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE ordinary (a TEXT, b INTEGER, data BLOB, PRIMARY KEY(a,b));
      INSERT INTO ordinary(rowid,a,b,data) VALUES(9223372036854775806,NULL,1,x'01'),(9223372036854775807,NULL,1,x'02'),(3,'z',2,x'03');
      CREATE TABLE hidden (rowid TEXT, _rowid_ TEXT, oid TEXT, id INTEGER PRIMARY KEY, data BLOB);
      INSERT INTO hidden VALUES('a','b','c',2,x'22'),('d','e','f',1,x'11');
      CREATE TABLE composite (a INTEGER, b BLOB, data BLOB, PRIMARY KEY(a,b)) WITHOUT ROWID;
      INSERT INTO composite VALUES(9223372036854775807,x'02',x'22'),(9223372036854775806,x'01',x'11');
      CREATE TABLE plain (value BLOB); INSERT INTO plain VALUES(x'01'),(x'02');`);
    for (const [table, order] of [
      ['ordinary', 'a,b'],
      ['hidden', 'id'],
      ['composite', 'a,b'],
      ['plain', 'rowid'],
    ]) {
      const projection = table === 'composite' ? 'CAST(a AS TEXT) AS a,b,data' : '*';
      expect([...recoveryRows(db, table, projection)]).toEqual([
        ...db.iterate(`SELECT ${projection} FROM ${table} ORDER BY ${order}`),
      ]);
    }
    // Golden inventory captured from the pre-repair implementation; changing
    // read strategy must not invalidate existing archives or durable witnesses.
    expect(recoveryInventory(db)).toEqual(GOLDEN);
  } finally {
    db.close();
  }
});

test('a native process inventories 512 MiB of payloads below the unchanged 512 MiB worker ceiling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-bounded-rows-'));
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        '--max-old-space-size=256',
        fileURLToPath(new URL('./recovery-rows-fixture.ts', import.meta.url)),
        directory,
      ],
      { timeout: 30_000, maxBuffer: 4096 },
    );
    const measured = JSON.parse(result.stdout);
    expect(measured.rows).toBe(128);
    expect(measured.peakKiB).toBeLessThan(512 * 1024);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 35_000);

const GOLDEN = {
  format: 1,
  schema: '1449453c76aec056d6ea8a250a717c660edf08c6b8caddd2cc9cd2f3ffe232bb',
  tables: [
    {
      name: 'composite',
      rows: 2,
      sha256: '33768e76aea031514e22dfc981f88658dfa4c01cd7025a30ce5d205d881ff30f',
    },
    {
      name: 'hidden',
      rows: 2,
      sha256: '77dc406564669d89bbec50ddcda348c78f3f6f81fcbcd5378bcdceafa7ad412f',
    },
    {
      name: 'ordinary',
      rows: 3,
      sha256: '93ee404ee22eacc540f4be3cb96a6eabfbc902c87750d95b01a65a45adbb3235',
    },
    {
      name: 'plain',
      rows: 2,
      sha256: '3556207ea95580212ff917a8fc5b44461343c0c925b0d686a5f99bfe598f8920',
    },
  ],
};
