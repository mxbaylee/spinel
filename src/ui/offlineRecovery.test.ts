import { afterEach, expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, JSONX, LocaleType, TextX } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import type { ClientCheckpoint, NativeSnapshot } from '@spinel/sync-client';
import type { Mutation } from '@spinel/sync-transform';
import type { OfflineBundle, OfflineBundleImage } from '../shared/offlineBundle.ts';
import type { OfflineRecoveryRequest } from '../shared/offlineRecovery.ts';
import { snapshotIdentity } from '../shared/snapshotIdentity.ts';
import { OFFLINE_SDK_VERSION } from '../../web/offline/OfflineAccess.ts';
import { sha256 } from '../../web/offline/PreparedImages.ts';
import {
  offlineCopyName,
  portableOfflineSnapshot,
  reconstructOffline,
  verifyRecoveryRequest,
} from '../../web/offline/recovery.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sheet(): IWorkbookData {
  return {
    id: 'generation',
    name: 'Budget',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['one'],
    styles: {},
    sheets: {
      one: {
        id: 'one',
        name: 'One',
        rowCount: 12,
        columnCount: 6,
        cellData: { 0: { 0: { v: 'base' } } },
      },
    },
  };
}

function doc(): IDocumentData {
  const value = getDocsEmptySnapshot('generation');
  value.body = {
    dataStream: 'Base\r\n',
    paragraphs: [{ startIndex: 4, paragraphId: 'paragraph-1' }],
    sectionBreaks: [{ startIndex: 5, sectionId: 'section-1' }],
  };
  return value;
}

function checkpoint(snapshot: NativeSnapshot = doc()): ClientCheckpoint {
  return {
    version: 1,
    unitId: snapshot.id,
    revision: 3,
    snapshot,
    sent: null,
    inflight: [],
    buffer: [],
  };
}

function bundle(snapshot: NativeSnapshot, images: OfflineBundleImage[] = []): OfflineBundle {
  return {
    version: 1,
    accountId: 'owner',
    itemId: 'item',
    spaceId: 'space',
    unitId: snapshot.id,
    revision: 5,
    revisionOffset: 2,
    name: 'Notes',
    kind: 'sheets' in snapshot ? 'sheet' : 'doc',
    access: 'editor',
    readOnly: false,
    sdkVersion: OFFLINE_SDK_VERSION,
    snapshot: snapshotIdentity(snapshot, 'item'),
    images,
  } as OfflineBundle;
}

function write(value: string, row = 0): Mutation {
  return {
    id: 'sheet.mutation.set-range-values',
    params: {
      unitId: 'generation',
      subUnitId: 'one',
      cellValue: { [row]: { 0: { v: value } } },
      trigger: 'sheet.command.set-range-values',
    },
  };
}

function insert(value: string): Mutation {
  const text = new TextX();
  text.push({ t: 'i' as never, len: value.length, body: { dataStream: value } });
  return {
    id: 'doc.mutation.rich-text-editing',
    params: {
      unitId: 'generation',
      actions: JSONX.getInstance().editOp(text.serialize()),
      textRanges: [],
      trigger: 'doc.command.insert-text',
    },
  };
}

test.each(['sheet', 'doc'] as const)(
  '%s reconstruction applies transformed inflight and ordered buffer exactly once, never the sent envelope',
  (kind) => {
    const saved = checkpoint(kind === 'sheet' ? sheet() : doc());
    saved.sent = {
      type: 'submit',
      mutationId: 'retained-delivery',
      baseRevision: 1,
      mutations: [kind === 'sheet' ? write('OLD SENT') : insert('OLD SENT ')],
    };
    saved.inflight = [kind === 'sheet' ? write('Transformed inflight', 1) : insert('Inflight ')];
    saved.buffer =
      kind === 'sheet'
        ? [[write('First buffer', 2)], [write('Second buffer', 2), write('Last buffer', 3)]]
        : [[insert('First ')], [insert('Second '), insert('Last ')]];
    const before = structuredClone(saved);
    const recovered = reconstructOffline(saved, kind);
    if ('sheets' in recovered) {
      const cells = recovered.sheets.one.cellData!;
      expect(cells[0][0].v).toBe('base');
      expect(cells[1][0].v).toBe('Transformed inflight');
      expect(cells[2][0].v).toBe('Second buffer');
      expect(cells[3][0].v).toBe('Last buffer');
    } else expect(recovered.body!.dataStream).toBe('Last Second First Inflight Base\r\n');
    expect(saved).toEqual(before);
    expect(JSON.stringify(recovered)).not.toContain('OLD SENT');
  },
);

