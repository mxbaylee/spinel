import { expect, test, vi } from 'vitest';
import { DrawingTypeEnum, ICommandService, LocaleType } from '@univerjs/core';
import { ISheetDrawingService } from '@univerjs/sheets-drawing';
import type { IDrawingJsonUndo1 } from '@univerjs/drawing';
import { captureNative, NativeReplica } from '@spinel/sync-client';
import type { Mutation } from '@spinel/sync-transform';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import { OfflineSession } from '../../web/offline/OfflineSession.ts';
import { checkImageList, PreparedImages, sha256 } from '../../web/offline/PreparedImages.ts';
import { mapNativeImageSources } from '../shared/nativeImageSources.ts';
import type { OfflineBundleImage } from '../shared/offlineBundle.ts';

async function fixture() {
  const scope = {
    origin: 'https://spinel.example',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind: 'doc' as const,
    access: 'owner' as const,
    sdkVersion: '1.1.0' as const,
    schema: 1 as const,
    revisionOffset: 0,
  };
  const access = new OfflineAccess(scope);
  let account: string | null = 'owner';
  const data = new Uint8Array([1, 2, 3]);
  const hash = await sha256(data);
  const source = `/api/items/item/images/${hash}`;
  const images: OfflineBundleImage[] = [{ source, sha256: hash, mime: 'image/png', byteLength: 3 }];
  const bytes = new Map([[source, data]]);
  return {
    access,
    images,
    bytes,
    source,
    data,
    setAccount: (value: string | null) => {
      account = value;
    },
    prepare: () => PreparedImages.prepare(access, images, bytes, () => account),
  };
}

test('verified local image bytes render and export without fetching', async () => {
  const f = await fixture();
  const before = structuredClone(f.images);
  const service = await f.prepare();
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
  try {
    f.data[0] = 99;
    const url = await service.getImage(f.source);
    expect(url.startsWith('blob:')).toBe(true);
    expect(await service.getImage(f.access.scope.origin + f.source)).toBe(url);
    expect(await service.getImage(url)).toBe(url);
    const blob = await service.downloadImage(f.source);
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(f.images).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    service.dispose();
    fetch.mockRestore();
  }
});

test('an image admission cancelled during hashing never publishes the new local blob', async () => {
  const f = await fixture();
  const service = await PreparedImages.prepare(f.access, [], new Map(), () => 'owner');
  let admitted = true;
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const hashing = vi
    .spyOn(crypto.subtle, 'digest')
    .mockImplementationOnce(async (algorithm, input) => {
      const result = await digest(algorithm, input);
      admitted = false;
      return result;
    });
  try {
    await expect(
      service.add(f.images, f.bytes, () => {
        if (!admitted) throw new Error('Remote access ended');
      }),
    ).rejects.toThrow('Remote access ended');
    expect(await service.getImage(f.source)).toBe('data:image/png;base64,');
  } finally {
    hashing.mockRestore();
    service.dispose();
  }
});

test('localize rewrites only verified sources and leaves the stored snapshot unchanged', async () => {
  const f = await fixture();
  const service = await f.prepare();
  try {
    const snapshot = {
      drawings: {
        a: { source: f.source, custom: { source: f.source } },
        b: { source: f.access.scope.origin + f.source },
        c: { source: 'https://elsewhere.example/tracker.png' },
        d: { source: '/api/items/other/images/abc' },
        e: { source: 'data:image/png;base64,AAAA' },
      },
      text: 'Not an image',
      other: '/api/items/other/images/abc',
      list: [f.source, 3, null],
      resources: [
        {
          name: 'SHEET_DRAWING_PLUGIN',
          data: JSON.stringify({ s: { data: { d: { source: f.source } } } }),
        },
        { name: 'plain', data: 'not json' },
      ],
    };
    const before = structuredClone(snapshot);
    const local = service.localize(snapshot);
    const url = await service.getImage(f.source);
    expect(local).toEqual({
      drawings: {
        a: { source: url, custom: { source: f.source } },
        b: { source: url },
        c: { source: 'data:image/png;base64,' },
        d: { source: 'data:image/png;base64,' },
        e: { source: 'data:image/png;base64,AAAA' },
      },
      text: 'Not an image',
      other: '/api/items/other/images/abc',
      list: [f.source, 3, null],
      resources: [
        {
          name: 'SHEET_DRAWING_PLUGIN',
          data: JSON.stringify({ s: { data: { d: { source: url } } } }),
        },
        { name: 'plain', data: 'not json' },
      ],
    });
    expect(snapshot).toEqual(before);
  } finally {
    service.dispose();
  }
});

