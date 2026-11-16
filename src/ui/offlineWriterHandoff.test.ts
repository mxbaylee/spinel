import { locks } from 'node:worker_threads';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ClientCheckpoint } from '@spinel/sync-client';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import { OfflineSession } from '../../web/offline/OfflineSession.ts';
import * as offlineStorage from '../../web/offline/offlineStore.ts';
import {
  offlineChanged,
  reserveOfflineReplay,
  setPreparedAccount,
  watchOfflineChanges,
  withOfflineItemWriter,
  withOfflineEditorAdmission,
} from '../../web/offline/offlineStore.ts';
import type { OfflineStore } from '../../web/offline/offlineStore.ts';
import { createReplayAdmission } from '../../web/offline/replayAdmission.ts';

const accountId = 'writer-handoff-account';
const itemId = 'second-prepared-document';
const lockName = `spinel-offline:${accountId}:${itemId}`;
const changeKey = 'spinel.offline.changed';
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
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
  setPreparedAccount(accountId);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('a denied writer epoch leaves replay and editor admission available after storage returns', async () => {
  const operation = vi.fn(async () => {});
  const denied = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError');
  });
  await expect(withOfflineItemWriter(accountId, itemId, operation)).rejects.toThrow(
    'Offline downloads need browser storage.',
  );
  expect(operation).not.toHaveBeenCalled();
  denied.mockRestore();

  const replay = reserveOfflineReplay(accountId, itemId, async () => {});
  // This invariant detects the original ordering directly, before any blocked
  // editor wait could turn a leaked registration into a test timeout.
  expect(replay).toBeTypeOf('function');
  replay!();
  const editor = vi.fn(() =>
    locks.request(lockName, { ifAvailable: true }, (lock) => Boolean(lock)),
  );
  expect(await withOfflineEditorAdmission(accountId, itemId, () => {}, editor)).toBe(true);
  expect(editor).toHaveBeenCalledOnce();
  await withOfflineItemWriter(accountId, itemId, operation);
  expect(operation).toHaveBeenCalledOnce();
  expect(await locks.query()).toEqual({ held: [], pending: [] });
});

/** Independent event targets/module instances share only actual runtime locks and storage delivery. */
function replayTabs(manager: LockManager = locks as unknown as LockManager) {
  const targets: EventTarget[] = [];
  let deliver = true;
  let denied = false;
  const tabs = [0, 1].map(() => {
    const target = new EventTarget();
    targets.push(target);
    const localStorage = {
      setItem(key: string, newValue: string) {
        if (denied) throw new Error('Storage denied');
        if (deliver)
          for (const other of targets) {
            if (other !== target)
              queueMicrotask(() =>
                other.dispatchEvent(Object.assign(new Event('storage'), { key, newValue })),
              );
          }
      },
    } as Storage;
    return {
      target,
      admission: createReplayAdmission(Object.assign(target, { localStorage }), manager),
    };
  });
  return {
    tabs,
    drop: () => {
      deliver = false;
    },
    deny: () => {
      denied = true;
    },
  };
}

test.each(['editor', 'maintenance'] as const)(
  'another tab joins replay cleanup before %s item-writer admission',
  async (next) => {
    const { tabs } = replayTabs();
    const entered = deferred();
    const stopping = deferred();
    const persisted = deferred();
    const finish = deferred();
    const events: string[] = [];
    const replay = tabs[0].admission.replay(
      accountId,
      itemId,
      async () => {
        events.push('quiet');
        stopping.resolve();
        await persisted.promise;
        events.push('persisted');
        finish.resolve();
      },
      () =>
        locks.request(lockName, async () => {
          entered.resolve();
          await finish.promise;
          events.push('disposed');
        }),
    );
    await entered.promise;
    const foreground = tabs[1].admission.foreground(
      accountId,
      itemId,
      () => {},
      async () => {},
      () =>
        locks.request(lockName, { ifAvailable: true }, async (lock) => {
          expect(lock).not.toBeNull();
          events.push(next);
        }),
    );
    try {
      await Promise.race([
        stopping.promise,
        foreground.then(() => {
          throw new Error('Foreground admitted before replay stopped.');
        }),
      ]);
      expect(events).toEqual(['quiet']);
      const competing = vi.fn(async () => {});
      await tabs[0].admission.replay(accountId, itemId, async () => {}, competing);
      expect(competing).not.toHaveBeenCalled();
      persisted.resolve();
      await foreground;
      await replay;
      expect(events).toEqual(['quiet', 'persisted', 'disposed', next]);
    } finally {
      persisted.resolve();
      finish.resolve();
      await Promise.allSettled([replay, foreground]);
    }
  },
);

