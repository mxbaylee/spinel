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

test('a singleton public transformation transfers provenance without replacing retained pending bytes', () => {
  const f = fixture(),
    original = structuredClone(f.record),
    ledger = f.ledger();
  const read = ledger.readForSDK();
  for (const mutation of mutations(read)) {
    const token = ledger.beginTransform([mutation])!;
    const output = { ...mutation, params: { ...mutation.params, expanded: { style: 'resolved' } } };
    ledger.finishTransform(token, [output]);
    const claim = ledger.claim(output.id, output.params)!;
    ledger.succeed(claim, true);
  }
  expect(ledger.readForSDK()).toEqual(original);
  ledger.assertComplete();
  expect(f.record).toEqual(original);
  expect(f.access.state.recovered).toBe(false);
});
test.each([
  'mixed input',
  'multiple originals',
  'output expansion',
  'output missing',
  'wrong output id',
  'wrong output unit',
  'other original alias',
  'cloned dispatch',
  'changed dispatch',
  'original dispatch',
  'duplicate finish',
  'duplicate begin',
  'lock',
  'pipeline failure',
])('%s cannot establish transformed replay provenance', (mode) => {
  const f = fixture(),
    original = structuredClone(f.record),
    ledger = f.ledger();
  const read = ledger.readForSDK(),
    mutation = read.mutations[0];
  expect(() => {
    if (mode === 'mixed input') return ledger.beginTransform([mutation, structuredClone(mutation)]);
    if (mode === 'multiple originals') return ledger.beginTransform(read.mutations);
    const token = ledger.beginTransform([mutation])!;
    if (mode === 'duplicate begin') return ledger.beginTransform([mutation]);
    if (mode === 'pipeline failure') return ledger.rejectTransform();
    if (mode === 'lock') f.access.lock('Changed during decompression');
    const output = {
      ...mutation,
      params: { unitId: mode === 'wrong output unit' ? 'other' : 'unit', expanded: true },
    };
    if (mode === 'wrong output id') output.id = 'different';
    if (mode === 'other original alias') return ledger.finishTransform(token, [read.mutations[1]]);
    ledger.finishTransform(
      token,
      mode === 'output expansion' ? [output, output] : mode === 'output missing' ? [] : [output],
    );
    if (mode === 'duplicate finish') return ledger.finishTransform(token, [output]);
    if (mode === 'cloned dispatch') return ledger.claim(output.id, structuredClone(output.params));
    if (mode === 'original dispatch') return ledger.claim(mutation.id, mutation.params);
    if (mode === 'changed dispatch') output.params.expanded = false;
    return ledger.claim(output.id, output.params);
  }).toThrow();
  expect(f.record).toEqual(original);
  expect(f.access.mayReadLocal).toBe(false);
});
test('unregistered base transformation cannot grant provenance and prepared originals still block completion', () => {
  const f = fixture(),
    ledger = f.ledger(),
    read = ledger.readForSDK();
  expect(ledger.beginTransform([structuredClone(read.mutations[0])])).toBeUndefined();
  const token = ledger.beginTransform([read.mutations[0]])!;
  ledger.finishTransform(token, [structuredClone(read.mutations[0])]);
  expect(() => ledger.assertComplete()).toThrow();
});

test.each([
  'null input',
  'arraylike input',
  'sparse input',
  'throwing input',
  'null output',
  'arraylike output',
  'sparse output',
  'throwing output',
  'changing unit',
  'lock during clone',
])('%s latches transformation failure without publishing malformed provenance', (mode) => {
  const f = fixture(),
    ledger = f.ledger(),
    mutation = ledger.readForSDK().mutations[0];
  expect(() => {
    if (mode === 'null input') return ledger.beginTransform(null as never);
    if (mode === 'arraylike input')
      return ledger.beginTransform({ 0: mutation, length: 1 } as never);
    if (mode === 'sparse input') return ledger.beginTransform(Array(1));
    if (mode === 'throwing input')
      return ledger.beginTransform([
        {
          get id() {
            throw new Error('input getter');
          },
        },
      ] as never);
    const token = ledger.beginTransform([mutation])!;
    if (mode === 'null output') return ledger.finishTransform(token, null as never);
    if (mode === 'arraylike output')
      return ledger.finishTransform(token, { 0: mutation, length: 1 } as never);
    if (mode === 'sparse output') return ledger.finishTransform(token, Array(1));
    let reads = 0;
    const params = {
      get unitId() {
        if (mode === 'throwing output') throw new Error('getter');
        if (mode === 'lock during clone' && ++reads > 1) f.access.lock('Changed during clone');
        return mode === 'changing unit' && ++reads > 1 ? 'other' : 'unit';
      },
    };
    return ledger.finishTransform(token, [{ ...mutation, params }]);
  }).toThrow();
  expect(f.access.mayReadLocal).toBe(false);
  expect(ledger.accounting().phase).toBe('failed');
});

test('a transformed parameter accessor failing later cannot escape the recovery failure latch', () => {
  const f = fixture(),
    ledger = f.ledger(),
    mutation = ledger.readForSDK().mutations[0];
  const token = ledger.beginTransform([mutation])!;
  let fail = false;
  const params = {
    unitId: 'unit',
    get expanded() {
      if (fail) throw new Error('later getter');
      return true;
    },
  };
  ledger.finishTransform(token, [{ ...mutation, params }]);
  fail = true;
  expect(() => ledger.claim(mutation.id, params)).toThrow();
  expect(f.access.mayReadLocal).toBe(false);
  expect(ledger.accounting().phase).toBe('failed');
});

test.each(['begin', 'finish', 'claim', 'options'])(
  '%s cannot authorize replay when validation callbacks lock access',
  (mode) => {
    const f = fixture(),
      ledger = f.ledger(),
      mutation = ledger.readForSDK().mutations[0];
    if (mode === 'begin') {
      const value = (mutation.params as { unitId: string }).unitId;
      Object.defineProperty(mutation.params, 'unitId', {
        enumerable: true,
        get() {
          f.access.lock('Revoked during comparison');
          return value;
        },
      });
      expect(() => ledger.beginTransform([mutation])).toThrow();
    } else {
      const token = ledger.beginTransform([mutation])!;
      let armed = false,
        reads = 0;
      const params = {
        unitId: 'unit',
        get expanded() {
          if (armed || (mode === 'finish' && ++reads === 2))
            f.access.lock('Revoked during comparison');
          return true;
        },
      };
      if (mode === 'finish') {
        expect(() => ledger.finishTransform(token, [{ ...mutation, params }])).toThrow();
      } else {
        ledger.finishTransform(token, [{ ...mutation, params }]);
        armed = mode === 'claim';
        const options =
          mode === 'options'
            ? {
                get fromCollab() {
                  f.access.lock('Revoked while preparing execution options');
                  return false;
                },
              }
            : undefined;
        expect(() => ledger.claim(mutation.id, params, options)).toThrow();
      }
    }
    expect(f.access.mayReadLocal).toBe(false);
    expect(ledger.accounting()).toMatchObject({ phase: 'failed', applied: 0 });
  },
);
