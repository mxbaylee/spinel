import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import {
  DrawingTypeEnum,
  getDocsEmptySnapshot,
  ImageSourceType,
  JSONX,
  LocaleType,
  PositionedObjectLayoutType,
  TextX,
  TextXActionType,
} from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { IDocImage } from '@univerjs/docs-drawing';
import type { ClientCheckpoint } from '@spinel/sync-client';
import type { StoredItem } from '../../web/offline/offlineStore.ts';
import { textPoints } from '../../e2e/doc-touch-raster.ts';
import {
  phoneAcceptanceLimits,
  phoneLocalCopyScript,
  phoneNativeSnapshotScript,
  observePhoneAcceptance,
  boundedPhoneFixtureOperation,
  readPhoneOpenedCopy,
  verifyAuthoredContent,
  verifyEditablePhone,
  verifyRetainedEdit,
  type PhoneAcceptanceDriver,
} from './browserstack-acceptance.ts';

test('recovery content is read only after the phone opens its already-created generation', async () => {
  for (const mode of ['mapped', 'same-id', 'missing'] as const) {
    const calls: string[] = [];
    const driver = {
      async navigate(href: string) {
        assert.equal(href, '/?item=copy');
        calls.push('phone-navigate');
      },
      async ready(offline: boolean) {
        assert.equal(offline, false);
        calls.push('phone-ready');
        return {};
      },
      remaining: (maximum: number) => maximum,
    } as unknown as PhoneAcceptanceDriver;
    const fixture = {
      db: {
        prepare(sql: string) {
          assert.deepEqual(calls.slice(0, 2), ['phone-navigate', 'phone-ready']);
          assert.ok(
            sql.startsWith('SELECT '),
            'Server observation may not prepare or write a generation.',
          );
          return {
            get(id: string) {
              if (sql.includes('spinel_live_units')) {
                assert.equal(id, 'copy');
                calls.push('read-mapping');
                return mode === 'mapped' ? { unit_id: 'copy-unit' } : undefined;
              }
              assert.ok(sql.includes('spinel_sync_units'));
              calls.push('read-existing-unit');
              return mode === 'missing' ? undefined : { unit_id: id };
            },
          };
        },
      },
      async read(itemId: string, unitId: string) {
        assert.equal(itemId, 'copy');
        assert.equal(unitId, mode === 'mapped' ? 'copy-unit' : 'copy');
        calls.push('GET-snapshot');
        return { unitId, revision: 0, snapshot: getDocsEmptySnapshot(unitId) };
      },
      async readRecovered() {
        throw new Error('Out-of-band preparation must never run.');
      },
    } as unknown as Parameters<typeof readPhoneOpenedCopy>[1];
    const operation = readPhoneOpenedCopy(driver, fixture, 'copy', '/?item=copy');
    if (mode === 'missing') {
      await assert.rejects(operation, /phone-copy-generation-unavailable/);
      assert.ok(!calls.includes('GET-snapshot'));
    } else {
      await operation;
      assert.deepEqual(calls, [
        'phone-navigate',
        'phone-ready',
        'read-mapping',
        'read-existing-unit',
        'GET-snapshot',
      ]);
    }
  }
});

test('late observation and fixture successes cannot pass a deadline before its timer callback runs', async (context) => {
  let now = 100;
  context.mock.method(Date, 'now', () => now);
  const driver = { remaining: (maximum: number) => maximum } as PhoneAcceptanceDriver;
  let observations = 0;
  await assert.rejects(
    observePhoneAcceptance(
      driver,
      async () => {
        observations++;
        now = 111;
        return true;
      },
      Boolean,
      'late-observation',
      10,
    ),
    /capability-acceptance-late-observation/,
  );
  assert.equal(
    observations,
    1,
    'Read observations are bounded; no successful late result is replayed.',
  );
  let operations = 0;
  now = 200;
  await assert.rejects(
    boundedPhoneFixtureOperation(driver, async () => {
      operations++;
      now = 120_201;
      return 'late success';
    }),
    /capability-acceptance-fixture-deadline/,
  );
  assert.equal(
    operations,
    1,
    'A fixture mutation is started once, even when its result arrives too late.',
  );
});

