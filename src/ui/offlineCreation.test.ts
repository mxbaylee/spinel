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
  isOfflineCatalog,
  OfflineStore,
  setPreparedAccount,
} from '../../web/offline/offlineStore.ts';
import type {
  OfflineCatalog,
  OfflineCreation,
  OfflineOutbox,
  StoredItem,
} from '../../web/offline/offlineStore.ts';
import {
  creationFile,
  relocateOfflineCreation,
  uploadOfflineCreation,
} from '../../web/offline/creation.ts';

const account = 'offline-creator';
const sharedParent = '3b00563e-a3c2-42c2-9727-d3c6163dc25f';
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

function sharedCreation(kind: 'sheet' | 'doc' = 'doc', access: 'editor' | 'admin' = 'editor') {
  const record = stored(kind);
  record.creation = {
    ...record.creation!,
    request: { ...record.creation!.request, parentId: sharedParent },
    access,
    ownerName: 'Folder owner',
    createdByName: 'Creator',
  };
  record.bundle.access = access;
  return record;
}

function session(record = stored()) {
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

function accepted(item = creationFile(stored().creation!)) {
  return Response.json(
    {
      item,
      unitId: input.unitId,
      revision: 1,
      revisionOffset: 0,
      syncVersion: 1,
    },
    { status: 201 },
  );
}

test('accepted metadata carries a verified local acknowledgement revision without marking clean edits pending', () => {
  const item = stored();
  item.createdFile = creationFile(item.creation!);
  item.createdFileRevision = 2;
  delete item.creation;
  delete item.outbox!.creation;
  expect(downloadSummary(item, account, input.itemId)).toMatchObject({
    createdFile: item.createdFile,
    createdFileRevision: 2,
    pending: false,
  });
  delete item.createdFileRevision;
  expect(downloadSummary(item, account, input.itemId)).toMatchObject({
    uncertain: true,
    pending: true,
  });
});

test('catalog cutoffs accept legacy zero and reject invalid creation ordering', () => {
  const catalog = { syncedAt: 1000, items: [], shared: [], views: {} };
  expect(isOfflineCatalog(catalog)).toBe(true);
  for (const field of ['creationRevision', 'sharedCreationRevision']) {
    for (const revision of [0, 1, Number.MAX_SAFE_INTEGER])
      expect(isOfflineCatalog({ ...catalog, [field]: revision })).toBe(true);
    for (const revision of [-1, 0.5, '1', null, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(isOfflineCatalog({ ...catalog, [field]: revision })).toBe(false);
  }

  const item = stored();
  item.createdFile = creationFile(item.creation!);
  delete item.creation;
  delete item.outbox!.creation;
  for (const createdFileRevision of [0, -1, 0.5, '1', Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(downloadSummary({ ...item, createdFileRevision }, account, input.itemId)).toMatchObject({
      uncertain: true,
      pending: true,
    });
});

/** Exercise the real store's read/write ordering; browser tests prove native IDB atomicity. */
function creationStorage(revision?: unknown) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {
    locks: { request: async (_name: string, operation: () => Promise<unknown>) => operation() },
  });
  const record = stored();
  const values = {
    items: new Map<string, unknown>([[input.itemId, record]]),
    meta: new Map<string, unknown>([
      ['catalog', { syncedAt: 10_000, creationRevision: 7, items: [], shared: [], views: {} }],
      ['user', { id: account, name: 'Creator' }],
      ...(revision === undefined ? [] : [['creationRevision', revision] as [string, unknown]]),
    ]),
  };
  const database = {
    transaction() {
      const writes: { store: 'items' | 'meta'; key: string; value: unknown }[] = [];
      let aborted = false;
      let completing = false;
      const complete = () => {
        if (completing) return;
        completing = true;
        setTimeout(() => {
          if (aborted) return;
          for (const write of writes) values[write.store].set(write.key, write.value);
          transaction.oncomplete?.();
        }, 0);
      };
      const transaction = {
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        error: null,
        objectStore(store: 'items' | 'meta') {
          return {
            get(key: string) {
              const reading = {
                result: structuredClone(values[store].get(key)),
                onsuccess: undefined as (() => void) | undefined,
              };
              queueMicrotask(() => reading.onsuccess?.());
              complete();
              return reading;
            },
            put(value: unknown, key?: string) {
              writes.push({
                store,
                key: key ?? (value as StoredItem).itemId,
                value: structuredClone(value),
              });
              complete();
            },
            add(value: unknown) {
              writes.push({
                store,
                key: (value as StoredItem).itemId,
                value: structuredClone(value),
              });
              complete();
            },
          };
        },
        abort() {
          aborted = true;
          transaction.onabort?.();
        },
      };
      return transaction;
    },
  };
  return { values, record, store: new OfflineStore(account, database as unknown as IDBDatabase) };
}

test('a delayed older catalog cannot restore a file omitted by an authoritative post-creation list', async () => {
  const f = creationStorage(1);
  f.values.meta.delete('catalog');
  const file = creationFile(f.record.creation!);
  f.record.createdFile = file;
  f.record.createdFileRevision = 1;
  delete f.record.creation;
  delete f.record.outbox!.creation;
  const user = { id: account, name: 'Creator' };
  const authoritative = { syncedAt: 2000, creationRevision: 1, items: [], shared: [], views: {} };
  await f.store.saveCatalog(user, authoritative);
  // These earlier requests finish later. Their newer wall clocks do not grant
  // authority to undo an observed deletion or reactivate the metadata fallback.
  await f.store.saveCatalog(user, {
    syncedAt: 3000,
    creationRevision: 0,
    items: [file],
    shared: [],
    views: { [file.id]: [file] },
  });
  await f.store.saveCatalog(user, { syncedAt: 4000, items: [file], shared: [], views: {} });
  expect(await f.store.catalog()).toEqual(authoritative);
  const summary = downloadSummary(f.record, account, input.itemId);
  expect(summary.createdFileRevision! > (await f.store.catalog())!.creationRevision!).toBe(false);
});

test('missing and legacy catalogs accept zero cutoffs and equally or newer ordered replacements', async () => {
  const f = creationStorage();
  f.values.meta.delete('catalog');
  const user = { id: account, name: 'Creator' };
  const legacy = { syncedAt: 1000, items: [], shared: [], views: {} };
  await f.store.saveCatalog(user, legacy);
  expect(await f.store.catalog()).toEqual(legacy);
  const equal = {
    ...legacy,
    syncedAt: 2000,
    creationRevision: 0,
    items: [creationFile(f.record.creation!)],
  };
  await f.store.saveCatalog(user, equal);
  expect(await f.store.catalog()).toEqual(equal);
  const newer = { ...legacy, syncedAt: 3000, creationRevision: 1 };
  await f.store.saveCatalog(user, newer);
  expect(await f.store.catalog()).toEqual(newer);
});

test('creation acknowledgement orders metadata without the wall clock and preserves the full-list cutoff', async () => {
  const f = creationStorage(8);
  const acceptedFile = creationFile(f.record.creation!);
  vi.spyOn(Date, 'now').mockReturnValue(-1000);
  await f.store.updateCreation(input.itemId, f.record.creation!, undefined, () => {}, acceptedFile);
  expect(await f.store.creationRevision()).toBe(9);
  expect(f.values.items.get(input.itemId)).toMatchObject({
    createdFile: acceptedFile,
    createdFileRevision: 9,
  });
  expect((f.values.items.get(input.itemId) as StoredItem).creation).toBeUndefined();
  expect(f.values.meta.get('catalog')).toMatchObject({
    creationRevision: 7,
    items: [acceptedFile],
  });
  // The stored ordering survives a new reader and cannot go backward with time.
  expect(await f.store.creationRevision()).toBe(9);
});

test('a shared creation acknowledgement survives local restart in the shared catalog with the verified current role', async () => {
  const f = creationStorage(8);
  const original = sharedCreation();
  f.values.items.set(input.itemId, original);
  const acceptedFile = { ...creationFile(original.creation!), access: 'admin' as const };
  const checkpoint = structuredClone(original.outbox!.checkpoint);
  await f.store.updateCreation(input.itemId, original.creation!, undefined, () => {}, acceptedFile);
  const persisted = structuredClone(f.values.items.get(input.itemId)) as StoredItem;
  expect(downloadSummary(persisted, account, input.itemId)).toMatchObject({
    createdFile: {
      access: 'admin',
      ownerName: 'Folder owner',
      createdByName: 'Creator',
      parentId: sharedParent,
    },
    createdFileRevision: 9,
    pending: false,
  });
  expect(downloadSummary(persisted, account, input.itemId).uncertain).toBeUndefined();
  expect(persisted.bundle.access).toBe('admin');
  expect(persisted.outbox!.checkpoint).toEqual(checkpoint);
  expect(await f.store.catalog()).toMatchObject({ items: [], shared: [acceptedFile] });
});

test.each(['owner', 'editor'] as const)(
  'accepted %s metadata survives device removal and the other list refreshing before its own delayed response',
  async (access) => {
    const f = creationStorage(8);
    const original = access === 'owner' ? stored() : sharedCreation();
    f.values.items.set(input.itemId, original);
    const acceptedFile = creationFile(original.creation!);
    await f.store.updateCreation(
      input.itemId,
      original.creation!,
      undefined,
      () => {},
      acceptedFile,
    );
    const acceptedRevision = await f.store.creationRevision();
    expect(acceptedRevision).toBe(9);
    // Removing the native copy must not remove the acknowledged file metadata.
    // The browser test exercises the real Remove from device action as well.
    f.values.items.delete(input.itemId);
    const shared = access !== 'owner';
    const delayed: OfflineCatalog = {
      syncedAt: 20_000,
      creationRevision: shared ? 9 : 7,
      sharedCreationRevision: shared ? 0 : 9,
      items: [],
      shared: [],
      views: { [sharedParent]: [] },
    };
    const user = { id: account, name: 'Creator' };
    await f.store.saveCatalog(user, delayed);
    const retained = (await f.store.catalog())!;
    expect(retained[shared ? 'shared' : 'items']).toEqual([acceptedFile]);
    expect(retained[shared ? 'items' : 'shared']).toEqual([]);
    expect(retained.creationMetadata).toEqual([{ item: acceptedFile, revision: 9 }]);
    expect(retained.views[input.itemId]).toEqual([acceptedFile]);
    if (shared) expect(retained.views[sharedParent]).toEqual([acceptedFile]);
    expect(f.values.items.has(input.itemId)).toBe(false);

    // The matching post-acknowledgement list can move/rename the file even when
    // the other partition is stale. Old folder views follow its canonical parent.
    const moved = { ...acceptedFile, name: 'Moved after upload', parentId: 'new-parent' };
    await f.store.saveCatalog(user, {
      ...delayed,
      creationRevision: shared ? 8 : 9,
      sharedCreationRevision: shared ? 9 : 8,
      [shared ? 'shared' : 'items']: [moved],
      views: { [sharedParent]: [acceptedFile], 'new-parent': [] },
    });
    const authoritative = (await f.store.catalog())!;
    expect(authoritative.creationRevision).toBe(9);
    expect(authoritative.sharedCreationRevision).toBe(9);
    expect(authoritative[shared ? 'shared' : 'items']).toEqual([moved]);
    expect(authoritative.creationMetadata).toBeUndefined();
    expect(authoritative.views[sharedParent]).toEqual([]);
    expect(authoritative.views['new-parent']).toEqual([moved]);
    expect(authoritative.views[input.itemId]).toEqual([moved]);

    // A later revocation/trash remains authoritative when a stale opposite-list
    // save still carries the original acceptance metadata and old folder view.
    await f.store.saveCatalog(user, {
      ...authoritative,
      items: [],
      shared: [],
      views: {},
    });
    await f.store.saveCatalog(user, {
      ...retained,
      creationRevision: shared ? 10 : 7,
      sharedCreationRevision: shared ? 0 : 10,
    });
    const revoked = (await f.store.catalog())!;
    expect(revoked.items).toEqual([]);
    expect(revoked.shared).toEqual([]);
    expect(Object.values(revoked.views).flat()).toEqual([]);
    expect(revoked.creationMetadata).toBeUndefined();
  },
);

for (const originalAccess of ['owner', 'editor'] as const)
  test.each([false, true])(
    `${originalAccess} creation reconciles a later ownership transfer only with a current opposite list (%s)`,
    async (oppositeCurrent) => {
      const f = creationStorage(8);
      const original = originalAccess === 'owner' ? stored() : sharedCreation();
      original.creation!.request.parentId = sharedParent;
      f.values.items.set(input.itemId, original);
      const acceptedFile = creationFile(original.creation!);
      await f.store.updateCreation(
        input.itemId,
        original.creation!,
        undefined,
        () => {},
        acceptedFile,
      );
      f.values.items.delete(input.itemId);
      const originallyOwned = originalAccess === 'owner';
      const transferred = {
        ...acceptedFile,
        name: 'Transferred file',
        access: originallyOwned ? ('editor' as const) : ('owner' as const),
        parentId: 'new-parent',
        ownerName: originallyOwned ? 'New owner' : undefined,
        createdByName: 'Creator',
      };
      const oppositeCutoff = oppositeCurrent ? 9 : 8;
      await f.store.saveCatalog(
        { id: account, name: 'Creator' },
        {
          syncedAt: 20_000,
          creationRevision: originallyOwned ? 9 : oppositeCutoff,
          sharedCreationRevision: originallyOwned ? oppositeCutoff : 9,
          items: originallyOwned ? [] : [transferred],
          shared: originallyOwned ? [transferred] : [],
          views: {
            [sharedParent]: [acceptedFile],
            [input.itemId]: [acceptedFile],
            'new-parent': [],
          },
        },
      );
      const catalog = (await f.store.catalog())!;
      expect(catalog.items).toEqual(originallyOwned ? [] : [transferred]);
      expect(catalog.shared).toEqual(originallyOwned ? [transferred] : []);
      expect(catalog.creationMetadata).toBeUndefined();
      expect(catalog.views[sharedParent]).toEqual([]);
      expect(catalog.views[input.itemId]).toEqual(oppositeCurrent ? [transferred] : []);
      expect(catalog.views['new-parent']).toEqual(oppositeCurrent ? [transferred] : []);
    },
  );

test('retained creation metadata validates its file and acknowledgement without changing legacy catalogs', () => {
  const catalog: OfflineCatalog = { syncedAt: 1, items: [], shared: [], views: {} };
  const item = creationFile(sharedCreation().creation!);
  expect(isOfflineCatalog({ ...catalog, creationMetadata: [{ item, revision: 1 }] })).toBe(true);
  for (const revision of [0, -1, 1.5, '1', null, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(isOfflineCatalog({ ...catalog, creationMetadata: [{ item, revision }] })).toBe(false);
  for (const invalid of [null, { ...item, kind: 'folder' }, { ...item, createdByName: 7 }])
    expect(
      isOfflineCatalog({ ...catalog, creationMetadata: [{ item: invalid, revision: 1 }] }),
    ).toBe(false);
});

test.each(['sheet', 'doc'] as const)(
  'saving a shared %s derives its role and account-only attribution atomically from the prepared destination',
  async (kind) => {
    const f = creationStorage();
    const original = stored(kind);
    original.creation!.request.parentId = sharedParent;
    const folder = {
      ...creationFile(original.creation!),
      id: sharedParent,
      parentId: null,
      kind: 'folder' as const,
      access: 'editor' as const,
      ownerName: 'Folder owner',
    };
    f.values.items.delete(input.itemId);
    f.values.meta.set('catalog', { syncedAt: 1, items: [], shared: [folder], views: {} });
    const saved = await f.store.saveCreation(original.bundle, original.creation!, () => {});
    expect(saved).toMatchObject({
      pending: true,
      creation: {
        parentId: sharedParent,
        access: 'editor',
        ownerName: 'Folder owner',
        createdByName: 'Creator',
      },
    });
    const persisted = structuredClone(f.values.items.get(input.itemId)) as StoredItem;
    expect(persisted.creation!.request).toEqual(original.creation!.request);
    expect(persisted.bundle.access).toBe('editor');
    expect(downloadSummary(persisted, account, input.itemId).uncertain).toBeUndefined();
    expect(creationFile(persisted.creation!)).toMatchObject({
      id: input.itemId,
      parentId: sharedParent,
      access: 'editor',
      createdByName: 'Creator',
    });
    expect(hasStoredEdits(persisted)).toBe(true);
    expect(downloadSummary(persisted, 'other-account', input.itemId).uncertain).toBe(true);
  },
);

test('a shared viewer destination cannot create a local draft at the storage boundary', async () => {
  const f = creationStorage();
  const original = stored();
  original.creation!.request.parentId = sharedParent;
  f.values.items.delete(input.itemId);
  f.values.meta.set('catalog', {
    syncedAt: 1,
    items: [],
    shared: [
      { ...creationFile(original.creation!), id: sharedParent, kind: 'folder', access: 'viewer' },
    ],
    views: {},
  });
  await expect(f.store.saveCreation(original.bundle, original.creation!, () => {})).rejects.toThrow(
    'prepared folder',
  );
  expect(f.values.items.has(input.itemId)).toBe(false);
});

test('legacy creation counters begin at zero and invalid or exhausted counters retain the pending draft', async () => {
  const legacy = creationStorage();
  expect(await legacy.store.creationRevision()).toBe(0);
  await legacy.store.updateCreation(
    input.itemId,
    legacy.record.creation!,
    undefined,
    () => {},
    creationFile(legacy.record.creation!),
  );
  expect(await legacy.store.creationRevision()).toBe(1);
  for (const revision of [
    -1,
    0.5,
    '2',
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    const f = creationStorage(revision);
    if (revision !== Number.MAX_SAFE_INTEGER)
      await expect(f.store.creationRevision()).rejects.toThrow('could not be verified');
    await expect(
      f.store.updateCreation(
        input.itemId,
        f.record.creation!,
        undefined,
        () => {},
        creationFile(f.record.creation!),
      ),
    ).rejects.toThrow();
    expect(f.values.items.get(input.itemId)).toEqual(f.record);
    expect(f.values.meta.get('creationRevision')).toBe(revision);
  }
});

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

test.each(['marker', 'account', 'unit', 'kind', 'parent', 'name', 'role', 'creator'] as const)(
  'malformed creation %s is retained and never admitted as a clean download',
  (field) => {
    const item = stored();
    if (field === 'marker') delete item.outbox!.creation;
    if (field === 'account') item.bundle.accountId = 'another';
    if (field === 'unit') item.creation!.request.unitId = input.itemId;
    if (field === 'kind') item.creation!.request.kind = 'sheet';
    if (field === 'parent') item.creation!.request.parentId = 'not-an-id';
    if (field === 'name') item.creation!.request.name = 'Different';
    if (field === 'role') item.creation!.access = 'editor';
    if (field === 'creator') Object.assign(item.creation!, { createdByName: {} });
    expect(downloadSummary(item, account, input.itemId)).toMatchObject({
      pending: true,
      uncertain: true,
      available: false,
    });
    expect(hasStoredEdits(item)).toBe(true);
  },
);

test('local folder admission accepts prepared editable ordinary folders without admitting viewers or Spaces', () => {
  const file = creationFile(stored().creation!);
  const catalog: OfflineCatalog = {
    syncedAt: 1,
    items: [{ ...file, id: 'own', kind: 'folder' as const }],
    shared: [
      { ...file, id: 'shared', kind: 'folder' as const, access: 'editor' as const },
      { ...file, id: 'admin', kind: 'folder' as const, access: 'admin' as const },
      { ...file, id: 'viewer', kind: 'folder' as const, access: 'viewer' as const },
    ],
    views: {
      opened: [
        { ...file, id: 'nested', kind: 'folder' as const, access: 'editor' as const },
        { ...file, id: 'space', kind: 'space' as const },
      ],
    },
  };
  expect(creationFolderAllowed(catalog, null)).toBe(true);
  for (const id of ['own', 'shared', 'admin', 'nested'])
    expect(creationFolderAllowed(catalog, id)).toBe(true);
  for (const id of ['viewer', 'space', 'missing'])
    expect(creationFolderAllowed(catalog, id)).toBe(false);
  catalog.views.opened.push({
    ...file,
    id: 'shared',
    kind: 'folder' as const,
    access: 'viewer',
  });
  expect(creationFolderAllowed(catalog, 'shared')).toBe(false);
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

test('publication adopts the verified current shared role before checking native replay access', async () => {
  const original = sharedCreation();
  const f = session(original);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => accepted({ ...creationFile(original.creation!), access: 'admin' })),
  );
  await expect(f.value.ensureCreated(new AbortController().signal)).resolves.toBe(true);
  expect(f.value.bundle!.access).toBe('admin');
  expect(f.value.creation).toBeUndefined();
  expect(f.store.updateCreation).toHaveBeenCalledWith(
    input.itemId,
    original.creation,
    undefined,
    expect.any(Function),
    expect.objectContaining({ access: 'admin', createdByName: 'Creator', parentId: sharedParent }),
  );
  f.value.dispose();
});

test.each(['owner', 'editor', 'admin'] as const)(
  'lost acknowledgements retry the exact %s creation without losing its attribution or checkpoint',
  async (access) => {
    const original = access === 'owner' ? stored() : sharedCreation('doc', access);
    const creationRequest = structuredClone(original.creation!.request);
    const createdFile = creationFile(original.creation!);
    const f = session(original);
    const checkpoint = structuredClone(f.download.outbox!.checkpoint);
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockImplementation(async () => accepted(createdFile));
    vi.stubGlobal('fetch', fetcher);
    await expect(f.value.ensureCreated(new AbortController().signal)).rejects.toThrow(
      'lost response',
    );
    f.store.updateCreation.mockRejectedValueOnce(new Error('disk full'));
    await expect(f.value.ensureCreated(new AbortController().signal)).rejects.toThrow('disk full');
    expect(f.value.pending).toBe(true);
    expect(f.value.creation?.canRelocate).not.toBe(true);
    expect(creationFile(f.value.creation!)).toEqual(createdFile);
    await expect(f.value.ensureCreated(new AbortController().signal)).resolves.toBe(true);
    expect(fetcher.mock.calls.map((call) => (call[1] as RequestInit).body)).toEqual([
      JSON.stringify(creationRequest),
      JSON.stringify(creationRequest),
      JSON.stringify(creationRequest),
    ]);
    expect(f.download.outbox!.checkpoint).toEqual(checkpoint);
    f.value.dispose();
  },
);

test('a revoked shared-folder destination preserves its local work and only enables explicit relocation', async () => {
  const original = sharedCreation();
  const creationRequest = structuredClone(original.creation!.request);
  const f = session(original);
  const fetcher = vi.fn(async () =>
    Response.json({ code: 'folder-unavailable', error: 'Unavailable' }, { status: 403 }),
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(f.value.ensureCreated(new AbortController().signal)).resolves.toBe(false);
  expect(f.value.creation).toMatchObject({
    canRelocate: true,
    request: creationRequest,
    access: 'editor',
    ownerName: 'Folder owner',
    createdByName: 'Creator',
  });
  expect(f.value.pending).toBe(true);
  expect(f.value.problem).toContain('choose another folder');
  await expect(f.value.ensureCreated(new AbortController().signal)).resolves.toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
  f.value.dispose();
});

test('revocation after accepted shared creation never authorizes redirecting its immutable retry', async () => {
  const f = session(sharedCreation());
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

test('relocation keeps IDs, chosen appearance and checkpoint identity, and only follows a definitive folder rejection', async () => {
  const original = stored();
  const request = { ...input, icon: 'lucide:book-open', iconColor: 'info-strong' };
  original.creation!.request = request;
  const updateCreation = vi.fn(async () => ({ creation: { parentId: null, createdAt: 1000 } }));
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
    { id: input.itemId, appearance: { icon: request.icon, iconColor: request.iconColor } },
  );
  expect(updateCreation).toHaveBeenCalledWith(
    input.itemId,
    original.creation,
    { request, createdAt: 1000 },
    expect.any(Function),
  );
});

test('explicit relocation from a revoked shared folder to My files recomputes ownership without replacing edits', async () => {
  const f = creationStorage();
  const original = sharedCreation();
  original.creation!.problem = 'Folder unavailable';
  original.creation!.canRelocate = true;
  original.outbox!.checkpoint.buffer = [
    [{ id: 'local-edit', params: { unitId: input.unitId, text: 'Keep my notes' } }],
  ];
  f.values.items.set(input.itemId, original);
  const checkpoint = structuredClone(original.outbox!.checkpoint);
  const relocated = await f.store.updateCreation(
    input.itemId,
    original.creation!,
    { request: { ...original.creation!.request, parentId: null }, createdAt: 1000 },
    () => {},
  );
  expect(relocated.creation).toMatchObject({
    parentId: null,
    access: 'owner',
    createdByName: 'Creator',
  });
  expect(relocated.creation!.ownerName).toBeUndefined();
  const persisted = f.values.items.get(input.itemId) as StoredItem;
  expect(persisted.bundle.access).toBe('owner');
  expect(persisted.creation!.request).toEqual({ ...original.creation!.request, parentId: null });
  expect(persisted.outbox!.checkpoint).toEqual(checkpoint);
  expect(persisted.creation!.problem).toBeUndefined();
  expect(persisted.creation!.canRelocate).toBeUndefined();
});

test.each(['ambiguous', 'viewer', 'identity'] as const)(
  'the storage boundary refuses %s relocation without changing retained work',
  async (reason) => {
    const f = creationStorage();
    const original = sharedCreation();
    f.values.items.set(input.itemId, original);
    if (reason !== 'ambiguous') original.creation!.canRelocate = true;
    const destination = reason === 'viewer' ? sharedParent : null;
    f.values.meta.set('catalog', {
      syncedAt: 1,
      items: [],
      shared: [
        { ...creationFile(original.creation!), id: sharedParent, kind: 'folder', access: 'viewer' },
      ],
      views: {},
    });
    await expect(
      f.store.updateCreation(
        input.itemId,
        original.creation!,
        {
          request: {
            ...original.creation!.request,
            parentId: destination,
            ...(reason === 'identity' ? { unitId: crypto.randomUUID() } : {}),
          },
          createdAt: 1000,
        },
        () => {},
      ),
    ).rejects.toThrow();
    expect(f.values.items.get(input.itemId)).toEqual(original);
  },
);

test('a view-only publication response never acknowledges or clears a creation', async () => {
  const original = sharedCreation();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => accepted({ ...creationFile(original.creation!), access: 'viewer' })),
  );
  await expect(
    uploadOfflineCreation(
      account,
      original.creation!.request,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow('could not be verified');
});