test.each(['wrong account', 'wrong item', 'stale request'])(
  'a %s cannot stop a different replay lifetime',
  async (reason) => {
    const { tabs } = replayTabs();
    const entered = deferred();
    const release = deferred();
    const stop = vi.fn(async () => {});
    const replay = tabs[0].admission.replay(accountId, itemId, stop, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const queued =
      reason === 'stale request'
        ? undefined
        : locks.request(
            `spinel-offline-replay-admission:${JSON.stringify([accountId, itemId])}`,
            async () => {},
          );
    try {
      if (queued) expect((await locks.query()).pending).toHaveLength(1);
      const account = reason === 'wrong account' ? 'other-account' : accountId;
      const item = reason === 'wrong item' ? 'other-item' : itemId;
      tabs[0].target.dispatchEvent(
        Object.assign(new Event('storage'), {
          key: 'spinel.offline.replay-stop',
          newValue: JSON.stringify({ account, item, request: 'old' }),
        }),
      );
      await locks.query();
      expect(stop).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await replay;
      await queued;
    }
  },
);

test.each(['denied', 'missing', 'account change'])(
  'cross-tab %s admission fails closed and permits subsequent exclusive admission',
  async (reason) => {
    const queued = deferred();
    const nativeLocks = locks as unknown as LockManager;
    const manager = {
      query: () => nativeLocks.query(),
      request: ((name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
        const result = nativeLocks.request(name, options, callback);
        if (options.signal) queued.resolve();
        return result;
      }) as LockManager['request'],
    };
    const transport = replayTabs(manager);
    const { tabs } = transport;
    const entered = deferred();
    const release = deferred();
    let current = true;
    const replay = tabs[0].admission.replay(
      accountId,
      itemId,
      async () => {},
      async () => {
        entered.resolve();
        await release.promise;
      },
    );
    await entered.promise;
    if (reason === 'denied') transport.deny();
    else transport.drop();
    const operation = vi.fn(async () => {});
    const foreground = tabs[1].admission.foreground(
      accountId,
      itemId,
      () => {
        if (!current) throw new DOMException('Account changed', 'AbortError');
      },
      async () => {},
      operation,
    );
    const rejected = expect(foreground).rejects.toThrow(
      reason === 'denied'
        ? 'Storage denied'
        : reason === 'account change'
          ? 'Account changed'
          : 'Close this document',
    );
    try {
      // Observe the real request call, without polling query until a desired state.
      if (reason !== 'denied') {
        await queued.promise;
        if (reason === 'account change') {
          current = false;
          tabs[1].target.dispatchEvent(new Event('spinel-offline-account-changed'));
        }
      }
      await rejected;
      expect(operation).not.toHaveBeenCalled();
      release.resolve();
      await replay;
      // Node's intermediate aborted-query snapshot is not an ownership oracle.
      // Actual subsequent acquisition proves no orphaned reservation remains.
      let acquired = false;
      await nativeLocks.request(
        `spinel-offline-replay-admission:${JSON.stringify([accountId, itemId])}`,
        { signal: AbortSignal.timeout(1_000) },
        () => {
          acquired = true;
        },
      );
      expect(acquired).toBe(true);
      expect(operation).not.toHaveBeenCalled();
      expect(await manager.query()).toEqual({ held: [], pending: [] });
    } finally {
      release.resolve();
      await replay;
      await foreground.catch(() => {});
    }
  },
  7_000,
);

test('a live foreground editor remains an immediate busy refusal across tabs', async () => {
  const { tabs } = replayTabs();
  const entered = deferred();
  const release = deferred();
  const writer = locks.request(lockName, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  try {
    await tabs[1].admission.foreground(
      accountId,
      itemId,
      () => {},
      async () => {},
      () => locks.request(lockName, { ifAvailable: true }, (lock) => expect(lock).toBeNull()),
    );
    expect((await locks.query()).pending).toEqual([]);
  } finally {
    release.resolve();
    await writer;
  }
});

test('failed replay cleanup releases its gate and retires its remote stop listener', async () => {
  const { tabs } = replayTabs();
  const stop = vi.fn(async () => {});
  await expect(
    tabs[0].admission.replay(accountId, itemId, stop, async () => {
      throw new Error('Native disposal failed');
    }),
  ).rejects.toThrow('Native disposal failed');
  const acquired = vi.fn(async () => {});
  await tabs[1].admission.foreground(
    accountId,
    itemId,
    () => {},
    async () => {},
    acquired,
  );
  expect(acquired).toHaveBeenCalledOnce();
  tabs[0].target.dispatchEvent(
    Object.assign(new Event('storage'), {
      key: 'spinel.offline.replay-stop',
      newValue: JSON.stringify({ account: accountId, item: itemId, request: 'retired' }),
    }),
  );
  await locks.query();
  expect(stop).not.toHaveBeenCalled();
  expect((await locks.query()).held).toEqual([]);
});

const bundle: OfflineBundle = {
  version: 1,
  accountId,
  itemId,
  spaceId: 'prepared-space',
  unitId: 'document-generation',
  revisionOffset: 2,
  revision: 3,
  name: 'Travel notes',
  kind: 'doc',
  access: 'owner',
  readOnly: false,
  sdkVersion: '1.3.1',
  snapshot: { id: itemId, body: { dataStream: '\r\n' }, documentStyle: {} },
  images: [],
};
const checkpoint: ClientCheckpoint = {
  version: 1,
  unitId: bundle.unitId,
  revision: 1,
  snapshot: { ...bundle.snapshot, id: bundle.unitId },
  sent: null,
  inflight: [],
  buffer: [],
};

test('overlapping editor admissions queue only the short handoff and keep the second native view read-only', async () => {
  const store = {
    bundle: vi.fn(async () => ({ bundle: structuredClone(bundle), bytes: new Map() })),
    close: vi.fn(),
  };
  vi.spyOn(offlineStorage, 'openExistingOfflineStore').mockResolvedValue(
    store as unknown as OfflineStore,
  );
  const gate = `spinel-offline-replay-admission:${JSON.stringify([accountId, itemId])}`;
  const queued = deferred();
  const entered = deferred();
  const admissionRelease = deferred();
  const writerRelease = deferred();
  const manager = {
    query: () => locks.query(),
    request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) {
      const result = locks.request(name, options, callback);
      if (name === gate && options.signal) queued.resolve();
      return result;
    },
  };
  vi.stubGlobal('navigator', { locks: manager });
  let writer: Promise<unknown> | undefined;
  const first = withOfflineEditorAdmission(
    accountId,
    itemId,
    () => {},
    async () => {
      writer = locks.request(lockName, { ifAvailable: true }, async (lock) => {
        expect(lock).not.toBeNull();
        entered.resolve();
        await writerRelease.promise;
      });
      await entered.promise;
      await admissionRelease.promise;
    },
  );
  const second = new OfflineSession(accountId, itemId, bundle.spaceId, () => true);
  let opening: Promise<void> | undefined;
  try {
    await entered.promise;
    const maintenance = vi.fn(async () => {});
    await expect(
      createReplayAdmission(window, manager as unknown as LockManager).foreground(
        accountId,
        itemId,
        () => {},
        async () => {},
        maintenance,
      ),
    ).rejects.toThrow('Close this document in every tab');
    expect(maintenance).not.toHaveBeenCalled();
    opening = second.activate();
    const outcome = opening.then(
      () => 'opened',
      () => 'refused',
    );
    expect(await Promise.race([queued.promise.then(() => 'queued'), outcome])).toBe('queued');
    expect((await locks.query()).pending).toContainEqual(
      expect.objectContaining({ name: gate, mode: 'exclusive' }),
    );
    admissionRelease.resolve();
    await first;
    await opening;
    expect(second.enabled).toBe(true);
    expect(second.readOnly).toBe(true);
    expect(second.problem).toContain('open in another tab');
    expect(await locks.request(lockName, { ifAvailable: true }, (lock) => Boolean(lock))).toBe(
      false,
    );
  } finally {
    admissionRelease.resolve();
    await first;
    await opening?.catch(() => {});
    second.dispose();
    writerRelease.resolve();
    await writer;
    expect(await locks.query()).toEqual({ held: [], pending: [] });
  }
});

test.each(['editor', 'maintenance'] as const)(
  '%s admission joins replay persistence and reserves the handoff against another replay',
  async (next) => {
    const writing = deferred();
    const committed = deferred();
    const stopping = deferred();
    let acquired = false;
    const writer = locks.request(lockName, async () => {
      writing.resolve();
      await committed.promise;
    });
    const unregister = reserveOfflineReplay(accountId, itemId, async () => {
      stopping.resolve();
      await writer;
      unregister!();
    });
    expect(unregister).toBeTypeOf('function');
    await writing.promise;
    const acquire = () =>
      locks.request(lockName, { ifAvailable: true }, (lock) => {
        acquired = Boolean(lock);
      });
    const opening =
      next === 'editor'
        ? withOfflineEditorAdmission(accountId, itemId, () => {}, acquire)
        : withOfflineItemWriter(accountId, itemId, async () => {
            acquired = true;
          });
    try {
      await stopping.promise;
      expect(acquired).toBe(false);
      expect(reserveOfflineReplay(accountId, itemId, async () => {})).toBeUndefined();
      committed.resolve();
      await opening;
      expect(acquired).toBe(true);
      const available = reserveOfflineReplay(accountId, itemId, async () => {});
      expect(available).toBeTypeOf('function');
      available!();
    } finally {
      committed.resolve();
      await writer;
      await opening;
      unregister!();
    }
  },
);

test('a prepared-account download hands its released writer to the mounted native storage adapter', async () => {
  // Use the runtime's real Web Locks. Only the IndexedDB boundary is replaced;
  // the change event, writer helper, session admission and persistence are real.
  let committed = false;
  const saveCheckpoint = vi.fn(
    async (_scope: unknown, _checkpoint: ClientCheckpoint, verify: () => void) => verify(),
  );
  const store = {
    bundle: vi.fn(async () =>
      committed ? { bundle: structuredClone(bundle), bytes: new Map() } : undefined,
    ),
    saveCheckpoint,
    close: vi.fn(),
  };
  vi.spyOn(offlineStorage, 'openExistingOfflineStore').mockResolvedValue(
    store as unknown as OfflineStore,
  );
  const active = new OfflineSession(accountId, itemId, bundle.spaceId, () => true);
  let adoption: Promise<void> | undefined;
  const changed = vi.fn((change: offlineStorage.OfflineChange) => {
    if (change.itemId === itemId && change.pending === undefined) {
      adoption = active.persist(() => checkpoint);
      void adoption.catch(() => {});
    }
  });
  const stop = watchOfflineChanges(accountId, changed);
  const entered = deferred();
  const release = deferred();
  const preparing = withOfflineItemWriter(accountId, itemId, async () => {
    committed = true;
    offlineChanged(accountId, itemId);
    entered.resolve();
    await release.promise;
    return 'saved';
  });
  try {
    await entered.promise;
    expect(changed).not.toHaveBeenCalled();
    expect(values.has(changeKey)).toBe(false);
    release.resolve();
    await expect(preparing).resolves.toBe('saved');
    expect(adoption).toBeDefined();
    await adoption;
    expect(active.enabled).toBe(true);
    expect(active.readOnly).toBe(false);
    expect(active.problem).toBe('');
    expect(saveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ account: accountId, item: itemId, spaceId: bundle.spaceId }),
      checkpoint,
      expect.any(Function),
      expect.any(Object),
    );
    const competing = vi.fn(async () => {});
    await expect(withOfflineItemWriter(accountId, itemId, competing)).rejects.toThrow(
      'Close this document in every tab',
    );
    expect(competing).not.toHaveBeenCalled();
    // Its native writer stays held for the editor lifetime, but pending notices
    // must still update this tab and other tabs immediately.
    offlineChanged(accountId, itemId, true);
    expect(changed).toHaveBeenLastCalledWith({ accountId, itemId, pending: true });
    expect(JSON.parse(values.get(changeKey)!)).toMatchObject({ accountId, itemId, pending: true });
  } finally {
    release.resolve();
    await preparing.catch(() => {});
    await adoption?.catch(() => {});
    stop();
    active.dispose();
    await locks.request(lockName, () => {});
  }
});

