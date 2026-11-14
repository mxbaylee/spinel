import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { locks } from 'node:worker_threads';
import { watchOfflineReplay } from '../../web/offline/replay.ts';
import { replayOfflineItem } from '../../web/offline/replayHost.ts';
import * as storage from '../../web/offline/offlineStore.ts';
import type { OfflineDownload, OfflineStore } from '../../web/offline/offlineStore.ts';

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
