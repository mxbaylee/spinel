import { expect, test } from 'vitest';
import type { IUnitCacheData } from '@univerjs-pro/collaboration-client';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import { RecoveryLedger } from '../../web/offline/RecoveryLedger.ts';

const text = 'doc.mutation.rich-text-editing';
function fixture(role: 'owner' | 'viewer' | 'editor' = 'owner') {
  const scope = {
    origin: 'https://spinel.example',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind: 'doc' as const,
    access: role,
    sdkVersion: '1.1.0' as const,
    schema: 1 as const,
    revisionOffset: 0,
  };
  const access = new OfflineAccess(scope, async () => ({ ...scope, restoring: false }));
  let account: string | null = 'owner';
  const mutation = () => ({
    id: text,
    type: 2,
    params: { unitId: 'unit', actions: ['same content'] },
  });
  const record: IUnitCacheData = {
    unitID: 'unit',
    userId: 'owner',
    type: 1,
    rev: 3,
    mutations: [mutation(), mutation()],
    awaitingChangeset: {
      unitID: 'unit',
      type: 1,
      userID: 'owner',
      sid: 'original',
      reqId: 7,
      baseRev: 2,
      revision: 0,
      memberID: 'member',
      mutations: [mutation()],
    },
  };
  const ledger = () => new RecoveryLedger(access, 8, record, () => account);
  return {
    access,
    record,
    ledger,
    account: (next: string | null) => {
      account = next;
    },
  };
}
function mutations(record: IUnitCacheData) {
  return [...record.mutations, ...(record.awaitingChangeset?.mutations ?? [])];
}
test('multiple read copies count original entries once, including identical adjacent edits', () => {
  const f = fixture('editor');
  const original = structuredClone(f.record);
  const ledger = f.ledger();
  ledger.readForSDK(); // revision-selection read is not a replay
  const read = ledger.readForSDK();
  const ids = new Set<string>();
  for (const mutation of mutations(read)) {
    const options = { fromCollab: false };
    const claim = ledger.claim(mutation.id, mutation.params, options)!;
    expect(claim.options).toMatchObject({ fromChangeset: true, fromCollab: false });
    expect(options).toEqual({ fromCollab: false });
    ids.add(claim.entry);
    ledger.succeed(claim, true);
  }
  expect(ids.size).toBe(3);
  ledger.assertComplete();
  expect(f.record).toEqual(original);
  expect(read).toEqual(original);
  // Ledger completion alone must not claim a durable recovered editor.
  expect(f.access.state.recovered).toBe(false);
  f.access.dispose();
});
test.each(['same object', 'another read', 'after complete'])(
  'duplicate replay via %s fails closed',
  (kind) => {
    const f = fixture(),
      ledger = f.ledger();
    const read = ledger.readForSDK();
    for (const mutation of mutations(read))
      ledger.succeed(ledger.claim(mutation.id, mutation.params)!, true);
    if (kind === 'after complete') ledger.assertComplete();
    const mutation = (kind === 'another read' ? ledger.readForSDK() : read).mutations[0];
    expect(() => ledger.claim(mutation.id, mutation.params)).toThrow();
    expect(f.access.state.phase).toBe('attention');
    f.access.dispose();
  },
);
test.each(['unclaimed', 'executing', 'sync-only'])('%s entries prevent completion', (kind) => {
  const f = fixture(),
    ledger = f.ledger(),
    read = ledger.readForSDK();
  if (kind === 'executing') ledger.claim(read.mutations[0].id, read.mutations[0].params);
  if (kind === 'sync-only')
    expect(
      ledger.claim(read.mutations[0].id, read.mutations[0].params, { syncOnly: true }),
    ).toBeUndefined();
  expect(() => ledger.assertComplete()).toThrow();
  expect(f.access.state.recovered).toBe(false);
  f.access.dispose();
});
test.each(['clone', 'modified', 'wrong command', 'false', 'throw', 'switch', 'lock'])(
  '%s cannot release recovered work',
  (kind) => {
    const f = fixture(),
      ledger = f.ledger(),
      read = ledger.readForSDK(),
      original = structuredClone(f.record);
    const mutation = read.mutations[0];
    expect(() => {
      if (kind === 'clone') return ledger.claim(mutation.id, structuredClone(mutation.params));
      if (kind === 'modified') (mutation.params as { actions: string[] }).actions.push('changed');
      if (kind === 'switch') f.account('other');
      if (kind === 'lock') f.access.lock('Signed out.');
      const claim = ledger.claim(
        kind === 'wrong command' ? 'other' : mutation.id,
        mutation.params,
      )!;
      if (kind === 'false') ledger.succeed(claim, false);
      if (kind === 'throw') ledger.reject(claim, new Error('SDK refused'));
    }).toThrow();
    expect(f.record).toEqual(original);
    expect(f.access.mayReadLocal).toBe(false);
    f.access.dispose();
  },
);
test('base changesets do not impersonate cached replay and cannot satisfy its ledger', () => {
  const f = fixture(),
    ledger = f.ledger(),
    read = ledger.readForSDK(),
    mutation = read.mutations[0];
  expect(
    ledger.claim(mutation.id, structuredClone(mutation.params), { fromChangeset: true }),
  ).toBeUndefined();
  expect(() => ledger.assertComplete()).toThrow();
  f.access.dispose();
});
test('viewer pending edits are isolated without a permission-bypassing replay', () => {
  const f = fixture('viewer');
  expect(f.ledger).toThrow();
  expect(f.access.state.phase).toBe('attention');
  f.access.dispose();
});
test.each(['unit', 'account', 'type', 'revision', 'awaiting user', 'awaiting unit'])(
  'rejects %s mismatch without rewriting record identity',
  (kind) => {
    const f = fixture();
    if (kind === 'unit') f.record.unitID = 'other';
    if (kind === 'account') f.record.userId = 'other';
    if (kind === 'type') f.record.type = 2;
    if (kind === 'revision') f.record.rev = -1;
    if (kind === 'awaiting user') f.record.awaitingChangeset!.userID = 'other';
    if (kind === 'awaiting unit') f.record.awaitingChangeset!.unitID = 'other';
    const original = structuredClone(f.record);
    expect(f.ledger).toThrow();
    expect(f.record).toEqual(original);
    f.access.dispose();
  },
);
test('parameter integrity distinguishes bytes and values JSON would normalize', () => {
  for (const change of ['bytes', 'nan', 'missing']) {
    const f = fixture();
    f.record.mutations[0].params = {
      unitId: 'unit',
      bytes: new Uint8Array([1, 2]),
      number: NaN,
      optional: undefined,
    };
    const ledger = f.ledger(),
      mutation = ledger.readForSDK().mutations[0];
    const params = mutation.params as {
      bytes: Uint8Array;
      number: number | null;
      optional?: undefined;
    };
    if (change === 'bytes') params.bytes[0] = 3;
    if (change === 'nan') params.number = null;
    if (change === 'missing') delete params.optional;
    expect(() => ledger.claim(mutation.id, mutation.params)).toThrow();
    f.access.dispose();
  }
});