test('opening a clean native copy waits for its temporary refresh and reserves the handoff against new maintenance', async () => {
  const store = {
    bundle: vi.fn(async () => ({ bundle: structuredClone(bundle), bytes: new Map() })),
    close: vi.fn(),
  };
  vi.spyOn(offlineStorage, 'openExistingOfflineStore').mockResolvedValue(
    store as unknown as OfflineStore,
  );
  const entered = deferred();
  const release = deferred();
  const refreshing = withOfflineItemWriter(accountId, itemId, async () => {
    entered.resolve();
    await release.promise;
  });
  const active = new OfflineSession(accountId, itemId, bundle.spaceId, () => true);
  const competingEditor = new OfflineSession(accountId, itemId, bundle.spaceId, () => true);
  let opening: Promise<void> | undefined;
  try {
    await entered.promise;
    opening = active.activate();
    const competingMaintenance = vi.fn(async () => {});
    await expect(withOfflineItemWriter(accountId, itemId, competingMaintenance)).rejects.toThrow(
      'Close this document in every tab',
    );
    expect(competingMaintenance).not.toHaveBeenCalled();
    expect(store.bundle).not.toHaveBeenCalled();
    expect(active.enabled).toBe(false);
    release.resolve();
    await refreshing;
    await opening;
    expect(active.enabled).toBe(true);
    expect(active.readOnly).toBe(false);
    expect(active.problem).toBe('');
    // A real lifetime editor is not a maintenance promise. It still refuses
    // the second editor immediately instead of queueing behind unfinished input.
    await competingEditor.activate();
    expect(competingEditor.readOnly).toBe(true);
    expect(competingEditor.problem).toContain('open in another tab');
    expect(await locks.request(lockName, { ifAvailable: true }, (lock) => Boolean(lock))).toBe(
      false,
    );
  } finally {
    release.resolve();
    await refreshing.catch(() => {});
    await opening?.catch(() => {});
    competingEditor.dispose();
    active.dispose();
    await locks.request(lockName, () => {});
  }
});