test('image round trips preserve authored strings, custom source metadata and opaque resource spelling', async () => {
  const f = await fixture();
  const service = await f.prepare();
  try {
    const url = await service.getImage(f.source);
    const opaque = {
      name: 'UNKNOWN_PLUGIN',
      data: ` { "source" : "${f.source}", "local" : "${url}" }\n`,
    };
    const unchanged = { name: 'DOC_DRAWING_PLUGIN', data: ' { "data" : {}, "order" : [] }\n' };
    const original = {
      id: 'book',
      sheets: {
        one: {
          backgroundImage: { source: f.source, custom: { source: url } },
          cellData: {
            0: {
              0: { v: f.source, custom: { source: f.source } },
              1: { v: url },
              2: {
                p: { body: { dataStream: f.source }, drawings: { image: { source: f.source } } },
              },
            },
          },
        },
      },
      resources: [opaque, unchanged],
    };
    const local = service.localize(original);
    expect(local.sheets.one.backgroundImage.source).toBe(url);
    expect(local.sheets.one.backgroundImage.custom.source).toBe(url);
    expect(local.sheets.one.cellData[0][0]).toEqual(original.sheets.one.cellData[0][0]);
    expect(local.sheets.one.cellData[0][1].v).toBe(url);
    expect(local.sheets.one.cellData[0][2].p.body.dataStream).toBe(f.source);
    expect(local.sheets.one.cellData[0][2].p.drawings.image.source).toBe(url);
    expect(local.resources).toEqual(original.resources);
    expect(service.localize(local)).toEqual(local);
    expect(service.canonicalize(local)).toEqual(original);
    expect(service.canonicalize(original)).toEqual(original);
  } finally {
    service.dispose();
  }
});

test.each(['sheet', 'doc'] as const)(
  '%s JSON1 image payloads map by native path while metadata stays opaque',
  async (kind) => {
    const f = await fixture();
    const service = await f.prepare();
    try {
      const url = await service.getImage(f.source);
      const path = kind === 'sheet' ? ['book', 'one', 'data', 'image'] : ['drawings', 'image'];
      const op = [
        ...path,
        ['source', { i: f.source, r: f.source }],
        ['custom', 'source', { i: f.source, r: url }],
        ['transform', { i: { left: 10, top: 20, width: 30, height: 40 } }],
      ];
      const payload = kind === 'sheet' ? { op } : { actions: op };
      const mutation = {
        id:
          kind === 'sheet' ? 'sheet.mutation.set-drawing-apply' : 'doc.mutation.rich-text-editing',
        params: { unitId: 'book', ...payload },
      };
      const local = service.localize(mutation);
      const mapped = ('op' in local.params ? local.params.op : local.params.actions) as unknown[];
      expect(mapped[path.length]).toEqual(['source', { i: url, r: url }]);
      expect(mapped[path.length + 1]).toEqual(['custom', 'source', { i: f.source, r: url }]);
      expect(service.canonicalize(local)).toEqual(mutation);
      const discovered: string[] = [];
      mapNativeImageSources({ type: 'resume', edits: [{ mutations: [mutation] }] }, (source) => {
        discovered.push(source);
        return source;
      });
      expect(discovered).toEqual([f.source, f.source]);
    } finally {
      service.dispose();
    }
  },
);

