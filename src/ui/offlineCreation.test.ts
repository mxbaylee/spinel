import { afterEach, expect, test, vi } from 'vitest';
import type { OfflineBundle } from '../shared/offlineBundle.ts';
import { blankOfflineSnapshot } from '../shared/offlineCreation.ts';
import type { OfflineCreationRequest } from '../shared/offlineCreation.ts';
import { snapshotIdentity } from '../shared/snapshotIdentity.ts';
import { OfflineSession } from '../../web/offline/OfflineSession.ts';
import {
  creationFolderAllowed,
  downloadSummary,
  hasOfflineEdits,
  hasStoredEdits,
  isKnownOfflineOutbox,
  setPreparedAccount,
} from '../../web/offline/offlineStore.ts';
import type { OfflineCreation, OfflineOutbox, StoredItem } from '../../web/offline/offlineStore.ts';
import {
  creationFile,
  relocateOfflineCreation,
  uploadOfflineCreation,
} from '../../web/offline/creation.ts';
import type { OfflineStore } from '../../web/offline/offlineStore.ts';

const account = 'offline-creator';
const input: OfflineCreationRequest = {
  version: 1,
  itemId: '5f8512d6-0c1f-4407-881c-707ee3388397',
  unitId: '45045848-aa4c-49de-ae40-275ead039cfe',
  kind: 'doc',
  name: 'Fresh notes',
  parentId: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stored(kind: 'sheet' | 'doc' = 'doc'): StoredItem {
  const request = { ...input, kind };
  const creation: OfflineCreation = { request, createdAt: 1000 };
  const bundle = {
    version: 1,
    accountId: account,
    itemId: input.itemId,
    unitId: input.unitId,
    name: input.name,
    kind,
    access: 'owner',
    readOnly: false,
    revision: 1,
    revisionOffset: 0,
    sdkVersion: '1.1.0',
    images: [],
    snapshot: blankOfflineSnapshot(request),
  } as OfflineBundle;
  const outbox: OfflineOutbox = {
    version: 1,
    account,
    item: input.itemId,
    unitId: input.unitId,
    revisionOffset: 0,
    creation: true,
    checkpoint: {
      version: 1,
      unitId: input.unitId,
      revision: 1,
      snapshot: snapshotIdentity(bundle.snapshot, input.unitId),
      sent: null,
      inflight: [],
      buffer: [],
    },
  };
  return {
    itemId: input.itemId,
    name: input.name,
    kind,
    readOnly: false,
    revision: 1,
    downloadedAt: 1000,
    bundle,
    outbox,
    creation,
  };
}

function session() {
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
  setPreparedAccount(account);
  const record = stored();
  const download = {
    bundle: record.bundle,
    outbox: record.outbox,
    creation: record.creation,
    bytes: new Map<string, Uint8Array>(),
  };
  const store = {
    updateCreation: vi.fn(
      async (
        _id: string,
        _expected: OfflineCreation,
        _next: OfflineCreation | undefined,
        verify: () => void,
      ) => {
        verify();
      },
    ),
    saveCheckpoint: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const value = new OfflineSession(account, input.itemId, undefined, () => true);
  Object.assign(value, { store, download, releaseWriter: vi.fn() });
  return { value, store, download };
}

function accepted() {
  return Response.json(
    {
      item: creationFile(stored().creation!),
      unitId: input.unitId,
      revision: 1,
      revisionOffset: 0,
      syncVersion: 1,
    },
    { status: 201 },
  );
}

test.each(['sheet', 'doc'] as const)(
  'an unedited new %s is durable pending work, including its old-reader marker',
  (kind) => {
    const item = stored(kind);
    expect(isKnownOfflineOutbox(item.outbox)).toBe(true);
    expect(hasOfflineEdits(item.outbox)).toBe(true);
    expect(hasStoredEdits(item)).toBe(true);
    expect(downloadSummary(item, account, input.itemId)).toMatchObject({
      pending: true,
      creation: { parentId: null, createdAt: 1000 },
    });
    expect(downloadSummary(item, account, input.itemId).uncertain).toBeUndefined();
    delete item.creation;
    expect(downloadSummary(item, account, input.itemId)).toMatchObject({
      pending: true,
      uncertain: true,
    });
    delete item.outbox!.creation;
    expect(hasStoredEdits(item)).toBe(false);
  },
);

test.each(['marker', 'account', 'unit', 'kind', 'parent', 'name'] as const)(
  'malformed creation %s is retained and never admitted as a clean download',
  (field) => {
    const item = stored();
    if (field === 'marker') delete item.outbox!.creation;
    if (field === 'account') item.bundle.accountId = 'another';
    if (field === 'unit') item.creation!.request.unitId = input.itemId;
    if (field === 'kind') item.creation!.request.kind = 'sheet';
    if (field === 'parent') item.creation!.request.parentId = 'not-an-id';
    if (field === 'name') item.creation!.request.name = 'Different';
    expect(downloadSummary(item, account, input.itemId)).toMatchObject({
      pending: true,
      uncertain: true,
      available: false,
    });
    expect(hasStoredEdits(item)).toBe(true);
  },
);

test('local folder admission accepts only the account root and owned ordinary folders', () => {
  const file = creationFile(stored().creation!);
  const catalog = {
    syncedAt: 1,
    items: [{ ...file, id: 'own', kind: 'folder' as const }],
    shared: [],
    views: {
      opened: [
        { ...file, id: 'shared', kind: 'folder' as const, access: 'editor' as const },
        { ...file, id: 'space', kind: 'space' as const },
      ],
    },
  };
  expect(creationFolderAllowed(catalog, null)).toBe(true);
  expect(creationFolderAllowed(catalog, 'own')).toBe(true);
  for (const id of ['shared', 'space', 'missing'])
    expect(creationFolderAllowed(catalog, id)).toBe(false);
});

test('simultaneous reconnect checks send one request and clear creation only after the local acknowledgement commits', async () => {
  const f = session();
  let respond!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  let finish!: () => void;
  f.store.updateCreation.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = f.value.ensureCreated(new AbortController().signal);
  const second = f.value.ensureCreated(new AbortController().signal);
  expect(fetcher).toHaveBeenCalledOnce();
  respond(accepted());
  await vi.waitFor(() => expect(f.store.updateCreation).toHaveBeenCalledOnce());
  expect(f.value.creation).toBeDefined();
  expect(f.value.pending).toBe(true);
  finish();
  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe(true);
  expect(f.value.creation).toBeUndefined();
  expect(f.value.pending).toBe(false);
  expect(f.download.outbox!.checkpoint.snapshot.id).toBe(input.unitId);
  f.value.dispose();
});

test('lost acknowledgement and failed local cleanup retry the exact original creation without losing the checkpoint', async () => {
  const f = session();
  const checkpoint = structuredClone(f.download.outbox!.checkpoint);
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockImplementation(async () => accepted());
  vi.stubGlobal('fetch', fetcher);
  await expect(f.value.ensureCreated(new AbortController().signal)).rejects.toThrow(
    'lost response',
  );
  f.store.updateCreation.mockRejectedValueOnce(new Error('disk full'));
  await expect(f.value.ensureCreated(new AbortController().signal)).rejects.toThrow('disk full');
  expect(f.value.pending).toBe(true);
  expect(f.value.creation?.canRelocate).not.toBe(true);
  await expect(f.value.ensureCreated(new AbortController().signal)).resolves.toBe(true);
  expect(fetcher.mock.calls.map((call) => (call[1] as RequestInit).body)).toEqual([
    JSON.stringify(input),
    JSON.stringify(input),
    JSON.stringify(input),
  ]);
  expect(f.download.outbox!.checkpoint).toEqual(checkpoint);
  f.value.dispose();
});

test('a definitive folder rejection stays local and enables explicit relocation without sending native edits', async () => {
  const f = session();
  const fetcher = vi.fn(async () =>
    Response.json({ code: 'folder-unavailable', error: 'Unavailable' }, { status: 403 }),
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(f.value.ensureCreated(new AbortController().signal)).resolves.toBe(false);
  expect(f.value.creation).toMatchObject({ canRelocate: true, request: input });
  expect(f.value.pending).toBe(true);
  expect(f.value.problem).toContain('choose another folder');
  await expect(f.value.ensureCreated(new AbortController().signal)).resolves.toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
  f.value.dispose();
});

test('an accepted creation conflict never authorizes redirecting the retry to another folder', async () => {
  const f = session();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ code: 'creation-conflict', error: 'Changed' }, { status: 409 }),
    ),
  );
  await expect(f.value.ensureCreated(new AbortController().signal)).resolves.toBe(false);
  expect(f.value.creation?.canRelocate).toBe(false);
  expect(f.value.pending).toBe(true);
  f.value.dispose();
});

