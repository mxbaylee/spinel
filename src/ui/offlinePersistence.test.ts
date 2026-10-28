import { locks } from 'node:worker_threads';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { JSONX, TextX } from '@univerjs/core';
import { NativeReplica, SyncClient } from '@spinel/sync-client';
import type { ClientCheckpoint, OutgoingFrame } from '@spinel/sync-client';
import type { Mutation } from '@spinel/sync-transform';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import { OfflineSession } from '../../web/offline/OfflineSession.ts';
import * as offlineStorage from '../../web/offline/offlineStore.ts';
import type { OfflineStore } from '../../web/offline/offlineStore.ts';

const cleanup: (() => void)[] = [];
const scope = {
  account: 'lazy-checkpoint-owner',
  item: 'item',
  spaceId: 'space',
  unitId: 'generation',
  revisionOffset: 2,
};
const bundle: OfflineBundle = {
  version: 1,
  accountId: scope.account,
  itemId: scope.item,
  spaceId: scope.spaceId,
  unitId: scope.unitId,
  revisionOffset: scope.revisionOffset,
  revision: 3,
  name: 'Notes',
  kind: 'doc',
  access: 'editor',
  readOnly: false,
  sdkVersion: '1.1.0',
  snapshot: { id: scope.item, body: { dataStream: '\r\n' }, documentStyle: {} },
  images: [],
};
const checkpoint: ClientCheckpoint = {
  version: 1,
  unitId: scope.unitId,
  revision: 1,
  snapshot: { ...bundle.snapshot, id: scope.unitId },
  sent: null,
  inflight: [],
  buffer: [],
};
type Download = NonNullable<Awaited<ReturnType<OfflineStore['bundle']>>>;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('navigator', { locks });
  vi.stubGlobal('location', { origin: 'https://spinel.test' });
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    }),
  );
  offlineStorage.setPreparedAccount(scope.account);
});
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function downloaded(): Download {
  return {
    bundle: structuredClone(bundle),
    bytes: new Map(),
    outbox: undefined,
    recovery: undefined,
    creation: undefined,
  };
}

function session(download?: Download) {
  const saved: ClientCheckpoint[] = [];
  const store = {
    bundle: vi.fn(async () => download),
    close: vi.fn(),
    saveCheckpoint: vi.fn(async (_scope: unknown, value: ClientCheckpoint, verify: () => void) => {
      verify();
      saved.push(structuredClone(value));
    }),
  };
  const opened = vi
    .spyOn(offlineStorage, 'openExistingOfflineStore')
    .mockResolvedValue(store as unknown as OfflineStore);
  const active = new OfflineSession(scope.account, scope.item, scope.spaceId, () => true);
  cleanup.push(() => active.dispose());
  return { active, store, saved, opened };
}

function insertText(value: string): Mutation {
  const text = new TextX();
  text.push({ t: 'i' as never, len: value.length, body: { dataStream: value } });
  return {
    id: 'doc.mutation.rich-text-editing',
    params: {
      unitId: scope.unitId,
      actions: JSONX.getInstance().editOp(text.serialize()),
      textRanges: [],
      trigger: 'doc.command.insert-text',
    },
  };
}

function native(active: OfflineSession) {
  const confirmed = new NativeReplica(checkpoint.snapshot, 'doc');
  const visible = new NativeReplica(checkpoint.snapshot, 'doc');
  const snapshot = vi.spyOn(confirmed, 'snapshot');
  const outgoing: OutgoingFrame[] = [];
  const client = new SyncClient({
    unitId: scope.unitId,
    revision: checkpoint.revision,
    confirmed,
    applyRemote: (mutations) => visible.apply(mutations),
    visibleSnapshot: () => visible.snapshot(),
    onState() {},
    onResync() {},
    send: (frame) => outgoing.push(frame),
    persist: (capture) => active.persist(capture),
    preservePendingOnFailure: () => active.enabled,
    requireUnchangedResume: () => active.enabled,
    batchDelayMs: 100_000,
  });
  cleanup.push(() => {
    client.dispose();
    visible.dispose();
  });
  return {
    client,
    snapshot,
    outgoing,
    edit(value: string) {
      const mutation = insertText(value);
      visible.apply([mutation]);
      client.enqueue([mutation]);
      return mutation;
    },
  };
}

test.each([false, true])(
  'inactive persistence captures no confirmed snapshots (prepared account=%s)',
  async (prepared) => {
    if (!prepared) offlineStorage.setPreparedAccount(null);
    const f = session();
    const persist = vi.spyOn(f.active, 'persist');
    const source = native(f.active);
    for (let index = 0; index < 20; index++) {
      source.edit(String(index));
      await source.client.persistNow();
    }
    expect(persist).toHaveBeenCalledTimes(40);
    expect(source.snapshot).not.toHaveBeenCalled();
    expect(f.store.bundle.mock.calls.length > 0).toBe(prepared);
    expect(f.active.enabled).toBe(false);
    expect(f.store.saveCheckpoint).not.toHaveBeenCalled();
    expect(source.client.state).toMatchObject({
      localPersistence: 'saved',
      pending: true,
      pendingMutations: 20,
    });
  },
);

