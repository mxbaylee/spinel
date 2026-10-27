import { afterEach, expect, test } from 'vitest';
import { ICommandService, JSONX, TextX } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import { createNativeSyncClient, NativeReplica } from '../index.ts';
import type {
  ClientCheckpoint,
  ClientFailure,
  DocumentKind,
  NativeSyncOptions,
  OutgoingFrame,
  SubmitFrame,
} from '../index.ts';
import { book, comparable, doc, fixture, turns, wire, write } from './fixture.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

function restore(
  checkpoint: ClientCheckpoint,
  kind: DocumentKind = 'sheet',
  overrides: Partial<NativeSyncOptions> = {},
) {
  const visible = new NativeReplica(checkpoint.snapshot, kind);
  cleanup.push(() => visible.dispose());
  const outgoing: OutgoingFrame[] = [];
  const failures: ClientFailure[] = [];
  const saved: ClientCheckpoint[] = [];
  const sync = createNativeSyncClient({
    univer: visible.univer,
    unitId: checkpoint.unitId,
    kind,
    snapshot: checkpoint.snapshot,
    revision: checkpoint.revision,
    checkpoint,
    preservePendingOnFailure: true,
    requireUnchangedResume: true,
    batchDelayMs: 100_000,
    send: (frame) => outgoing.push(frame),
    onState() {},
    onResync: (reason) => failures.push(reason),
    persist: async (value) => {
      saved.push(structuredClone(value));
    },
    ...overrides,
  });
  cleanup.push(() => sync.dispose());
  return {
    sync,
    visible,
    outgoing,
    failures,
    saved,
    submits: () => outgoing.filter((frame): frame is SubmitFrame => frame.type === 'submit'),
    resume(revision = checkpoint.revision, edits: ReturnType<typeof wire>[] = []) {
      sync.setConnected(true);
      sync.receive({
        type: 'resume',
        version: 1,
        unitId: checkpoint.unitId,
        fromRevision: sync.confirmedRevision,
        revision,
        edits,
      });
    },
  };
}

function insertText(): Mutation {
  const text = new TextX();
  text.push({ t: 'i' as never, len: 8, body: { dataStream: 'Offline ' } });
  return {
    id: 'doc.mutation.rich-text-editing',
    params: {
      unitId: 'doc',
      actions: JSONX.getInstance().editOp(text.serialize()),
      textRanges: [],
      trigger: 'doc.command.insert-text',
    },
  };
}

test.each(['sheet', 'doc'] as const)(
  '%s pending edits survive two offline restores and one durable replay without recapture',
  async (kind) => {
    const f = fixture(kind === 'sheet' ? book() : doc(), kind);
    cleanup.push(() => f.close());
    const source = f.client();
    source.edit([kind === 'sheet' ? write({ v: 'Offline' }) : insertText()]);
    const intended = comparable(source.live.snapshot());
    const first = restore(source.sync.checkpoint(), kind);
    expect(comparable(first.visible.snapshot())).toEqual(intended);
    expect(first.sync.state.pendingMutations).toBe(1);
    await first.sync.persistNow();
    const second = restore(first.saved.at(-1)!, kind);
    expect(comparable(second.visible.snapshot())).toEqual(intended);
    expect(second.sync.state.pendingMutations).toBe(1);
    second.sync.setConnected(true);
    second.sync.retry();
    expect(second.submits()).toEqual([]);
    second.resume();
    await turns();
    second.sync.retry();
    await turns();
    const request = second.submits()[0];
    expect(request.expectedRevision).toBe(1);
    expect(second.sync.checkpoint().sent).not.toHaveProperty('expectedRevision');
    const result = await f.accept(request);
    second.sync.receive({ type: 'edit', ...wire(result.edit) });
    second.sync.receive({
      type: 'ack',
      mutationId: request.mutationId,
      duplicate: false,
      ...wire(result.edit),
    });
    await turns();
    expect(second.sync.state).toMatchObject({ pending: false, localPersistence: 'saved' });
    expect(second.saved.at(-1)).toMatchObject({ revision: 2, sent: null, buffer: [] });
    expect(comparable(f.storage.unit.snapshot)).toEqual(intended);
    expect(comparable(second.visible.snapshot())).toEqual(intended);
    // The replay guard is not the mutation's identity: an ordinary protocol
    // retry of its original envelope finds the same durable receipt.
    const { expectedRevision: _guard, ...original } = request;
    expect((await f.accept(original)).duplicate).toBe(true);
    expect(f.storage.history).toHaveLength(1);
    expect(second.failures).toEqual([]);
  },
);

