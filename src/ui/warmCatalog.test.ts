import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FileItem } from '../shared/workspace.ts';
import type { OfflineCatalog, OfflineStore } from '../../web/offline/offlineStore.ts';
import type { DeviceInventory } from '../../web/offline/deviceStorage.ts';

const boundary = vi.hoisted(() => ({
  open: vi.fn<() => Promise<OfflineStore | null>>(),
  inventory: vi.fn<() => Promise<DeviceInventory>>(),
  prepared: vi.fn<() => string | null>(),
  current: vi.fn<() => boolean>(),
}));
vi.mock('../../web/offline/offlineStore.ts', () => ({
  openExistingOfflineStore: boundary.open,
  preparedAccount: boundary.prepared,
  offlineAccountRead: () => boundary.current,
}));
vi.mock('../../web/offline/deviceStorage.ts', () => ({ readDeviceInventory: boundary.inventory }));
import { readWarmFailureView } from '../../web/offline/warmCatalog.ts';

const doc: FileItem = {
  id: 'doc',
  name: 'Saved document',
  kind: 'doc',
  access: 'owner',
  parentId: null,
  createdAt: 1,
  updatedAt: 1,
  tags: [],
};
const catalog: OfflineCatalog = { syncedAt: 1, items: [doc], shared: [], views: {} };
let close: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  close = vi.fn();
  boundary.prepared.mockReturnValue('account');
  boundary.current.mockReturnValue(true);
  boundary.open.mockResolvedValue({
    catalog: async () => catalog,
    close,
  } as unknown as OfflineStore);
  boundary.inventory.mockResolvedValue({
    state: 'ready',
    items: [{ itemId: 'doc', available: true }],
  } as DeviceInventory);
});
afterEach(() => vi.restoreAllMocks());

// A deep link must not depend on a successful list request in the new Dashboard.
test('uses the prepared catalog and verified copy before in-memory rows load', async () => {
  expect(await readWarmFailureView('account', 'doc', () => true)).toEqual({
    kind: 'device',
    rows: [doc],
  });
  expect(close).toHaveBeenCalledOnce();
});

test('a missing, evicted or incompatible copy cannot open from catalog metadata alone', async () => {
  for (const items of [[], [{ itemId: 'doc', available: false }]]) {
    boundary.inventory.mockResolvedValue({ state: 'unavailable', items } as DeviceInventory);
    expect(await readWarmFailureView('account', 'doc', () => true)).toBeNull();
  }
});

test('another or unprepared account is never opened', async () => {
  for (const account of ['other', null]) {
    boundary.prepared.mockReturnValue(account);
    expect(await readWarmFailureView('account', 'doc', () => true)).toBeNull();
  }
  expect(boundary.open).not.toHaveBeenCalled();
});

test('navigation or account cancellation during the read cannot publish a saved view', async () => {
  let resolve!: (value: DeviceInventory) => void;
  boundary.inventory.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let current = true;
  const result = readWarmFailureView('account', 'doc', () => current);
  await vi.waitFor(() => expect(boundary.inventory).toHaveBeenCalledOnce());
  current = false;
  resolve({ items: [{ itemId: 'doc', available: true }] } as DeviceInventory);
  expect(await result).toBeNull();
  expect(close).toHaveBeenCalledOnce();
});

test('account cancellation after store opening closes without reading private data', async () => {
  const read = vi.fn(async () => catalog);
  boundary.open.mockImplementation(async () => {
    boundary.current.mockReturnValue(false);
    return { catalog: read, close } as unknown as OfflineStore;
  });
  expect(await readWarmFailureView('account', 'doc', () => true)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

test('missing or unreadable storage fails closed and closes any opened handle', async () => {
  boundary.open.mockResolvedValue(null);
  expect(await readWarmFailureView('account', 'doc', () => true)).toBeNull();
  boundary.open.mockResolvedValue({
    catalog: async () => {
      throw new Error('storage');
    },
    close,
  } as unknown as OfflineStore);
  expect(await readWarmFailureView('account', 'doc', () => true)).toBeNull();
  expect(close).toHaveBeenCalledOnce();
});
