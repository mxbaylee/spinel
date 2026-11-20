import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { locks } from 'node:worker_threads';
import { CONNECTION_CHECK_EVENT } from '../../web/connectionState.ts';
import { watchOfflineReplay } from '../../web/offline/replay.ts';
import { replayOfflineItem } from '../../web/offline/replayHost.ts';
import * as storage from '../../web/offline/offlineStore.ts';
import type { OfflineDownload, OfflineStore } from '../../web/offline/offlineStore.ts';
import { captureDiagnostic } from '@spinel/diagnostics';
import type { DiagnosticSource } from '@spinel/diagnostics';

vi.mock('../../web/offline/replayHost.ts', () => ({ replayOfflineItem: vi.fn() }));
const account = 'replay-account';
const downloads: OfflineDownload[] = ['doc', 'sheet'].map((kind, index) => ({
  itemId: `item-${index}`,
  name: kind,
  kind: kind as 'doc' | 'sheet',
  readOnly: false,
  revision: 1,
  downloadedAt: 0,
  pending: true,
}));
const cleanups: (() => void)[] = [];
const jobs: { stop: ReturnType<typeof vi.fn>; finish(): void }[] = [];
const turns = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

beforeEach(() => {
  const values = new Map<string, string>();
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
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('navigator', { onLine: true, locks });
  storage.setPreparedAccount(account);
  vi.spyOn(storage, 'openExistingOfflineStore').mockResolvedValue({
    downloads: async () => structuredClone(downloads),
    close() {},
  } as unknown as OfflineStore);
  vi.mocked(replayOfflineItem).mockImplementation(() => {
    const ended = Promise.withResolvers<void>();
    const stop = vi.fn(async () => ended.resolve());
    jobs.push({ stop, finish: ended.resolve });
    return { stop, done: ended.promise };
  });
});
afterEach(async () => {
  for (const close of cleanups.splice(0)) close();
  for (const job of jobs.splice(0)) job.finish();
  await turns();
  vi.restoreAllMocks();
  vi.mocked(replayOfflineItem).mockReset();
  vi.unstubAllGlobals();
});

test('file-list surfaces share one serial owner and exclude their foreground item', async () => {
  const first = watchOfflineReplay(account, 'item-0');
  const second = watchOfflineReplay(account, null);
  cleanups.push(first.dispose, second.dispose);
  await turns();
  expect(replayOfflineItem).toHaveBeenCalledTimes(1);
  expect(vi.mocked(replayOfflineItem).mock.calls[0][1].itemId).toBe('item-1');
  storage.offlineChanged(account, 'item-1', true);
  await turns();
  expect(replayOfflineItem).toHaveBeenCalledTimes(1);
  second.foreground('item-1');
  await turns();
  expect(jobs[0].stop).toHaveBeenCalled();
  expect(replayOfflineItem).toHaveBeenCalledTimes(1);
  first.foreground(null);
  await turns();
  expect(replayOfflineItem).toHaveBeenCalledTimes(2);
  expect(vi.mocked(replayOfflineItem).mock.calls[1][1].itemId).toBe('item-0');
});

test('account replacement stops the current job and fences further queued items', async () => {
  const owner = watchOfflineReplay(account, null);
  cleanups.push(owner.dispose);
  await turns();
  const current = vi.mocked(replayOfflineItem).mock.calls[0][2];
  expect(current()).toBe(true);
  storage.setPreparedAccount('different-account');
  await turns();
  expect(jobs[0].stop).toHaveBeenCalled();
  expect(current()).toBe(false);
  expect(replayOfflineItem).toHaveBeenCalledTimes(1);
});

test('replay observations retain their initiating subscription and stop at account or visibility boundaries', async () => {
  const source = vi.fn(() => ({ sink: vi.fn(), context: { component: 'dashboard' as const } }));
  const firstFactory = vi.fn(() => source);
  const secondFactory = vi.fn(() => source);
  const first = watchOfflineReplay(account, null, firstFactory);
  const second = watchOfflineReplay(account, null, secondFactory);
  cleanups.push(first.dispose, second.dispose);
  await turns();
  const firstSource = vi.mocked(replayOfflineItem).mock.calls[0][3];
  expect(captureDiagnostic(firstSource)).toBeDefined();
  expect(firstFactory).toHaveBeenCalledWith(downloads[0]);
  first.dispose();
  expect(captureDiagnostic(firstSource)).toBeUndefined();
  expect(firstFactory).toHaveBeenCalledOnce();
  expect(secondFactory).not.toHaveBeenCalled();
  jobs[0].finish();
  await turns();
  const nextSource = vi.mocked(replayOfflineItem).mock.calls[1][3];
  expect(captureDiagnostic(nextSource)).toBeDefined();
  expect(secondFactory).toHaveBeenCalledWith(downloads[1]);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'hidden' }));
  expect(captureDiagnostic(nextSource)).toBeUndefined();
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('navigator', { onLine: false, locks });
  expect(captureDiagnostic(nextSource)).toBeUndefined();
  vi.stubGlobal('navigator', { onLine: true, locks });
  storage.setPreparedAccount('replacement-account');
  expect(captureDiagnostic(nextSource)).toBeUndefined();
  expect(secondFactory).toHaveBeenCalledOnce();
});