test('phone authoring refuses a reader path and requires the observed mobile editor', () => {
  verifyEditablePhone({ kind: 'doc', mobile: true, readOnly: false, edit: true }, 'doc');
  verifyEditablePhone({ kind: 'sheet', mobile: true, readOnly: false }, 'sheet');
  for (const state of [
    { kind: 'doc', mobile: true, readOnly: true, edit: true },
    { kind: 'doc', mobile: true, readOnly: false, edit: false },
    { kind: 'doc', mobile: false, readOnly: false, edit: true },
    { kind: 'sheet', mobile: true, readOnly: true },
    { kind: 'sheet', mobile: true },
  ])
    assert.throws(
      () => verifyEditablePhone(state, state.kind as 'doc' | 'sheet'),
      /capability-acceptance-/,
    );
  const { operational, ...stages } = phoneAcceptanceLimits;
  assert.ok(Object.values(stages).reduce((sum, value) => sum + value, 0) <= operational);
  assert.ok(
    operational + 15_000 < 900_000,
    'The separate Safari bound and cleanup fit the existing reservation.',
  );
});

function imageDoc() {
  const doc = getDocsEmptySnapshot('unit');
  doc.title = 'Prepared native Doc';
  doc.body = {
    dataStream: '\bBase notes\r\n',
    paragraphs: [{ startIndex: 11, paragraphId: 'para_preserved' }],
    customBlocks: [{ startIndex: 0, blockId: 'image' }],
    textRuns: [{ st: 1, ed: 5, ts: { bl: 1 } }],
  };
  const drawing: IDocImage = {
    unitId: 'unit',
    subUnitId: 'unit',
    drawingId: 'image',
    drawingType: DrawingTypeEnum.DRAWING_IMAGE,
    imageSourceType: ImageSourceType.URL,
    source: '/api/items/item/images/hash',
    layoutType: PositionedObjectLayoutType.INLINE,
    docTransform: {
      size: { width: 120, height: 80 },
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 0, posOffset: 0 },
      angle: 0,
    },
  };
  doc.drawings = { image: drawing };
  doc.drawingsOrder = ['image'];
  doc.notes = {
    keep: { noteId: 'note', type: 'footnote', body: { dataStream: 'Preserve this note\r\n' } },
  };
  doc.tableSource = { keep: { custom: 'unchanged' } } as unknown as IDocumentData['tableSource'];
  return doc;
}

function insert(doc: IDocumentData, text: string, caret: number) {
  const expected = structuredClone(doc);
  expected.body = TextX.apply(expected.body!, [
    ...(caret ? [{ t: TextXActionType.RETAIN as const, len: caret }] : []),
    { t: TextXActionType.INSERT, len: text.length, body: { dataStream: text } },
  ]);
  return expected;
}

test('native Doc acceptance compares the entire independently transformed document, including body image anchors', () => {
  const baseline = imageDoc();
  const text = 'Phone731 ';
  const expected = insert(baseline, text, 1);
  verifyAuthoredContent(expected, baseline, 'doc', text, 1);
  for (const corrupt of [
    (doc: IDocumentData) => {
      doc.body!.customBlocks = [];
    },
    (doc: IDocumentData) => {
      doc.body!.customBlocks![0].startIndex++;
    },
    (doc: IDocumentData) => {
      doc.body!.paragraphs![0].startIndex++;
    },
    (doc: IDocumentData) => {
      doc.body!.textRuns = [];
    },
    (doc: IDocumentData) => {
      doc.notes = {};
    },
    (doc: IDocumentData) => {
      doc.tableSource = {};
    },
    (doc: IDocumentData) => {
      doc.drawingsOrder = [];
    },
    (doc: IDocumentData) => {
      doc.documentStyle.marginTop = (doc.documentStyle.marginTop ?? 0) + 1;
    },
  ]) {
    const changed = structuredClone(expected);
    corrupt(changed);
    assert.throws(
      () => verifyAuthoredContent(changed, baseline, 'doc', text, 1),
      /authored-doc-changed-other-content/,
    );
  }
  const duplicate = insert(expected, text, 1);
  assert.throws(
    () => verifyAuthoredContent(duplicate, baseline, 'doc', text, 1),
    /authored-doc-value-mismatch/,
  );
  assert.equal(baseline.body!.dataStream, '\bBase notes\r\n');
});

