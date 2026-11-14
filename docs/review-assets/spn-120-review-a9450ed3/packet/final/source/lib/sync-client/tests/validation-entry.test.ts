import { expect, test, vi } from 'vitest';
import { MAX_BATCH_MUTATIONS, MAX_PENDING_BYTES, MAX_WIRE_BYTES } from '../src/types.ts';
import type { ClientCheckpoint, SubmitFrame } from '../src/types.ts';

vi.mock('@univerjs/core', () => {
  throw new Error('Pre-editor admission must not load the native SDK.');
});
vi.mock('@spinel/sync-transform', () => {
  throw new Error('Pre-editor admission must not load the transform graph.');
});

test('the public validation entry inspects retained data without loading a native editor graph', async () => {
  const { validateNativeSnapshot, validateRecoverySnapshot, validateCheckpoint } =
    await import('../validation.ts');
  const snapshot = { id: 'sheet', sheets: {}, sheetOrder: [] };
  expect(() => validateNativeSnapshot(snapshot as never, 'sheet')).not.toThrow();
  expect(() =>
    validateRecoverySnapshot({
      version: 1,
      unitId: 'sheet',
      revision: 1,
      snapshot,
      sent: null,
      inflight: [],
      buffer: [],
      failure: 'refused',
      recoverySnapshot: snapshot,
    } as never),
  ).not.toThrow();
  expect(() =>
    validateNativeSnapshot({ ...snapshot, sheets: { missing: null } } as never, 'sheet'),
  ).toThrow();
  expect(() => validateCheckpoint(checkpoint(), 'sheet', 2)).not.toThrow();
});

const mutation = (value = 'Retained edit') => ({
  id: 'sheet.mutation.set-range-values',
  params: { unitId: 'sheet', subUnitId: 'one', cellValue: { 0: { 0: { v: value } } } },
});
const checkpoint = (overrides: Partial<ClientCheckpoint> = {}): ClientCheckpoint => ({
  version: 1,
  unitId: 'sheet',
  revision: 2,
  snapshot: { id: 'sheet', sheets: {}, sheetOrder: [] } as unknown as ClientCheckpoint['snapshot'],
  sent: null,
  inflight: [],
  buffer: [],
  ...overrides,
});
const sent = (): SubmitFrame => ({
  type: 'submit',
  mutationId: 'retained:1',
  baseRevision: 1,
  mutations: [mutation()],
});

test.each([
  ['wrong version', (value: ClientCheckpoint): unknown => (value.version = 2 as never)],
  ['wrong unit', (value: ClientCheckpoint): unknown => (value.unitId = 'other')],
  ['wrong revision', (value: ClientCheckpoint): unknown => (value.revision = 1)],
  ['wrong snapshot', (value: ClientCheckpoint): unknown => (value.snapshot.id = 'other')],
  ['empty group', (value: ClientCheckpoint): unknown => (value.buffer = [[]])],
  ['unknown failure', (value: ClientCheckpoint): unknown => (value.failure = 'unknown' as never)],
  ['missing envelope', (value: ClientCheckpoint): unknown => (value.sent = undefined as never)],
  ['orphan inflight', (value: ClientCheckpoint): unknown => (value.inflight = [mutation()])],
  [
    'unmarked missing recovery',
    (value: ClientCheckpoint): unknown => (value.recoveryMissing = true),
  ],
  [
    'conflicting recovery flags',
    (value: ClientCheckpoint): void => {
      value.failure = 'refused';
      value.recoveryMissing = true;
      value.recoverySnapshot = value.snapshot;
    },
  ],
  [
    'foreign buffered root',
    (value: ClientCheckpoint): void => {
      value.buffer = [[mutation()]];
      value.buffer[0][0].params.unitId = 'other';
    },
  ],
] as const)(
  'pure checkpoint admission refuses %s before editor construction',
  async (_, corrupt) => {
    const { validateCheckpoint } = await import('../validation.ts');
    const value = checkpoint();
    corrupt(value);
    expect(() => validateCheckpoint(value, 'sheet', 2)).toThrow('Sync malformed');
  },
);