test('actual native image insertion and move/resize preserve canonical sources through capture', async () => {
  const f = await fixture();
  const service = await f.prepare();
  const visible = new NativeReplica(
    {
      id: 'book',
      name: 'Images',
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      sheetOrder: ['one'],
      styles: {},
      sheets: { one: { id: 'one', name: 'One', rowCount: 20, columnCount: 10, cellData: {} } },
    },
    'sheet',
  );
  const captured: Mutation[] = [];
  const capture = captureNative({
    univer: visible.univer,
    unitId: 'book',
    onMutation: (mutation) => captured.push(service.canonicalize(mutation)),
    onFailure: (reason) => {
      throw new Error(reason);
    },
  });
  try {
    const local = service.localize({
      drawings: {
        image: {
          unitId: 'book',
          subUnitId: 'one',
          drawingId: 'image',
          drawingType: DrawingTypeEnum.DRAWING_IMAGE,
          imageSourceType: 'URL' as const,
          source: f.source,
          transform: { left: 0, top: 0, width: 20, height: 20 },
          custom: { source: f.source },
        },
      },
    }).drawings.image;
    const drawings = visible.univer.__getInjector().get(ISheetDrawingService);
    const commands = visible.univer.__getInjector().get(ICommandService);
    const apply = (image: typeof local, update: boolean) => {
      const result = (
        update
          ? drawings.getBatchUpdateOp([image as never])
          : drawings.getBatchAddOp([image as never])
      ) as IDrawingJsonUndo1;
      expect(
        commands.syncExecuteCommand('sheet.mutation.set-drawing-apply', {
          unitId: 'book',
          subUnitId: 'one',
          op: result.redo,
          objects: result.objects,
          type: update ? 1 : 0,
        }),
      ).toBe(true);
    };
    apply(local, false);
    const moved = { ...local, transform: { left: 30, top: 40, width: 50, height: 60 } };
    apply(moved, true);
    expect(captured).toHaveLength(2);
    expect(JSON.stringify(captured)).not.toContain('blob:');
    const saved = service.canonicalize(visible.snapshot());
    const resource = saved.resources!.find((entry) => entry.name === 'SHEET_DRAWING_PLUGIN')!;
    expect(JSON.parse(resource.data).one.data.image).toMatchObject({
      source: f.source,
      transform: moved.transform,
      custom: { source: f.source },
    });
    const replay = new NativeReplica(
      {
        ...saved,
        resources: saved.resources!.map((entry) =>
          entry.name === 'SHEET_DRAWING_PLUGIN' ? { ...entry, data: '{}' } : entry,
        ),
      },
      'sheet',
    );
    try {
      replay.apply(captured);
      const restored = replay
        .snapshot()
        .resources!.find((entry) => entry.name === 'SHEET_DRAWING_PLUGIN')!;
      expect(JSON.parse(restored.data)).toEqual(JSON.parse(resource.data));
    } finally {
      replay.dispose();
    }
  } finally {
    capture.dispose();
    visible.dispose();
    service.dispose();
  }
});

test('offline checkpoint image preparation ignores URL-looking cell text and unknown resources', async () => {
  const f = await fixture();
  const fetch = vi.fn().mockRejectedValue(new Error('Offline'));
  const session = {
    itemId: 'item',
    access: f.access,
    verify() {},
    fetch,
    download: { bytes: new Map(), bundle: { images: [] } },
    images: {},
  } as unknown as OfflineSession;
  const snapshot = {
    id: 'book',
    sheets: { one: { cellData: { 0: { 0: { v: f.source, custom: { source: f.source } } } } } },
    resources: [{ name: 'UNKNOWN_PLUGIN', data: ` { "source" : "${f.source}" }\n` }],
  };
  const checkpoint = {
    version: 1,
    snapshot,
    recoverySnapshot: snapshot,
    sent: null,
    inflight: [],
    buffer: [
      [
        {
          id: 'sheet.mutation.set-range-values',
          params: { cellValue: { 0: { 0: { v: f.source } } } },
        },
      ],
    ],
  };
  const before = structuredClone(checkpoint);
  await OfflineSession.prototype.prepareImages.call(session, checkpoint);
  expect(fetch).not.toHaveBeenCalled();
  expect(checkpoint).toEqual(before);
});

test('connection cancellation aborts image preparation without publishing bytes', async () => {
  const f = await fixture();
  const controller = new AbortController();
  const download = { bytes: new Map(), bundle: { images: [] } };
  const add = vi.fn();
  const fetch = vi.fn(
    (_path: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      }),
  );
  const session = {
    itemId: 'item',
    access: f.access,
    verify() {},
    fetch,
    download,
    images: { add },
  } as unknown as OfflineSession;
  const preparing = OfflineSession.prototype.prepareImages.call(
    session,
    f.source,
    controller.signal,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  controller.abort(new DOMException('Connection ended', 'AbortError'));
  await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
  expect(download.bytes.size).toBe(0);
  expect(add).not.toHaveBeenCalled();
});