test('a lost acknowledgement retains the original queue as attention after restart', async () => {
  const f = fixture();
  cleanup.push(() => f.close());
  const source = f.client();
  source.edit([write({ v: 'Do not lose this' })]);
  const first = restore(source.sync.checkpoint());
  first.resume();
  await turns();
  first.sync.retry();
  await turns();
  const sent = first.submits()[0];
  await f.accept(sent);
  const beforeCrash = first.sync.checkpoint();
  const reopened = restore(beforeCrash);
  reopened.resume(2, f.storage.history.map(wire));
  await turns();
  expect(reopened.submits()).toEqual([]);
  expect(reopened.failures).toEqual(['stale']);
  expect(reopened.sync.checkpoint()).toEqual({ ...beforeCrash, failure: 'stale' });
  expect(f.storage.history).toHaveLength(1);
  const attention = restore(reopened.sync.checkpoint());
  attention.resume();
  attention.sync.retry();
  await turns();
  expect(attention.submits()).toEqual([]);
  expect(attention.sync.state).toMatchObject({ resyncing: true, pending: true, failure: 'stale' });
  expect(comparable(attention.visible.snapshot())).toEqual(comparable(source.live.snapshot()));
});

test('a peer committing after equal resume but before initial send stops replay', async () => {
  const f = fixture();
  cleanup.push(() => f.close());
  const source = f.client();
  source.edit([write({ v: 'Keep offline' })]);
  const checkpoint = source.sync.checkpoint();
  const restarted = restore(checkpoint);
  restarted.resume();
  // Deliver before the serialized disk write can build/send the first envelope.
  restarted.sync.receive({
    type: 'edit',
    revision: 2,
    mutations: [write({ v: 'Peer' }, 2)],
    touched: { kind: 'sheet', cells: [{ sheetId: 'one', row: 2, column: 0 }] },
    hash: 'a'.repeat(64),
  });
  await turns();
  expect(restarted.submits()).toEqual([]);
  expect(restarted.sync.checkpoint()).toEqual({ ...checkpoint, failure: 'stale' });
  expect(restarted.failures).toEqual(['stale']);
});

test('successful first replay releases normal live peer rebasing', async () => {
  const f = fixture();
  cleanup.push(() => f.close());
  const source = f.client();
  source.edit([write({ v: 'Offline' })]);
  const restarted = restore(source.sync.checkpoint());
  restarted.resume();
  await turns();
  restarted.sync.retry();
  await turns();
  const first = restarted.submits()[0];
  const accepted = await f.accept(first);
  restarted.sync.receive({
    type: 'ack',
    mutationId: first.mutationId,
    duplicate: false,
    ...wire(accepted.edit),
  });
  await turns();
  const commands = restarted.visible.univer.__getInjector().get(ICommandService);
  const local = write({ v: 'Live' }, 4);
  commands.syncExecuteCommand(local.id, local.params);
  restarted.sync.retry();
  await turns();
  restarted.sync.retry();
  await turns();
  const next = restarted.submits().at(-1)!;
  expect(next.mutationId).not.toBe(first.mutationId);
  expect(next).not.toHaveProperty('expectedRevision');
  const peer = await f.accept(
    {
      type: 'submit',
      mutationId: 'peer',
      baseRevision: 2,
      mutations: [write({ v: 'Peer' }, 5)],
    },
    'peer',
  );
  restarted.sync.receive({ type: 'edit', ...wire(peer.edit) });
  const mine = await f.accept(next);
  restarted.sync.receive({
    type: 'ack',
    mutationId: next.mutationId,
    duplicate: false,
    ...wire(mine.edit),
  });
  await turns();
  expect(restarted.failures).toEqual([]);
  expect(comparable(restarted.visible.snapshot())).toEqual(comparable(f.storage.unit.snapshot));
});