test('a complete retained recovery snapshot is used once and its earlier queued insertion is not reapplied', () => {
  const saved = checkpoint();
  saved.buffer = [[insert('Already included ')]];
  saved.failure = 'capacity';
  saved.recoverySnapshot = {
    ...doc(),
    body: { dataStream: 'Already included and latest refused edit\r\n' },
  };
  const first = reconstructOffline(saved, 'doc') as IDocumentData;
  expect(first).toEqual(saved.recoverySnapshot);
  first.body!.dataStream = 'Caller mutation\r\n';
  expect(reconstructOffline(saved, 'doc')).toEqual(saved.recoverySnapshot);
  expect(saved.recoverySnapshot.body!.dataStream).toBe(
    'Already included and latest refused edit\r\n',
  );
});

test.each([
  [
    'missing latest state',
    (value: ClientCheckpoint) => {
      value.failure = 'capacity';
      value.recoveryMissing = true;
    },
  ],
  [
    'foreign confirmed unit',
    (value: ClientCheckpoint) => {
      value.snapshot.id = 'another';
    },
  ],
  [
    'foreign pending unit',
    (value: ClientCheckpoint) => {
      value.buffer[0][0].params.unitId = 'another';
    },
  ],
  [
    'unknown mutation',
    (value: ClientCheckpoint) => {
      value.buffer[0][0].id = 'unknown.mutation';
    },
  ],
  [
    'empty buffer group',
    (value: ClientCheckpoint) => {
      value.buffer = [[]];
    },
  ],
  [
    'inflight without delivery identity',
    (value: ClientCheckpoint) => {
      value.inflight = value.buffer[0];
    },
  ],
  [
    'foreign retained snapshot',
    (value: ClientCheckpoint) => {
      value.failure = 'capacity';
      value.recoverySnapshot = { ...doc(), id: 'another' };
    },
  ],
] as const)('reconstruction refuses %s without sending any work', (_label, damage) => {
  const saved = checkpoint();
  saved.buffer = [[insert('Pending ')]];
  damage(saved);
  const fetcher = vi.fn().mockRejectedValue(new Error('No network allowed'));
  vi.stubGlobal('fetch', fetcher);
  expect(() => reconstructOffline(saved, 'doc')).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

async function images(count: number) {
  const manifest: OfflineBundleImage[] = [];
  const bytes = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index++) {
    const data = new Uint8Array([index + 1, 2, 3, 4]);
    const hash = await sha256(data);
    const source = `/api/items/item/images/${hash}`;
    manifest.push({ source, sha256: hash, mime: 'image/png', byteLength: data.length });
    bytes.set(source, data);
  }
  const drawing = (index: number) => ({
    source: manifest[index].source,
    imageSourceType: 'URL',
    drawingType: 0,
    unitId: 'generation',
    subUnitId: 'generation',
    drawingId: `image-${index}`,
    transform: { left: 0, top: 0, width: 20, height: 20 },
  });
  const dataUrl = (index: number) =>
    `data:image/png;base64,${Buffer.from(bytes.get(manifest[index].source)!).toString('base64')}`;
  return { manifest, bytes, drawing, dataUrl };
}

test('Doc body, header, footer and note drawings export their distinct verified bytes without touching text or opaque resources', async () => {
  const f = await images(7);
  const saved = checkpoint();
  const visible = {
    ...doc(),
    body: { dataStream: `${f.manifest[0].source}\r\n` },
    drawings: { body: f.drawing(0) },
    headers: { header: { drawings: { picture: f.drawing(1) } } },
    footers: { footer: { drawings: { picture: f.drawing(2) } } },
    footnotes: { footnote: { drawings: { picture: f.drawing(3) } } },
    endnotes: { endnote: { drawings: { picture: f.drawing(4) } } },
    notes: { note: { drawings: { picture: f.drawing(5) } } },
    resources: [
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({ data: { resource: f.drawing(6) }, order: ['resource'] }),
      },
      { name: 'UNKNOWN_PLUGIN', data: ` { "source" : "${f.manifest[0].source}" }\n` },
    ],
  };
  saved.failure = 'capacity';
  saved.recoverySnapshot = visible as unknown as IDocumentData;
  const before = structuredClone(saved);
  const fetcher = vi.fn().mockRejectedValue(new Error('No network allowed'));
  vi.stubGlobal('fetch', fetcher);
  const exported = (await portableOfflineSnapshot(
    bundle(saved.snapshot, f.manifest),
    saved,
    f.bytes,
    () => {},
  )) as unknown as typeof visible;
  expect(exported.id).toBe('item');
  expect(exported.drawings.body).toMatchObject({
    source: f.dataUrl(0),
    imageSourceType: 'BASE64',
    unitId: 'item',
    subUnitId: 'item',
  });
  expect(exported.headers.header.drawings.picture.source).toBe(f.dataUrl(1));
  expect(exported.footers.footer.drawings.picture.source).toBe(f.dataUrl(2));
  expect(exported.footnotes.footnote.drawings.picture.source).toBe(f.dataUrl(3));
  expect(exported.endnotes.endnote.drawings.picture.source).toBe(f.dataUrl(4));
  expect(exported.notes.note.drawings.picture.source).toBe(f.dataUrl(5));
  expect(JSON.parse(exported.resources[0].data).data.resource.source).toBe(f.dataUrl(6));
  expect(exported.body.dataStream).toBe(visible.body.dataStream);
  expect(exported.resources[1]).toEqual(visible.resources[1]);
  expect(saved).toEqual(before);
  expect(fetcher).not.toHaveBeenCalled();
});