test.each([
  'missing',
  'wrong size',
  'wrong hash',
  'foreign path',
  'duplicate',
  'sparse',
  'mime',
  'account',
  'oversize',
  'budget',
])('%s image preparation fails before exposing any object URL', async (mode) => {
  const f = await fixture();
  if (mode === 'missing') f.bytes.clear();
  if (mode === 'wrong size') f.images[0].byteLength = 2;
  if (mode === 'wrong hash') f.data[0] = 5;
  if (mode === 'foreign path') f.images[0].source = '/api/items/other/images/hash';
  if (mode === 'duplicate') f.images.push({ ...f.images[0] });
  if (mode === 'sparse') f.images.length = 2;
  if (mode === 'mime') f.images[0].mime = 'image/svg+xml';
  if (mode === 'account') f.setAccount('other');
  if (mode === 'oversize') f.images[0].byteLength = 5 * 1024 * 1024 + 1;
  if (mode === 'budget')
    // Eleven 5 MB images exceed the 50 MB document budget before any bytes are hashed.
    for (let index = 0; index < 11; index++)
      f.images[index] = {
        source: `/api/items/item/images/${index.toString(16).padStart(64, '0')}`,
        sha256: index.toString(16).padStart(64, '0'),
        mime: 'image/png',
        byteLength: 5 * 1024 * 1024,
      };
  const urls = vi.spyOn(URL, 'createObjectURL');
  try {
    await expect(f.prepare()).rejects.toThrow(
      mode === 'budget' ? /budget/ : mode === 'account' ? /account/ : /image/,
    );
    expect(urls).not.toHaveBeenCalled();
  } finally {
    urls.mockRestore();
  }
});

test.each(['unknown', 'foreign origin', 'query', 'hash', 'data url'])(
  '%s reads never fall through to a browser network request',
  async (mode) => {
    const f = await fixture(),
      service = await f.prepare();
    const url =
      mode === 'unknown'
        ? '/missing'
        : mode === 'foreign origin'
          ? 'https://other.example' + f.source
          : mode === 'query'
            ? f.source + '?extra=1'
            : mode === 'hash'
              ? f.source + '#extra'
              : 'data:image/png;base64,AQID';
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
    try {
      expect(await service.getImage(url)).toBe('data:image/png;base64,');
      expect(f.access.state.phase).toBe('attention');
      await expect(service.downloadImage(url)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(() => service.registerURLImageDownloader()).toThrow(/fallback/);
    } finally {
      service.dispose();
      fetch.mockRestore();
    }
  },
);

test.each(['account', 'lock', 'dispose'])(
  '%s revokes issued object URLs and denies later local reads',
  async (mode) => {
    const f = await fixture(),
      service = await f.prepare();
    const url = await service.getImage(f.source);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    try {
      if (mode === 'account') f.setAccount('other');
      if (mode === 'lock') f.access.lock('Signed out');
      if (mode === 'dispose') service.dispose();
      expect(await service.getImage(f.source)).toBe('data:image/png;base64,');
      expect(await service.getImage(url)).toBe('data:image/png;base64,');
      expect(revoke).toHaveBeenCalledWith(url);
      await expect(service.downloadImage(f.source)).rejects.toThrow();
    } finally {
      service.dispose();
      revoke.mockRestore();
    }
  },
);

test('locking while integrity verification is pending cannot publish an image service', async () => {
  const f = await fixture();
  const pending = f.prepare();
  f.access.lock('Signed out during preparation');
  await expect(pending).rejects.toThrow(/account|access/);
});

test.each([
  ['another origin', 'https://elsewhere.example/api/items/item/images/'],
  ['another item', '/api/items/other/images/'],
  ['another route', '/api/items/item/export?sha='],
])('an image list pointing at %s is refused before anything is fetched', async (_, prefix) => {
  const f = await fixture();
  const image = { ...f.images[0], source: prefix + f.images[0].sha256 };
  expect(() => checkImageList('item', [image])).toThrow(/malformed/);
  expect(() => checkImageList('item', f.images)).not.toThrow();
});
