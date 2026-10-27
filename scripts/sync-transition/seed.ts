import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { TransitionFixtureUnit } from './fixture.ts';
import { publicLegacyModules } from './legacy.ts';

export interface LegacySeed {
  source: string;
  ownerId: string;
  sheetId: string;
  documentId: string;
  nativeId: string;
  queuedPurge: string;
  overlappingText: string;
  units: TransitionFixtureUnit[];
}

// A separate process models the stopped legacy application. Disposed SQLite
// handles must not survive in the process that later verifies source immutability.
const { values } = parseArgs({
  options: { fixture: { type: 'string' }, 'legacy-checkout': { type: 'string' } },
});
assert.ok(values.fixture && values['legacy-checkout']);
const fixture = JSON.parse(readFileSync(values.fixture, 'utf8')) as LegacySeed;
const api = publicLegacyModules(values['legacy-checkout']);
const { adapter, collab, materializer } = api.open(fixture.source);
try {
  for (const unit of fixture.units)
    await collab.createUnitFromData(
      { type: api.type(unit.kind), data: { ...unit.snapshot, rev: 1 } },
      { userID: fixture.ownerId, customData: {} },
    );
  for (const unitId of [fixture.documentId, fixture.queuedPurge])
    await collab.createUnitFromData(
      {
        type: api.type('doc'),
        data: {
          id: unitId,
          rev: 1,
          documentStyle: {},
          body: { dataStream: 'Obsolete legacy generation\r\n' },
        },
      },
      { userID: fixture.ownerId, customData: {} },
    );
  // A pre-cutover legacy instance can outlive a native flag trial. Both stores
  // may then own the same ID, while the native row remains authoritative.
  await collab.createUnitFromData(
    {
      type: api.type('doc'),
      data: {
        id: fixture.nativeId,
        rev: 1,
        documentStyle: {},
        body: { dataStream: fixture.overlappingText },
      },
    },
    { userID: fixture.ownerId, customData: {} },
  );
  assert.ok(
    await adapter.getUnit(
      { userID: fixture.ownerId, customData: {}, request: {} },
      fixture.nativeId,
    ),
  );
  // A real committed tail makes an exporter that reads only the creation
  // snapshot fail the independent native-content check in integration.ts.
  const edited = await collab.submitChangeset(
    {
      changeset: {
        unitID: fixture.sheetId,
        type: api.type('sheet'),
        userID: fixture.ownerId,
        memberID: 'fixture-member',
        sid: 'fixture-source-session',
        reqId: 1,
        baseRev: 1,
        revision: 0,
        mutations: [
          {
            id: 'sheet.mutation.set-range-values',
            data: JSON.stringify({
              unitId: fixture.sheetId,
              subUnitId: 'first',
              cellValue: { 2: { 0: { v: 'Public SDK committed tail' } } },
            }),
          },
        ],
      },
    },
    { userID: fixture.ownerId, memberID: 'fixture-member', customData: {} },
  );
  assert.equal(edited.status, 'committed');
} finally {
  try {
    await materializer.dispose();
  } finally {
    try {
      await collab.dispose();
    } finally {
      await adapter.dispose();
    }
  }
}