test('Sheet floating, background and rich-cell images become portable while native Formula definitions keep their identity', async () => {
  const f = await images(3);
  const saved = checkpoint(sheet());
  const visible = {
    ...sheet(),
    sheets: {
      one: {
        ...sheet().sheets.one,
        backgroundImage: f.drawing(0),
        cellData: {
          0: {
            0: { v: f.manifest[0].source, custom: { source: f.manifest[0].source } },
            1: {
              p: { ...doc(), body: { dataStream: '\r\n' }, drawings: { picture: f.drawing(1) } },
            },
            2: { f: '=[generation]one!A1' },
          },
        },
      },
    },
    resources: [
      {
        name: 'SHEET_DRAWING_PLUGIN',
        data: JSON.stringify({
          one: { data: { picture: { ...f.drawing(2), subUnitId: 'one' } }, order: ['picture'] },
        }),
      },
    ],
  };
  saved.failure = 'capacity';
  saved.recoverySnapshot = visible as unknown as IWorkbookData;
  const fetcher = vi.fn().mockRejectedValue(new Error('No network allowed'));
  vi.stubGlobal('fetch', fetcher);
  const exported = (await portableOfflineSnapshot(
    bundle(saved.snapshot, f.manifest),
    saved,
    f.bytes,
    () => {},
  )) as unknown as typeof visible;
  expect(exported.sheets.one.backgroundImage.source).toBe(f.dataUrl(0));
  expect(exported.sheets.one.cellData[0][1].p.drawings.picture.source).toBe(f.dataUrl(1));
  expect(JSON.parse(exported.resources[0].data).one.data.picture).toMatchObject({
    source: f.dataUrl(2),
    unitId: 'item',
    subUnitId: 'one',
  });
  expect(exported.sheets.one.cellData[0][0]).toEqual(visible.sheets.one.cellData[0][0]);
  expect(exported.sheets.one.cellData[0][2].f).toBe('=[item]one!A1');
  expect(fetcher).not.toHaveBeenCalled();
});

test.each(['missing', 'damaged', 'foreign manifest', 'unlisted drawing'] as const)(
  '%s images reject the complete export and never fetch a replacement',
  async (mode) => {
    const f = await images(1);
    const saved = checkpoint();
    saved.failure = 'capacity';
    saved.recoverySnapshot = {
      ...doc(),
      drawings: { picture: f.drawing(0) },
    } as unknown as IDocumentData;
    if (mode === 'missing') f.bytes.clear();
    if (mode === 'damaged') f.bytes.get(f.manifest[0].source)![0] = 99;
    if (mode === 'foreign manifest')
      f.manifest[0].source = f.manifest[0].source.replace('/item/', '/other/');
    if (mode === 'unlisted drawing')
      (saved.recoverySnapshot.drawings!.picture as unknown as { source: string }).source =
        'https://foreign.example/private.png';
    const fetcher = vi.fn().mockRejectedValue(new Error('No network allowed'));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      portableOfflineSnapshot(bundle(saved.snapshot, f.manifest), saved, f.bytes, () => {}),
    ).rejects.toThrow(/image/i);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

test.each(['hash', 'blob'] as const)(
  'account cancellation during image %s aborts export before bytes can escape',
  async (stage) => {
    const f = await images(1);
    const saved = checkpoint();
    saved.failure = 'capacity';
    saved.recoverySnapshot = {
      ...doc(),
      drawings: { picture: f.drawing(0) },
    } as unknown as IDocumentData;
    let current = true;
    if (stage === 'hash') {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
        const value = await original(...args);
        current = false;
        return value;
      });
    } else {
      const original = Blob.prototype.arrayBuffer;
      vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementationOnce(async function (this: Blob) {
        const value = await original.call(this);
        current = false;
        return value;
      });
    }
    await expect(
      portableOfflineSnapshot(bundle(saved.snapshot, f.manifest), saved, f.bytes, () => {
        if (!current) throw new Error('Account changed');
      }),
    ).rejects.toThrow('Account changed');
  },
);

