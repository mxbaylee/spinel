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
import { replayOfflineItem } from '../../web/offline/replayHost.ts';
import * as binding from '../../web/spinelSync.ts';

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
  sdkVersion: '1.3.1',
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
  'the actual background session drains before foreground admission, even when native cleanup throws (%s)',
  async (cleanupFails) => {
    const download = downloaded();
    download.outbox = {
      version: 1,
      ...scope,
      checkpoint: { ...structuredClone(checkpoint), buffer: [[insertText('Saved offline')]] },
    };
    session(download);
    const watching = Promise.withResolvers<void>();
    const stopping = Promise.withResolvers<void>();
    const committed = Promise.withResolvers<void>();
    const cleanupError = new Error('Native cleanup failed after disposal');
    const originalDispose = NativeReplica.prototype.dispose;
    const disposed = vi.spyOn(NativeReplica.prototype, 'dispose').mockImplementation(function (
      this: NativeReplica,
    ) {
      originalDispose.call(this);
      if (cleanupFails) throw cleanupError;
    });
    vi.spyOn(binding, 'attachSpinelSync').mockImplementation((options) => {
      const dispose = () => options.offline?.dispose();
      return {
        watch() {
          watching.resolve();
          return { retry() {}, recover() {}, exportRecovery() {}, discardRecovery() {}, dispose };
        },
        async stop() {
          stopping.resolve();
          await committed.promise;
        },
        dispose,
      };
    });
    const replay = replayOfflineItem(
      scope.account,
      {
        itemId: scope.item,
        spaceId: scope.spaceId,
        name: bundle.name,
        kind: 'doc',
        readOnly: false,
        revision: bundle.revision,
        downloadedAt: 0,
        pending: true,
      },
      () => true,
    );
    const outcome = replay.done.then(
      () => undefined,
      (error: unknown) => error,
    );
    const foreground = new OfflineSession(scope.account, scope.item, scope.spaceId, () => true);
    cleanup.push(() => foreground.dispose());
    let opening: Promise<void> | undefined;
    try {
      await Promise.race([
        watching.promise,
        replay.done.then(() => {
          throw new Error('Replay ended before binding admission.');
        }),
      ]);
      let opened = false;
      opening = foreground.activate().then(() => {
        opened = true;
      });
      await stopping.promise;
      expect(opened).toBe(false);
      expect(disposed).not.toHaveBeenCalled();
      committed.resolve();
      expect(await outcome).toBe(cleanupFails ? cleanupError : undefined);
      await opening;
      expect(foreground.enabled).toBe(true);
      expect(foreground.readOnly).toBe(false);
      expect(foreground.checkpoint?.buffer).toEqual(download.outbox.checkpoint.buffer);
      expect(disposed).toHaveBeenCalledOnce();
    } finally {
      committed.resolve();
      await replay.stop();
      await outcome;
      await opening;
      foreground.dispose();
    }
  },
);

test.each(['account change', 'copy removal'] as const)(
  'background admission stops after delayed device lookup and %s',
  async (change) => {
    const download = downloaded();
    download.outbox = {
      version: 1,
      ...scope,
      checkpoint: { ...structuredClone(checkpoint), buffer: [[insertText('Retain original')]] },
    };
    const f = session(download);
    const reading = Promise.withResolvers<void>();
    const result = Promise.withResolvers<Download | undefined>();
    f.store.bundle.mockImplementation(async () => {
      reading.resolve();
      return result.promise;
    });
    const attached = vi.spyOn(binding, 'attachSpinelSync');
    const lifetime = offlineStorage.offlinePreparation(scope.account, () => true);
    const replay = replayOfflineItem(
      scope.account,
      {
        itemId: scope.item,
        spaceId: scope.spaceId,
        name: bundle.name,
        kind: 'doc',
        readOnly: false,
        revision: bundle.revision,
        downloadedAt: 0,
        pending: true,
      },
      lifetime.isCurrent,
    );
    const outcome = replay.done.then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await reading.promise;
      if (change === 'account change') offlineStorage.setPreparedAccount('replacement-account');
      result.resolve(change === 'copy removal' ? undefined : download);
      const error = await outcome;
      if (change === 'account change') expect(error).toMatchObject({ name: 'AbortError' });
      else expect(error).toBeUndefined();
      expect(attached).not.toHaveBeenCalled();
      expect(f.store.saveCheckpoint).not.toHaveBeenCalled();
      expect(
        await locks.request(
          `spinel-offline:${scope.account}:${scope.item}`,
          { ifAvailable: true },
          (lock) => Boolean(lock),
        ),
      ).toBe(true);
    } finally {
      result.resolve(undefined);
      await replay.stop();
      await outcome;
    }
  },
);

test('a background host never binds a pending copy owned by another tab', async () => {
  const download = downloaded();
  download.outbox = {
    version: 1,
    ...scope,
    checkpoint: {
      ...structuredClone(checkpoint),
      buffer: [[insertText('Other writer owns this')]],
    },
  };
  const f = session(download);
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const other = locks.request(`spinel-offline:${scope.account}:${scope.item}`, async () => {
    held.resolve();
    await release.promise;
  });
  const attached = vi.spyOn(binding, 'attachSpinelSync');
  await held.promise;
  const replay = replayOfflineItem(
    scope.account,
    {
      itemId: scope.item,
      spaceId: scope.spaceId,
      name: bundle.name,
      kind: 'doc',
      readOnly: false,
      revision: bundle.revision,
      downloadedAt: 0,
      pending: true,
    },
    () => true,
  );
  try {
    await replay.done;
    expect(attached).not.toHaveBeenCalled();
    expect(f.store.saveCheckpoint).not.toHaveBeenCalled();
    expect(download.outbox.checkpoint.buffer).toEqual([[insertText('Other writer owns this')]]);
  } finally {
    release.resolve();
    await other;
    await replay.stop();
    await replay.done.catch(() => {});
  }
});

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