test.each(['null mutation', 'sparse array', 'null record', 'non-cloneable'])(
  'corrupt %s locks recovery explicitly',
  (kind) => {
    const f = fixture();
    const record = f.record;
    if (kind === 'null mutation') record.mutations[0] = null as never;
    if (kind === 'sparse array') delete record.mutations[0];
    if (kind === 'non-cloneable')
      record.mutations[0].params = { unitId: 'unit', callback: () => {} };
    expect(
      () =>
        new RecoveryLedger(
          f.access,
          1,
          kind === 'null record' ? (null as never) : record,
          () => 'owner',
        ),
    ).toThrow();
    expect(f.access.state.phase).toBe('attention');
    f.access.dispose();
  },
);
test.each(['read', 'claim'])('%s rechecks access after account lookup callbacks', (kind) => {
  const f = fixture();
  let lock = false;
  const ledger = new RecoveryLedger(f.access, 1, f.record, () => {
    if (lock) f.access.lock('Signed out.');
    return 'owner';
  });
  const mutation = ledger.readForSDK().mutations[0];
  lock = true;
  expect(() =>
    kind === 'read' ? ledger.readForSDK() : ledger.claim(mutation.id, mutation.params),
  ).toThrow();
  expect(f.access.state.phase).toBe('locked');
  f.access.dispose();
});

test('a failed account lookup latches recovery failure', () => {
  const f = fixture();
  expect(
    () =>
      new RecoveryLedger(f.access, 1, f.record, () => {
        throw new Error('disposed');
      }),
  ).toThrow();
  expect(f.access.state.phase).toBe('attention');
  f.access.dispose();
});

test.each([false, 0, ''])('malformed awaiting value %s is not treated as absent', (value) => {
  const f = fixture();
  f.record.awaitingChangeset = value as never;
  expect(f.ledger).toThrow();
  expect(f.access.state.phase).toBe('attention');
  f.access.dispose();
});