test('portable recovery preserves authored Doc Formula bindings and refuses evaluated private results', async () => {
  const expression = '=Budget.One.A1';
  const reference = parseFormula(expression)[0];
  const definition = {
    version: 1 as const,
    expression,
    references: [
      {
        start: reference.start,
        end: reference.end,
        itemId: 'source-sheet',
        sheetId: 'one',
        range: reference.range,
      },
    ],
  };
  const body = formulaBody('formula', definition);
  body.dataStream += '\r\n';
  const saved = checkpoint();
  saved.failure = 'capacity';
  saved.recoverySnapshot = { ...doc(), body };
  const exported = (await portableOfflineSnapshot(
    bundle(saved.snapshot),
    saved,
    new Map(),
    () => {},
  )) as IDocumentData;
  expect(docFormulas(exported.body)[0].definition).toEqual(definition);
  expect(exported.body!.dataStream).toBe(`${expression}\r\n`);
  const properties = saved.recoverySnapshot.body!.customRanges![0].properties!;
  properties.spinelFormula = { ...definition, result: 'PRIVATE CACHED RESULT' };
  await expect(
    portableOfflineSnapshot(bundle(saved.snapshot), saved, new Map(), () => {}),
  ).rejects.toThrow();
});

test('copy names use a stable local clock and fit the native filename budget without splitting characters', () => {
  const at = new Date(2026, 9, 26, 21, 7);
  expect(offlineCopyName('Notes', at)).toBe('Notes (offline copy, 2026-10-26 21:07)');
  for (const title of ['a'.repeat(120), '🪷'.repeat(60)]) {
    const name = offlineCopyName(title, at);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith(' (offline copy, 2026-10-26 21:07)')).toBe(true);
    expect(name.isWellFormed()).toBe(true);
    expect(name).not.toMatch(/[\p{Cc}/\\]/u);
  }
});

function storedRequest() {
  const saved = checkpoint();
  const downloaded = bundle(saved.snapshot);
  const rebuilt = snapshotIdentity(doc(), downloaded.itemId);
  const name = offlineCopyName(downloaded.name, new Date(2026, 9, 26, 21, 7));
  const recovery: OfflineRecoveryRequest = {
    recoveryId: '11111111-1111-4111-8111-111111111111',
    filename: `${name}.univer.json`,
    possibleReplayCrash: false,
    snapshot: { ...structuredClone(rebuilt), title: name },
  };
  return { saved, downloaded, rebuilt, recovery };
}

test('a saved request keeps its original timestamp across reload and object-key reordering without modifying rebuilt work', () => {
  const f = storedRequest();
  const before = structuredClone(f.rebuilt);
  // Reload may happen long after the original preparation. Validation checks
  // the saved title against its original content, never a newly generated date.
  const reordered = Object.fromEntries(
    Object.entries(f.recovery.snapshot).reverse(),
  ) as NativeSnapshot;
  expect(() =>
    verifyRecoveryRequest(f.downloaded, f.saved, { ...f.recovery, snapshot: reordered }, f.rebuilt),
  ).not.toThrow();
  expect(f.rebuilt).toEqual(before);
  expect(f.recovery.filename).toContain('2026-10-26 21:07');
});

test.each([
  [
    'content',
    (value: OfflineRecoveryRequest) => {
      (value.snapshot as IDocumentData).body!.dataStream = 'Different offline work\r\n';
    },
  ],
  [
    'native identity',
    (value: OfflineRecoveryRequest) => {
      value.snapshot.id = 'foreign';
    },
  ],
  [
    'filename',
    (value: OfflineRecoveryRequest) => {
      value.filename = 'different.univer.json';
    },
  ],
  [
    'title prefix',
    (value: OfflineRecoveryRequest) => {
      (value.snapshot as IDocumentData).title = 'Other (offline copy, 2026-10-26 21:07)';
      value.filename = `${(value.snapshot as IDocumentData).title}.univer.json`;
    },
  ],
  [
    'possible replay crash',
    (value: OfflineRecoveryRequest) => {
      value.possibleReplayCrash = true;
    },
  ],
  [
    'request identity',
    (value: OfflineRecoveryRequest) => {
      value.recoveryId = 'invalid';
    },
  ],
  [
    'extra metadata',
    (value: OfflineRecoveryRequest) => {
      Object.assign(value, { parentId: 'other-folder' });
    },
  ],
] as const)(
  'a tampered saved recovery %s cannot replace reconstructed offline work',
  (_label, damage) => {
    const f = storedRequest();
    damage(f.recovery);
    const before = structuredClone(f.rebuilt);
    expect(() => verifyRecoveryRequest(f.downloaded, f.saved, f.recovery, f.rebuilt)).toThrow(
      'does not match',
    );
    expect(f.rebuilt).toEqual(before);
  },
);
