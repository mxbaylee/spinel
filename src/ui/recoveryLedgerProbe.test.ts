import { expect, test } from 'vitest';
import { RecoveryLedgerProbe } from '../../web/offline/RecoveryLedgerProbe.ts';
import type { IUnitCacheData } from '@univerjs-pro/collaboration-client';

function fixture() {
  const probe = new RecoveryLedgerProbe({
    origin: 'https://localhost:3103',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind: 'doc',
    access: 'owner',
    sdkVersion: '1.1.0',
    schema: 1,
    revisionOffset: 0,
  });
  const record: IUnitCacheData = {
    unitID: 'unit',
    userId: 'owner',
    type: 1,
    rev: 3,
    awaitingChangeset: null,
    mutations: [
      {
        id: 'doc.mutation.rich-text-editing',
        params: { unitId: 'unit', data: new Uint8Array([1, 2]) },
      },
    ],
  };
  probe.begin(record, () => 'owner');
  const copy = probe.read();
  const mutation = copy.mutations[0];
  const claim = probe.ledger!.claim(mutation.id, mutation.params)!;
  probe.ledger!.succeed(claim, true);
  return { probe, record };
}

test('successful accounting and identical observed cache payload prove only the bounded fixture', () => {
  const { probe, record } = fixture();
  probe.writes++;
  probe.verify(structuredClone(record));
  expect(probe.evidence()).toEqual({
    status: 'verified',
    reads: 1,
    writes: 1,
    accounting: { expected: 1, applied: 1, phase: 'complete' },
  });
  expect(probe.access.state.recovered).toBe(false);
  expect(() => probe.access.assertRemote(0, 'write')).toThrow();
  expect(probe.original).toEqual(record);
});
test.each(['absent', 'clear', 'changed', 'no callback'] as const)(
  '%s final queue never claims completion',
  (mode) => {
    const { probe, record } = fixture();
    const before = structuredClone(record);
    const staged = structuredClone(record);
    if (mode === 'changed') staged.mutations.push(structuredClone(staged.mutations[0]));
    if (mode !== 'no callback') probe.writes++;
    expect(() =>
      probe.verify(mode === 'absent' ? undefined : mode === 'clear' ? null : staged),
    ).toThrow(/No identical/);
    expect(probe.status).toBe('failed');
    expect(probe.access.state.phase).toBe('attention');
    expect(probe.original).toEqual(before);
    expect(record).toEqual(before);
  },
);

test('a late duplicate invalidates prior evidence and quarantines subsequent cache writes', () => {
  const { probe, record } = fixture();
  const late = probe.read().mutations[0];
  probe.writes++;
  probe.verify(structuredClone(record));
  expect(() => probe.ledger!.claim(late.id, late.params)).toThrow();
  expect(probe.evidence().status).toBe('failed');
  expect(probe.recovering).toBe(true);
  expect(probe.original).toEqual(record);
});