test('native Sheet acceptance requires the intended A1 value and preserves every other cell and image field', () => {
  const baseline: IWorkbookData = {
    id: 'unit',
    name: 'Prepared Sheet',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['tab'],
    styles: {},
    sheets: {
      tab: {
        id: 'tab',
        name: 'Images',
        rowCount: 30,
        columnCount: 10,
        cellData: { 1: { 0: { v: 'Keep this cell' } } },
        backgroundImage: {
          source: '/api/items/item/images/image',
          imageSourceType: ImageSourceType.URL,
        },
      },
    },
  };
  const expected = structuredClone(baseline);
  expected.sheets.tab.cellData![0] = { 0: { v: 731, t: 2 } };
  verifyAuthoredContent(expected, baseline, 'sheet', '731');
  for (const corrupt of [
    (sheet: IWorkbookData) => {
      sheet.sheets.tab.cellData![0][0]!.v = 732;
    },
    (sheet: IWorkbookData) => {
      delete sheet.sheets.tab.cellData![1];
    },
    (sheet: IWorkbookData) => {
      delete sheet.sheets.tab.backgroundImage;
    },
  ]) {
    const changed = structuredClone(expected);
    corrupt(changed);
    assert.throws(
      () => verifyAuthoredContent(changed, baseline, 'sheet', '731'),
      /capability-acceptance-authored-sheet-/,
    );
  }
});

function retained() {
  const snapshot = getDocsEmptySnapshot('unit');
  const expected = insert(snapshot, 'Phone731 ', 0);
  // Native checkpoints start at revision 1, including offline-created items.
  const revision = 1;
  const checkpoint: ClientCheckpoint = {
    version: 1,
    unitId: 'unit',
    revision,
    snapshot,
    sent: null,
    inflight: [],
    buffer: [
      [
        {
          id: 'doc.mutation.rich-text-editing',
          params: {
            unitId: 'unit',
            textRanges: [],
            actions: new JSONX().replaceOp(['body'], snapshot.body!, expected.body!),
          },
        },
      ],
    ],
  };
  const record = {
    itemId: 'item',
    name: 'Doc',
    kind: 'doc',
    readOnly: false,
    revision,
    downloadedAt: 1,
    bundle: {
      version: 1,
      accountId: 'actor',
      itemId: 'item',
      unitId: 'unit',
      revisionOffset: 0,
      revision,
      name: 'Doc',
      kind: 'doc',
      access: 'editor',
      readOnly: false,
      sdkVersion: '1.1.0',
      snapshot,
      images: [],
    },
    outbox: {
      version: 1,
      account: 'actor',
      item: 'item',
      unitId: 'unit',
      revisionOffset: 0,
      checkpoint,
    },
  } as StoredItem;
  return { copy: { account: 'actor', record, images: [] }, expected };
}

test('durable proof requires the original account, item, generation, write grant and actual pending native queue', () => {
  const identity = { account: 'actor', item: 'item', unitId: 'unit', kind: 'doc' as const };
  const { copy, expected } = retained();
  const reconstructed = verifyRetainedEdit(copy, identity);
  assert.ok(!('sheets' in reconstructed));
  assert.deepEqual(reconstructed.body, expected.body);
  for (const corrupt of [
    (copy: ReturnType<typeof retained>['copy']) => {
      copy.account = 'other';
    },
    (copy: ReturnType<typeof retained>['copy']) => {
      copy.record.bundle.accountId = 'other';
    },
    (copy: ReturnType<typeof retained>['copy']) => {
      copy.record.bundle.itemId = 'other';
    },
    (copy: ReturnType<typeof retained>['copy']) => {
      copy.record.bundle.readOnly = true;
    },
    (copy: ReturnType<typeof retained>['copy']) => {
      copy.record.outbox!.unitId = 'other';
    },
    (copy: ReturnType<typeof retained>['copy']) => {
      copy.record.outbox!.checkpoint.buffer = [];
    },
  ]) {
    const changed = structuredClone(copy);
    corrupt(changed);
    assert.throws(() => verifyRetainedEdit(changed, identity), /capability-acceptance-durable-/);
  }
});