test('a throwing observation factory cannot stop the pending queue', async () => {
  const observer = vi.fn((): DiagnosticSource => {
    throw new Error('optional observer factory');
  });
  const owner = watchOfflineReplay(account, null, observer);
  cleanups.push(owner.dispose);
  await turns();
  expect(captureDiagnostic(vi.mocked(replayOfflineItem).mock.calls[0][3])).toBeUndefined();
  expect(observer).toHaveBeenCalledOnce();
  jobs[0].finish();
  await turns();
  expect(replayOfflineItem).toHaveBeenCalledTimes(2);
});

test('a durable change arriving while the owned account lock releases starts the next replay', async () => {
  let changed = false;
  vi.spyOn(storage, 'openExistingOfflineStore').mockResolvedValue({
    downloads: async () => (changed ? structuredClone(downloads) : []),
    close() {},
  } as unknown as OfflineStore);
  const request = (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) =>
    locks.request(name, options, async (lock) => {
      const result = await callback(lock);
      if (lock && !changed) {
        changed = true;
        storage.offlineChanged(account, downloads[0].itemId, true);
      }
      return result;
    });
  vi.stubGlobal('navigator', { onLine: true, locks: { request } });
  const owner = watchOfflineReplay(account, null);
  cleanups.push(owner.dispose);
  await turns();
  expect(changed).toBe(true);
  expect(replayOfflineItem).toHaveBeenCalledOnce();
  expect(vi.mocked(replayOfflineItem).mock.calls[0][1].itemId).toBe(downloads[0].itemId);
});

test('offline pauses replay without polling and reconnect processes pending items in order', async () => {
  vi.stubGlobal('navigator', { onLine: false, locks });
  const owner = watchOfflineReplay(account, null);
  cleanups.push(owner.dispose);
  await turns();
  expect(replayOfflineItem).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', { onLine: true, locks });
  window.dispatchEvent(new Event('online'));
  await turns();
  expect(replayOfflineItem).toHaveBeenCalledTimes(1);
  jobs[0].finish();
  await turns();
  expect(replayOfflineItem).toHaveBeenCalledTimes(2);
  jobs[1].finish();
  await turns();
  expect(replayOfflineItem).toHaveBeenCalledTimes(2);
});

test('Try now wakes replay like a reconnect, but only while the browser reports online', async () => {
  vi.stubGlobal('navigator', { onLine: false, locks });
  const owner = watchOfflineReplay(account, null);
  cleanups.push(owner.dispose);
  await turns();
  window.dispatchEvent(new Event(CONNECTION_CHECK_EVENT));
  await turns();
  expect(replayOfflineItem).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', { onLine: true, locks });
  window.dispatchEvent(new Event(CONNECTION_CHECK_EVENT));
  await turns();
  expect(replayOfflineItem).toHaveBeenCalledTimes(1);
});

test('another tab owning account replay is skipped until a later foreground event', async () => {
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const otherTab = locks.request(`spinel-offline-replay:${account}`, async () => {
    held.resolve();
    await release.promise;
  });
  await held.promise;
  const owner = watchOfflineReplay(account, null);
  cleanups.push(owner.dispose);
  try {
    await turns();
    expect(replayOfflineItem).not.toHaveBeenCalled();
    release.resolve();
    await otherTab;
    window.dispatchEvent(new Event('focus'));
    await turns();
    expect(replayOfflineItem).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
    await otherTab;
  }
});

test('a remounted file list waits for the previous owner to finish releasing its account lock', async () => {
  const released = Promise.withResolvers<void>();
  vi.mocked(replayOfflineItem).mockImplementationOnce(() => ({
    stop: () => released.promise,
    done: released.promise,
  }));
  const first = watchOfflineReplay(account, null);
  cleanups.push(first.dispose);
  await turns();
  first.dispose();
  const second = watchOfflineReplay(account, null);
  cleanups.push(second.dispose);
  try {
    await turns();
    expect(replayOfflineItem).toHaveBeenCalledTimes(1);
    released.resolve();
    await turns();
    expect(replayOfflineItem).toHaveBeenCalledTimes(2);
  } finally {
    released.resolve();
  }
});