test.each(['dispose', 'account-change'] as const)(
  'an editor cancelled by %s while maintenance holds its writer cannot acquire after the handoff',
  async (reason) => {
    const store = {
      bundle: vi.fn(async () => ({ bundle: structuredClone(bundle), bytes: new Map() })),
      close: vi.fn(),
    };
    vi.spyOn(offlineStorage, 'openExistingOfflineStore').mockResolvedValue(
      store as unknown as OfflineStore,
    );
    const entered = deferred();
    const release = deferred();
    const refreshing = withOfflineItemWriter(accountId, itemId, async () => {
      entered.resolve();
      await release.promise;
    });
    const active = new OfflineSession(accountId, itemId, bundle.spaceId, () => true);
    let opening: Promise<void> | undefined;
    try {
      await entered.promise;
      opening = active.activate();
      const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' });
      if (reason === 'dispose') active.dispose();
      else setPreparedAccount('different-account');
      release.resolve();
      await refreshing;
      await rejected;
      expect(store.bundle).not.toHaveBeenCalled();
      expect(await locks.request(lockName, { ifAvailable: true }, (lock) => Boolean(lock))).toBe(
        true,
      );
    } finally {
      release.resolve();
      await refreshing.catch(() => {});
      await opening?.catch(() => {});
      active.dispose();
    }
  },
);