test.each([
  [
    'invalid request identity',
    (value: SubmitFrame): unknown => (value.mutationId = 'invalid identity'),
  ],
  [
    'oversized request identity',
    (value: SubmitFrame): unknown => (value.mutationId = 'x'.repeat(129)),
  ],
  ['future base', (value: SubmitFrame): unknown => (value.baseRevision = 3)],
  ['invalid base', (value: SubmitFrame): unknown => (value.baseRevision = 0)],
  ['reconnect-only field', (value: SubmitFrame): unknown => (value.expectedRevision = 2)],
  ['unexpected field', (value: SubmitFrame): unknown => Object.assign(value, { extra: true })],
  ['empty request', (value: SubmitFrame): unknown => (value.mutations = [])],
  [
    'too many request mutations',
    (value: SubmitFrame): unknown =>
      (value.mutations = Array(MAX_BATCH_MUTATIONS + 1).fill(mutation())),
  ],
  [
    'oversized request bytes',
    (value: SubmitFrame): unknown => (value.mutations = [mutation('x'.repeat(MAX_WIRE_BYTES))]),
  ],
  [
    'foreign request root',
    (value: SubmitFrame): unknown => (value.mutations[0].params.unitId = 'other'),
  ],
] as const)('pure checkpoint admission refuses %s in an immutable retry', async (_, corrupt) => {
  const { validateCheckpoint } = await import('../validation.ts');
  const request = sent();
  const value = checkpoint({ sent: request, inflight: [mutation()] });
  expect(() => validateCheckpoint(value, 'sheet', 2)).not.toThrow();
  corrupt(request);
  expect(() => validateCheckpoint(value, 'sheet', 2)).toThrow('Sync malformed');
});

test('pure checkpoint admission preserves aggregate and individual queue budgets', async () => {
  const { validateCheckpoint } = await import('../validation.ts');
  const bounded = checkpoint({
    buffer: Array.from({ length: 32 }, () => Array.from({ length: 256 }, () => mutation())),
  });
  expect(() => validateCheckpoint(bounded, 'sheet', 2)).not.toThrow();
  bounded.buffer.push([mutation()]);
  expect(() => validateCheckpoint(bounded, 'sheet', 2)).toThrow('Sync capacity');
  expect(() =>
    validateCheckpoint(
      checkpoint({ buffer: [Array(MAX_BATCH_MUTATIONS + 1).fill(mutation())] }),
      'sheet',
      2,
    ),
  ).toThrow('Sync capacity');
  const large = mutation('x'.repeat(60 * 1024));
  expect(() => validateCheckpoint(checkpoint({ buffer: [[large]] }), 'sheet', 2)).not.toThrow();
  expect(() =>
    validateCheckpoint(
      checkpoint({ buffer: Array.from({ length: 180 }, () => [large]) }),
      'sheet',
      2,
    ),
  ).toThrow('Sync capacity');
  const oversizedSnapshot = checkpoint();
  Object.assign(oversizedSnapshot.snapshot, { name: 'x'.repeat(MAX_PENDING_BYTES) });
  expect(() => validateCheckpoint(oversizedSnapshot, 'sheet', 2)).toThrow('Sync capacity');
});

test('buffer admission reserves future wire overhead while an exact saved request keeps its boundary', async () => {
  const { validateCheckpoint } = await import('../validation.ts');
  const edit = mutation('');
  const request: SubmitFrame = {
    type: 'submit',
    mutationId: '00000000-0000-4000-8000-000000000000',
    baseRevision: 1,
    mutations: [edit],
  };
  edit.params.cellValue[0][0].v = 'x'.repeat(
    MAX_WIRE_BYTES - new TextEncoder().encode(JSON.stringify(request)).length,
  );
  expect(new TextEncoder().encode(JSON.stringify(request)).length).toBe(MAX_WIRE_BYTES);
  expect(() =>
    validateCheckpoint(checkpoint({ sent: request, inflight: [edit] }), 'sheet', 2),
  ).not.toThrow();
  // A newly queued group must also fit the maximum revision and reconnect fence.
  expect(() => validateCheckpoint(checkpoint({ buffer: [[edit]] }), 'sheet', 2)).toThrow(
    'Sync capacity',
  );
});

test('checkpoint identity validation leaves nested application IDs opaque', async () => {
  const { validateCheckpoint } = await import('../validation.ts');
  const edit = mutation();
  Object.assign(edit.params, { custom: { unitId: 'a-different-document' } });
  const value = checkpoint({ buffer: [[edit]], failure: 'refused', recoveryMissing: true });
  expect(() => validateCheckpoint(value, 'sheet', 2)).not.toThrow();
  expect(() => validateCheckpoint(checkpoint({ revision: 0 }), 'sheet', 0)).toThrow(
    'Sync malformed',
  );
});