test('an obsolete account cannot consume a delayed successful creation acknowledgement', async () => {
  const f = session();
  let respond!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    ),
  );
  const pending = f.value.ensureCreated(new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow('no longer current');
  setPreparedAccount('another-account');
  respond(accepted());
  await rejected;
  expect(f.store.updateCreation).not.toHaveBeenCalled();
  expect(f.value.pending).toBe(true);
  f.value.dispose();
});

test('a response for another native generation cannot clear a local creation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        item: creationFile(stored().creation!),
        unitId: input.itemId,
        revision: 1,
        revisionOffset: 0,
        syncVersion: 1,
      }),
    ),
  );
  await expect(
    uploadOfflineCreation(account, input, new AbortController().signal, () => {}),
  ).rejects.toThrow('could not be verified');
});

test('relocation keeps IDs and checkpoint identity, and only follows a definitive folder rejection', async () => {
  const original = stored();
  const updateCreation = vi.fn(async () => {});
  const store = {
    bundle: vi.fn(async () => original),
    catalog: vi.fn(async () => ({ syncedAt: 1, items: [], shared: [], views: {} })),
    updateCreation,
  } as unknown as OfflineStore;
  await expect(relocateOfflineCreation(store, input.itemId, null, () => {})).rejects.toThrow(
    'check its original upload',
  );
  expect(updateCreation).not.toHaveBeenCalled();
  original.creation!.canRelocate = true;
  original.creation!.problem = 'Folder unavailable';
  await expect(relocateOfflineCreation(store, input.itemId, null, () => {})).resolves.toMatchObject(
    { id: input.itemId },
  );
  expect(updateCreation).toHaveBeenCalledWith(
    input.itemId,
    original.creation,
    { request: input, createdAt: 1000 },
    expect.any(Function),
  );
});