test('read-only local-copy observation opens no new database, writes no records and always closes', async () => {
  for (const missing of [false, true]) {
    const reads: unknown[] = [];
    let closed = 0;
    let aborted = 0;
    const bytes = new Uint8Array([1, 2, 3]);
    const source = '/api/items/item/images/image';
    const read = (value: unknown) => {
      const request: { result: unknown; onsuccess?: () => void } = { result: value };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    };
    const database = {
      transaction(stores: unknown, mode: string) {
        reads.push({ stores, mode });
        assert.equal(mode, 'readonly');
        return {
          objectStore(store: string) {
            return {
              get(key: string) {
                assert.equal(store, 'items');
                assert.equal(key, 'item');
                return read({ bundle: { itemId: 'item' } });
              },
              getAll() {
                assert.equal(store, 'images');
                return read([
                  { itemId: 'item', source, bytes },
                  { itemId: 'other', source: 'other', bytes },
                ]);
              },
              put() {
                throw new Error('Unexpected storage write');
              },
            };
          },
        };
      },
      close() {
        closed++;
      },
    };
    const sandbox = createContext({
      Uint8Array,
      crypto: webcrypto,
      localStorage: { getItem: () => 'actor' },
      indexedDB: {
        open(name: string) {
          assert.equal(name, 'spinel-offline-actor');
          const request: {
            result: typeof database;
            transaction: { abort(): void };
            onupgradeneeded?: () => void;
            onsuccess?: () => void;
          } = {
            result: database,
            transaction: {
              abort() {
                aborted++;
              },
            },
          };
          queueMicrotask(() => (missing ? request.onupgradeneeded?.() : request.onsuccess?.()));
          return request;
        },
      },
    });
    const operation = runInContext(
      `(async function(){${phoneLocalCopyScript}}).apply(null,['actor','item'])`,
      sandbox,
    ) as Promise<unknown>;
    if (missing) {
      await assert.rejects(operation, /missing/);
      assert.equal(aborted, 1);
      assert.equal(reads.length, 0);
    } else {
      const result = JSON.parse(JSON.stringify(await operation));
      assert.deepEqual(result, {
        account: 'actor',
        record: { bundle: { itemId: 'item' } },
        images: [{ source, size: 3, sha256: createHash('sha256').update(bytes).digest('hex') }],
      });
      assert.equal(closed, 1);
      assert.equal(reads.length, 1);
    }
  }
});

test('native read requests consume only the matching observation and leave no listener behind', () => {
  for (const actualUnit of ['unit', 'different']) {
    const listeners = new Map<string, Set<(event: { type: string; detail?: unknown }) => void>>();
    const requested: unknown[] = [];
    const snapshot = {
      unitId: actualUnit,
      revision: 3,
      snapshot: { id: actualUnit, body: { dataStream: 'Native text\r\n' } },
    };
    const sandbox = createContext({
      CustomEvent: class {
        type: string;
        detail: unknown;
        constructor(type: string, init: { detail: unknown }) {
          this.type = type;
          this.detail = init.detail;
        }
      },
      addEventListener(type: string, receive: (event: { type: string; detail?: unknown }) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(receive);
      },
      removeEventListener(
        type: string,
        receive: (event: { type: string; detail?: unknown }) => void,
      ) {
        listeners.get(type)?.delete(receive);
      },
      dispatchEvent(event: { type: string; detail: unknown }) {
        assert.equal(event.type, 'spinel-sync-native-snapshot-read');
        requested.push(event.detail);
        for (const receive of listeners.get('spinel-sync-native-snapshot') ?? [])
          receive({ type: 'spinel-sync-native-snapshot', detail: structuredClone(snapshot) });
        return true;
      },
    });
    const result = runInContext(
      `(function(){${phoneNativeSnapshotScript}}).apply(null,['unit'])`,
      sandbox,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(requested)), [{ unitId: 'unit' }]);
    assert.equal(listeners.get('spinel-sync-native-snapshot')!.size, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), actualUnit === 'unit' ? snapshot : null);
  }
});

test('the shared text raster locator rejects images and carets while mapping real glyph rows into CSS coordinates', () => {
  for (const dark of [false, true]) {
    const width = 160,
      height = 160,
      channels = 3;
    const data = new Uint8Array(width * height * channels).fill(dark ? 0 : 255);
    const paint = (left: number, top: number, right: number, bottom: number, color: number[]) => {
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) data.set(color, (y * width + x) * channels);
    };
    paint(20, 20, 80, 30, [119, 0, 204]);
    const ink = dark ? [255, 255, 255] : [0, 0, 0];
    paint(30, 32, 31, 44, ink);
    paint(40, 50, 45, 60, ink);
    paint(50, 50, 55, 60, ink);
    paint(60, 50, 65, 60, ink);
    const points = textPoints({
      data,
      width,
      height,
      channels,
      box: { x: 10, y: 20, width: 80, height: 80 },
    });
    assert.equal(points.length, 1);
    assert.equal(points[0].x, 30.1);
    assert.equal(points[0].y, 47.5);
    assert.equal(points[0].glyphWidth, 5);
    assert.equal(points[0].pixels, 150);
  }
  assert.throws(
    () =>
      textPoints({
        data: new Uint8Array(3),
        width: 100,
        height: 100,
        channels: 3,
        box: { x: 0, y: 0, width: 100, height: 100 },
      }),
    /invalid-text-raster/,
  );
});