test('failed local persistence is visible and can retry while disconnected', async () => {
  const f = fixture();
  cleanup.push(() => f.close());
  let failed = true;
  const saved: ClientCheckpoint[] = [];
  const source = f.client({
    persist: async (checkpoint) => {
      if (failed) throw new Error('Quota exceeded');
      saved.push(checkpoint);
    },
  });
  source.edit([write({ v: 'Disk first' })]);
  expect(source.sync.state.localPersistence).toBe('saving');
  await turns();
  expect(source.sync.state.localPersistence).toBe('failed');
  expect(source.sync.state.pending).toBe(true);
  failed = false;
  source.sync.retry();
  await turns();
  expect(source.sync.state).toMatchObject({
    localPersistence: 'saved',
    connected: false,
    pending: true,
  });
  expect(saved.at(-1)!.buffer.flat()).toEqual([write({ v: 'Disk first' })]);
  expect(source.submits()).toEqual([]);
});

test('failure after a native confirmed apply preserves the coherent pre-frame checkpoint', async () => {
  const f = fixture();
  cleanup.push(() => f.close());
  const source = f.client({
    preservePendingOnFailure: true,
    applyRemote() {
      throw new Error('Native renderer refused the next handler');
    },
  });
  source.resume();
  await turns();
  source.edit([write({ v: 'Mine' })]);
  const checkpoint = source.sync.checkpoint();
  const peer = await f.accept(
    {
      type: 'submit',
      mutationId: 'peer-partial',
      baseRevision: 1,
      mutations: [write({ v: 'Peer' }, 2)],
    },
    'peer',
  );
  source.sync.receive({ type: 'edit', ...wire(peer.edit) });
  await turns();
  expect(source.sync.checkpoint()).toEqual({ ...checkpoint, failure: 'malformed' });
  const reopened = restore(source.sync.checkpoint());
  expect(comparable(reopened.visible.snapshot())).toEqual(comparable(source.live.snapshot()));
  expect(source.failures).toEqual(['malformed']);
});

test.each([
  (checkpoint: ClientCheckpoint) => {
    checkpoint.unitId = 'another';
  },
  (checkpoint: ClientCheckpoint) => {
    checkpoint.snapshot.id = 'another';
  },
  (checkpoint: ClientCheckpoint) => {
    checkpoint.buffer[0][0].params.unitId = 'another';
  },
  (checkpoint: ClientCheckpoint) => {
    checkpoint.buffer[0][0].id = 'unknown.mutation';
  },
  (checkpoint: ClientCheckpoint) => {
    checkpoint.sent = {
      type: 'submit',
      mutationId: 'bad identity!',
      baseRevision: 1,
      mutations: checkpoint.buffer[0],
    };
  },
])('a malformed persisted checkpoint never installs capture or replays edits', (damage) => {
  const f = fixture();
  cleanup.push(() => f.close());
  const source = f.client();
  source.edit([write({ v: 'Protected' })]);
  const checkpoint = source.sync.checkpoint();
  damage(checkpoint);
  expect(() => restore(checkpoint)).toThrow();
});

test('native mappings keep localized capture and restored edits out of canonical checkpoints', async () => {
  const f = fixture();
  cleanup.push(() => f.close());
  const source = f.client();
  source.edit([write({ v: '/canonical-image' })]);
  const map = <T>(value: T, from: string, to: string): T =>
    JSON.parse(JSON.stringify(value).replaceAll(from, to)) as T;
  const restarted = restore(source.sync.checkpoint(), 'sheet', {
    toVisible: <T>(value: T) => map(value, '/canonical-image', 'blob:visible-image'),
    toCanonical: <T>(value: T) => map(value, 'blob:visible-image', '/canonical-image'),
  });
  expect(
    (restarted.visible.snapshot() as ReturnType<typeof book>).sheets.one.cellData![0][0].v,
  ).toBe('blob:visible-image');
  const local = write({ v: 'blob:visible-image' }, 2);
  restarted.visible.univer
    .__getInjector()
    .get(ICommandService)
    .syncExecuteCommand(local.id, local.params);
  await restarted.sync.persistNow();
  expect(JSON.stringify(restarted.saved.at(-1))).not.toContain('blob:visible-image');
  expect(restarted.sync.checkpoint().buffer).toHaveLength(2);
});
