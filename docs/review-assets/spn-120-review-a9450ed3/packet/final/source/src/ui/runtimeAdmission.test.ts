import { afterEach, expect, test, vi } from 'vitest';
import { ensureDeviceRuntime } from '../../web/offline/localStart.ts';
import { installRuntimeHost, runtimeRequest } from '../../web/offline/runtime.ts';
import {
  openExistingOfflineStore,
  withOfflineCatalogLock,
} from '../../web/offline/offlineStore.ts';
import type { OfflineStore } from '../../web/offline/offlineStore.ts';
import { readRuntimeState, writeRuntimeState } from '../../web/offline/runtimeStore.ts';
import type { RuntimeState } from '../../web/offline/runtimeStore.ts';
import type { AccountRuntimeRequirement, ShellManifest } from '../shared/offlineShell.ts';

// Only the private read and public durable-write boundaries are held. The real
// startup admission, catalog lock, RPC, and worker release handler run together.
vi.mock('../../web/offline/offlineStore.ts', async (original) => ({
  ...(await original<typeof import('../../web/offline/offlineStore.ts')>()),
  openExistingOfflineStore: vi.fn(),
}));
vi.mock('../../web/offline/runtimeStore.ts', async (original) => ({
  ...(await original<typeof import('../../web/offline/runtimeStore.ts')>()),
  readRuntimeState: vi.fn(),
  writeRuntimeState: vi.fn(),
}));

const manifest: ShellManifest = {
  protocol: 1,
  version: 'a'.repeat(16),
  compatibility: { format: 1, sdkVersion: '1.1.0' },
  entry: '/assets/application-a.js',
  css: [],
  files: ['/assets/application-a.js'],
};
const ports: MessagePort[] = [];
let receive: ((event: ExtendableMessageEvent) => void) | undefined;
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const queues = new Map<string, Promise<unknown>>();
  const locks = {
    request<T>(name: string, operation: () => Promise<T>) {
      const result = (queues.get(name) ?? Promise.resolve()).then(operation);
      queues.set(
        name,
        result.catch(() => {}),
      );
      return result;
    },
  };
  let state: RuntimeState = {
    version: 1,
    builds: [manifest],
    accounts: { owner: manifest.compatibility, other: manifest.compatibility },
    clients: { 'actual-client': [manifest.version] },
    legacyCompatibility: manifest.compatibility,
  };
  const post = vi.fn((data: unknown, transferred: MessagePort[]) => {
    ports.push(...transferred);
    queueMicrotask(() =>
      receive!({
        data,
        ports: transferred,
        source: { id: 'actual-client' },
        waitUntil: () => {},
      } as unknown as ExtendableMessageEvent),
    );
  });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { isSecureContext: true }));
  vi.stubGlobal('navigator', {
    locks,
    serviceWorker: { ready: Promise.resolve({ active: { postMessage: post } }) },
  });
  vi.stubGlobal('self', {
    navigator: { locks },
    clients: { matchAll: async () => [{ id: 'actual-client' }] },
    addEventListener(type: string, listener: (event: ExtendableMessageEvent) => void) {
      if (type === 'message') receive = listener;
    },
  });
  installRuntimeHost({ manifest, compatibility: manifest.compatibility, switchTo: vi.fn() });
  vi.mocked(readRuntimeState).mockImplementation(async () => structuredClone(state));
  const write = vi.mocked(writeRuntimeState).mockImplementation(async (next, verify) => {
    verify();
    state = structuredClone(next);
  });
  const requirement = vi.fn<() => Promise<AccountRuntimeRequirement>>(async () => ({
    kind: 'empty',
  }));
  const close = vi.fn();
  vi.mocked(openExistingOfflineStore).mockResolvedValue({
    runtimeRequirement: requirement,
    close,
  } as unknown as OfflineStore);
  await import('../../web/service-worker.ts');
  return {
    post,
    write,
    requirement,
    close,
    read: () => structuredClone(state),
    commit: (next: RuntimeState) => {
      state = structuredClone(next);
    },
  };
}