test('late offline activation captures the current pending queue after admission', async () => {
  const f = session();
  const source = native(f.active);
  const first = source.edit('First');
  await source.client.persistNow();
  expect(source.snapshot).not.toHaveBeenCalled();
  const entered = Promise.withResolvers<void>();
  const admission = Promise.withResolvers<void>();
  f.store.bundle.mockImplementationOnce(async () => {
    entered.resolve();
    await admission.promise;
    return downloaded();
  });
  const second = source.edit('Second');
  try {
    await entered.promise;
    const third = source.edit('Third');
    expect(source.snapshot).not.toHaveBeenCalled();
    expect(source.client.state.localPersistence).toBe('saving');
    admission.resolve();
    await source.client.persistNow();
    expect(f.active.enabled).toBe(true);
    expect(source.snapshot).toHaveBeenCalledTimes(3);
    expect(f.saved).toHaveLength(3);
    for (const saved of f.saved) {
      expect(saved).toMatchObject({
        revision: 1,
        sent: null,
        buffer: [[first], [second], [third]],
      });
      expect(saved.snapshot).toEqual(source.snapshot.mock.results[0].value);
    }
    expect(f.active.checkpoint).toEqual(f.saved.at(-1));
    expect(source.client.state.localPersistence).toBe('saved');
    expect(source.outgoing).toEqual([]);
  } finally {
    admission.resolve();
  }
});

test("adopting another session's pending outbox refuses before requesting a replacement", async () => {
  const retained = downloaded();
  retained.outbox = {
    version: 1,
    ...scope,
    checkpoint: { ...structuredClone(checkpoint), buffer: [[insertText('Retained')]] },
  };
  const original = structuredClone(retained.outbox);
  const f = session(retained);
  const capture = vi.fn(() => ({ ...checkpoint, buffer: [[insertText('Live')]] }));
  await expect(f.active.persist(capture)).rejects.toThrow('Another editing session left changes');
  expect(capture).not.toHaveBeenCalled();
  expect(f.store.saveCheckpoint).not.toHaveBeenCalled();
  expect(retained.outbox).toEqual(original);
  expect(f.active.pending).toBe(true);
  expect(f.active.readOnly).toBe(true);
});

test.each(['read-only', 'no writer'] as const)(
  '%s admission still captures and rejects pending edits',
  async (reason) => {
    const download = downloaded();
    if (reason === 'read-only') download.bundle.readOnly = true;
    else
      vi.stubGlobal('navigator', {
        locks: {
          request: async (_name: string, _options: unknown, work: (lock: null) => unknown) =>
            work(null),
        },
      });
    const f = session(download);
    const capture = vi.fn(() => ({ ...checkpoint, buffer: [[insertText('Pending')]] }));
    await expect(f.active.persist(capture)).rejects.toThrow('This offline copy is read-only.');
    expect(capture).toHaveBeenCalledOnce();
    expect(f.store.saveCheckpoint).not.toHaveBeenCalled();
    const clean = vi.fn(() => checkpoint);
    await f.active.persist(clean);
    expect(clean).toHaveBeenCalledOnce();
    expect(f.store.saveCheckpoint).not.toHaveBeenCalled();
  },
);

test.each(['dispose', 'account change'] as const)(
  '%s during activation rejects before requesting a snapshot',
  async (reason) => {
    const f = session();
    const entered = Promise.withResolvers<void>();
    const admission = Promise.withResolvers<void>();
    f.store.bundle.mockImplementationOnce(async () => {
      entered.resolve();
      await admission.promise;
      return downloaded();
    });
    const capture = vi.fn(() => checkpoint);
    const saving = expect(f.active.persist(capture)).rejects.toThrow('no longer current');
    try {
      await entered.promise;
      if (reason === 'dispose') f.active.dispose();
      else offlineStorage.setPreparedAccount('another-owner');
      admission.resolve();
      await saving;
      expect(capture).not.toHaveBeenCalled();
      expect(f.store.saveCheckpoint).not.toHaveBeenCalled();
      expect(f.active.enabled).toBe(false);
    } finally {
      admission.resolve();
    }
  },
);

test('disposing the sync client during offline activation cannot read its disposed replica', async () => {
  const f = session();
  const source = native(f.active);
  const entered = Promise.withResolvers<void>();
  const admission = Promise.withResolvers<void>();
  f.store.bundle.mockImplementationOnce(async () => {
    entered.resolve();
    await admission.promise;
    return downloaded();
  });
  source.edit('Pending');
  const saving = expect(source.client.persistNow()).rejects.toThrow();
  try {
    await entered.promise;
    source.client.dispose();
    admission.resolve();
    await saving;
    expect(source.snapshot).not.toHaveBeenCalled();
    expect(f.store.saveCheckpoint).not.toHaveBeenCalled();
    expect(source.outgoing).toEqual([]);
  } finally {
    admission.resolve();
  }
});