test.each([false, true])(
  'a failed temporary operation publishes only its committed changes after release (committed=%s)',
  async (committed) => {
    const failure = new Error('The later operation failed.');
    const reacquired: Promise<boolean>[] = [];
    const changed = vi.fn(() => {
      reacquired.push(locks.request(lockName, { ifAvailable: true }, (lock) => Boolean(lock)));
    });
    const stop = watchOfflineChanges(accountId, changed);
    try {
      await expect(
        withOfflineItemWriter(accountId, itemId, async () => {
          if (committed) offlineChanged(accountId, itemId);
          expect(changed).not.toHaveBeenCalled();
          expect(values.has(changeKey)).toBe(false);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(changed).toHaveBeenCalledTimes(committed ? 1 : 0);
      expect(await Promise.all(reacquired)).toEqual(committed ? [true] : []);
      expect(values.has(changeKey)).toBe(committed);
      if (committed)
        expect(JSON.parse(values.get(changeKey)!)).toMatchObject({ accountId, itemId });
    } finally {
      stop();
    }
  },
);

test('a rejected competing writer leaves the original handoff queued and unrelated scopes immediate', async () => {
  const own = vi.fn();
  const other = vi.fn();
  const stopOwn = watchOfflineChanges(accountId, own);
  const stopOther = watchOfflineChanges('another-account', other);
  const entered = deferred();
  const release = deferred();
  const preparing = withOfflineItemWriter(accountId, itemId, async () => {
    offlineChanged(accountId, itemId);
    entered.resolve();
    await release.promise;
  });
  try {
    await entered.promise;
    const competing = vi.fn(async () => {});
    await expect(withOfflineItemWriter(accountId, itemId, competing)).rejects.toThrow(
      'Close this document in every tab',
    );
    expect(competing).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
    offlineChanged(accountId, 'another-document', true);
    offlineChanged('another-account', itemId, false);
    expect(own).toHaveBeenCalledExactlyOnceWith({
      accountId,
      itemId: 'another-document',
      pending: true,
    });
    expect(other).toHaveBeenCalledExactlyOnceWith({
      accountId: 'another-account',
      itemId,
      pending: false,
    });
    release.resolve();
    await preparing;
    expect(own).toHaveBeenLastCalledWith({ accountId, itemId });
    expect(own).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledOnce();
  } finally {
    release.resolve();
    await preparing.catch(() => {});
    stopOwn();
    stopOther();
  }
});