test('verified-empty admission holds the catalog until account release completes before another insertion', async () => {
  const f = await fixture();
  const entered = deferred(),
    held = deferred();
  const order: string[] = [];
  f.requirement.mockImplementationOnce(async () => {
    order.push('verified-empty');
    return { kind: 'empty' };
  });
  f.write.mockImplementationOnce(async (state, verify) => {
    order.push('release-started');
    entered.resolve();
    await held.promise;
    verify();
    f.commit(state);
    order.push('release-completed');
  });
  const admission = ensureDeviceRuntime('owner', () => {});
  await entered.promise;
  const insert = vi.fn(async () => {
    order.push('catalog-insertion');
  });
  const next = withOfflineCatalogLock('owner', insert);
  await Promise.resolve();
  expect(insert).not.toHaveBeenCalled();
  expect(f.read().accounts.owner).toEqual(manifest.compatibility);
  held.resolve();
  expect(await admission).toEqual({ kind: 'ready', buildId: manifest.version });
  await next;
  expect(order).toEqual([
    'verified-empty',
    'release-started',
    'release-completed',
    'catalog-insertion',
  ]);
  expect(f.read().accounts).toEqual({ other: manifest.compatibility });
  expect(f.read().legacyCompatibility).toEqual(manifest.compatibility);
  expect(f.close).toHaveBeenCalledOnce();
});

test.each(['unknown', 'unreadable', 'open-failure'] as const)(
  '%s private data never releases any compatibility hold',
  async (failure) => {
    const f = await fixture();
    const before = f.read();
    if (failure === 'unknown') f.requirement.mockResolvedValue({ kind: 'unknown' });
    else if (failure === 'unreadable')
      f.requirement.mockRejectedValue(new Error('The existing data could not be read.'));
    else
      vi.mocked(openExistingOfflineStore).mockRejectedValueOnce(new Error('Storage unavailable.'));
    expect(await ensureDeviceRuntime('owner', () => {})).toEqual({
      kind: 'unavailable',
      reason: 'unknown-format',
    });
    expect(f.post).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.read()).toEqual(before);
  },
);

test('a failed empty-account release retains its holds without blocking compatible online admission', async () => {
  const f = await fixture();
  const before = f.read();
  f.write.mockRejectedValueOnce(new Error('The public control write failed.'));
  expect(await ensureDeviceRuntime('owner', () => {})).toEqual({
    kind: 'ready',
    buildId: manifest.version,
  });
  expect(f.read()).toEqual(before);
});

test.each([
  {
    name: 'an empty quota exception',
    failure: new DOMException('', 'QuotaExceededError'),
    message: 'This device is out of space for offline documents.',
  },
  {
    name: 'an empty error',
    failure: new Error(''),
    message: 'Offline app storage is unavailable.',
  },
  {
    name: 'a whitespace-only error',
    failure: new Error(' \t\n '),
    message: 'Offline app storage is unavailable.',
  },
  {
    name: 'a meaningful error',
    failure: new Error('The public control write failed.'),
    message: 'The public control write failed.',
  },
])('worker reports $name without changing durable control state', async ({ failure, message }) => {
  const f = await fixture();
  const before = f.read();
  f.write.mockRejectedValueOnce(failure);
  await expect(runtimeRequest('release', manifest.version, 'owner')).rejects.toMatchObject({
    message,
  });
  expect(f.write).toHaveBeenCalledOnce();
  expect(f.read()).toEqual(before);
});

test('an empty error reply from an older worker receives an actionable fallback', async () => {
  const f = await fixture();
  const before = f.read();
  f.post.mockImplementationOnce((_data, transferred) => {
    ports.push(...transferred);
    transferred[0].postMessage({ ok: false, error: '' });
  });
  await expect(runtimeRequest('release', manifest.version, 'owner')).rejects.toMatchObject({
    message: 'Offline app storage is unavailable.',
  });
  expect(f.write).not.toHaveBeenCalled();
  expect(f.read()).toEqual(before);
});
