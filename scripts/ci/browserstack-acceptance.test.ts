import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  phoneEditableScript,
  phoneLocalCopyScript,
  phoneNativeSnapshotScript,
  assertPhoneImageCheckpoint,
  observePhoneAcceptance,
  openFolder,
  preparePhoneAcceptance,
  boundedPhoneFixtureOperation,
  phoneActions,
  phoneDoubleTap,
  doubleTapPauseMilliseconds,
  tapCalibrationLimit,
  tapOffset,
  tapTraceDiagnostic,
  tapTraceInstallScript,
  tapTraceReadScript,
  withTapTrace,
  readPhoneOpenedCopy,
  verifyAuthoredContent,
  verifyEditablePhone,
  verifyRetainedEdit,
  type PhoneAcceptanceCases,
  type PhoneAcceptanceDriver,
} from './browserstack-acceptance.ts';
import type { BrowserstackFixture } from './browserstack-fixture.ts';

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
    'The Safari bound and cleanup stay under 15 minutes, inside the authored step timeout.',
  );
});

test('the actual Doc readiness script accepts the icon-only Edit control and rejects unavailable authoring controls', () => {
  for (const state of [
    'icon',
    'text',
    'wrong-label',
    'disabled',
    'aria-disabled',
    'hidden',
    'zero-height',
    'zero-width',
    'css-hidden',
    'css-none',
    'missing',
    'reader',
    'save-reader',
    'desktop',
    'missing-editor',
  ]) {
    const button = {
      // This is the pinned OSS MobileDocToolbar's actual shape: its WriteIcon
      // contributes no text, while aria-label supplies the Edit accessible name.
      textContent: state === 'text' || state === 'wrong-label' ? ' Edit ' : '',
      hidden: state === 'hidden',
      disabled: state === 'disabled',
      getAttribute(name: string) {
        if (name === 'aria-disabled') return state === 'aria-disabled' ? 'true' : null;
        assert.equal(name, 'aria-label');
        return state === 'text' ? null : state === 'wrong-label' ? 'Preview' : 'Edit';
      },
      getBoundingClientRect() {
        return { width: state === 'zero-width' ? 0 : 40, height: state === 'zero-height' ? 0 : 40 };
      },
    };
    const root = {
      innerText: state === 'reader' ? 'View only' : '',
      getAttribute(name: string) {
        assert.equal(name, 'data-mobile');
        return state === 'desktop' ? 'false' : 'true';
      },
      querySelectorAll(selector: string) {
        assert.equal(selector, 'button');
        return state === 'missing' ? [] : [button];
      },
    };
    const sandbox = createContext({
      document: {
        querySelector(selector: string) {
          if (selector === '[aria-label="Doc document"]')
            return state === 'missing-editor' ? null : root;
          assert.equal(selector, '[aria-label="Save status"]');
          return { textContent: state === 'save-reader' ? 'Edit on a larger screen' : '' };
        },
      },
      getComputedStyle(element: unknown) {
        assert.equal(element, button);
        return {
          visibility: state === 'css-hidden' ? 'hidden' : 'visible',
          display: state === 'css-none' ? 'none' : 'block',
        };
      },
    });
    const observed = runInContext(
      `(function(){${phoneEditableScript}}).apply(null,['[aria-label="Doc document"]','doc'])`,
      sandbox,
    );
    if (state === 'icon' || state === 'text') {
      assert.doesNotThrow(() => verifyEditablePhone(observed, 'doc'), state);
    } else {
      assert.throws(() => verifyEditablePhone(observed, 'doc'), /capability-acceptance-/, state);
    }
  }
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

function retained(snapshot = getDocsEmptySnapshot('unit')) {
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

test('image checkpoints reject missing pixels and failed required captures despite intact retained content', async () => {
  const { copy, expected } = retained(imageDoc());
  const source = (expected.drawings!.image as IDocImage).source;
  const image = { source, sha256: 'a'.repeat(64), size: 3 };
  copy.record.bundle.images = [
    { source, sha256: image.sha256, byteLength: image.size, mime: 'image/png' },
  ];
  const stored = { ...copy, images: [image] };
  const before = structuredClone(stored);
  const snapshot = verifyRetainedEdit(stored, {
    account: 'actor',
    item: 'item',
    unitId: 'unit',
    kind: 'doc',
  });
  assert.ok(!('sheets' in snapshot));
  // Native reconstruction also materializes plugin resources. Keep every Doc
  // field compared and verify the image resource agrees with the retained graph.
  assert.deepEqual({ ...snapshot, resources: undefined }, { ...expected, resources: undefined });
  const drawingResource = snapshot.resources?.find((entry) => entry.name === 'DOC_DRAWING_PLUGIN');
  assert.deepEqual(JSON.parse(drawingResource!.data), {
    data: expected.drawings,
    order: expected.drawingsOrder,
  });
  for (const failure of ['required-image-pixels-missing', 'required-capture-failed']) {
    const calls: string[] = [];
    const error = new Error(failure);
    const driver = {
      remaining: (maximum: number) => maximum,
      async execute(script: string, args: unknown[]) {
        assert.equal(script, phoneNativeSnapshotScript);
        assert.deepEqual(args, ['unit']);
        calls.push('native-snapshot');
        return { unitId: 'unit', revision: 1, snapshot: structuredClone(snapshot) };
      },
      async visibleImages(name: string, kind: string) {
        assert.equal(name, 'doc-pending-reopened');
        assert.equal(kind, 'doc');
        calls.push('required-rendering');
        throw error;
      },
    } as unknown as PhoneAcceptanceDriver;
    await assert.rejects(
      assertPhoneImageCheckpoint(
        driver,
        { unitId: 'unit', kind: 'doc' },
        snapshot,
        'doc-pending-reopened',
      ),
      (actual) => actual === error,
    );
    assert.deepEqual(calls, ['native-snapshot', 'required-rendering']);
    assert.deepEqual(stored, before, 'Intact records and image metadata cannot replace rendering.');
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

test('acceptance prepares its Space page through the shared Offline copies flow', async () => {
  const doc = { kind: 'doc', baseline: { snapshot: { documentStyle: { documentFlavor: 2 } } } };
  const fixture = {
    items: [doc, doc, { kind: 'sheet' }, { kind: 'sheet' }],
  } as unknown as BrowserstackFixture;
  const cases = {
    space: { id: 'space-1' },
    spaceChild: { id: 'page-1', name: 'Phone prepared page' },
  } as unknown as PhoneAcceptanceCases;
  const visited: string[] = [];
  const clicks: [string, string][] = [];
  const stop = new Error('stop-after-space-preparation');
  const driver = {
    navigate: async (path: string) => {
      visited.push(path);
      if (visited.length > 1) throw stop;
    },
    ready: async () => ({}),
    click: async (selector: string, label: string) => void clicks.push([selector, label]),
    execute: async () => ({ dialogs: 1, done: true, alert: null }),
    record: async () => assert.fail('A successful preparation records no failure state.'),
    remaining: (maximum = 15_000) => maximum,
  } as unknown as PhoneAcceptanceDriver;
  await assert.rejects(preparePhoneAcceptance(driver, fixture, cases), stop);
  assert.deepEqual(visited, ['/spaces/space-1?item=page-1', '/']);
  // Labels are pinned to the app source in browserstack-offline-preparation.test.ts.
  assert.deepEqual(clicks, [
    ['button', 'Document actions'],
    ['[role="menuitem"]', 'Offline copies'],
    ['[role="dialog"] button', 'Make Phone prepared page available offline on this device'],
    ['[role="dialog"] button', 'Close dialog'],
  ]);
});

test('every Shared with me visit on a phone goes through the Browse files drawer', async () => {
  const steps: string[] = [];
  const driver = {
    navigate: async (path: string) => void steps.push(`navigate ${path}`),
    click: async (selector: string, label: string) => void steps.push(`click ${selector} ${label}`),
    execute: async () => true,
    remaining: (maximum = 15_000) => maximum,
  } as unknown as PhoneAcceptanceDriver;
  await openFolder(driver, { name: 'Phone shared folder' }, true);
  await openFolder(driver, { name: 'Phone owned folder' }, false);
  assert.deepEqual(steps, [
    'navigate /',
    'click button Browse files',
    'click [role="dialog"] button Shared with me',
    'click button Phone shared folder Folder',
    'navigate /',
    'click button Phone owned folder Folder',
  ]);
  // No other step clicks a Shared with me button the phone layout hides.
  const acceptance = readFileSync(new URL('./browserstack-acceptance.ts', import.meta.url), 'utf8');
  assert.deepEqual(
    acceptance.match(/'Shared with me'/g),
    ["'Shared with me'"],
    'Only openSharedWithMe names Shared with me',
  );
  assert.match(
    acceptance,
    /async function openSharedWithMe\([^)]*\) \{\s*await driver\.click\('button', 'Browse files'\);\s*await driver\.click\('\[role="dialog"\] button', 'Shared with me'\);/,
  );
  // Both labels are the ones the phone layout renders.
  const rail = readFileSync(new URL('../../web/Rail.tsx', import.meta.url), 'utf8');
  assert.match(rail, /aria-label="Browse files"/);
  assert.match(
    rail,
    /<Modal title="Browse files"[^>]*>\s*<div className="file-rail-drawer">\s*\{places\(\)\}/,
  );
  assert.match(rail, /aria-label=\{shared \? 'Shared with me' : 'My files'\}/);
});

test('a successful action sequence tolerates only an unknown-command release, recorded once', async () => {
  const records: [string, unknown][] = [];
  const calls: string[] = [];
  const coded = (code: string) =>
    Object.assign(new Error('http-404'), { webdriverErrorCode: code });
  const driver = (postError?: Error, deleteError?: Error) =>
    ({
      command: async (suffix: string, method = 'GET') => {
        calls.push(`${method} ${suffix}`);
        if (method === 'POST' && postError) throw postError;
        if (method === 'DELETE' && deleteError) throw deleteError;
        return null;
      },
      record: async (stage: string, value: unknown) => {
        records.push([stage, value]);
      },
    }) as unknown as PhoneAcceptanceDriver;
  const safari = driver(undefined, coded('unknown command'));
  await phoneActions(safari, { type: 'key', id: 'k', actions: [] });
  await phoneActions(safari, { type: 'key', id: 'k', actions: [] });
  assert.deepEqual(calls, ['POST actions', 'DELETE actions', 'POST actions', 'DELETE actions']);
  assert.deepEqual(records, [
    ['actions-release-unsupported', { webdriverErrorCode: 'unknown command' }],
  ]);
  const other = coded('unknown error');
  await assert.rejects(phoneActions(driver(undefined, other), {}), (error) => error === other);
  const uncoded = new Error('http-500');
  await assert.rejects(phoneActions(driver(undefined, uncoded), {}), (error) => error === uncoded);
  const posted = new Error('http-500');
  await assert.rejects(
    phoneActions(driver(posted, coded('unknown command')), {}),
    (error) => error === posted,
  );
  assert.equal(records.length, 1);
});

type TraceRow = Record<string, unknown>;

test('without native touch, a phone double tap calibrates its aim once, then taps twice 250 ms apart in one W3C sequence', async () => {
  const calls: [string, unknown][] = [];
  const records: [string, unknown][] = [];
  const landed = {
    installed: true,
    events: [{ type: 'pointerdown', pointerType: 'touch', milliseconds: 5, dx: 0, dy: -62 }],
  };
  const driver = {
    execute: async (script: string, args: unknown[] = []) => {
      const name =
        script === tapTraceInstallScript
          ? 'install'
          : script === tapTraceReadScript
            ? args[0] === true
              ? 'peek'
              : 'read'
            : 'hit';
      calls.push([name, args]);
      return name === 'peek' || name === 'read' ? landed : true;
    },
    command: async (suffix: string, method = 'GET', body?: unknown) => {
      calls.push([`${method} ${suffix}`, body]);
      return null;
    },
    remaining: (maximum = 1) => maximum,
    record: async (stage: string, value: unknown) => {
      records.push([stage, value]);
    },
  } as unknown as PhoneAcceptanceDriver;
  const started = Date.now();
  assert.deepEqual(await phoneDoubleTap(driver, 'canvas', { x: 80.4, y: 39.6 }), { x: 80, y: 40 });
  assert.ok(Date.now() - started >= 600, "the double tap waits out Univer's 500 ms window");
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      'hit',
      'hit',
      'install',
      'POST actions',
      'DELETE actions',
      'peek',
      'read',
      'hit',
      'install',
      'POST actions',
      'DELETE actions',
    ],
  );
  assert.deepEqual(records, [['native-tap-calibration', tapTraceDiagnostic(landed)]]);
  const sources = calls
    .filter(([name]) => name === 'POST actions')
    .map(([, body]) => (body as { actions: { actions: TraceRow[] }[] }).actions[0]!.actions);
  assert.deepEqual(
    sources[0]!.map((action) => action.type),
    ['pointerMove', 'pointerDown', 'pointerUp'],
  );
  assert.deepEqual(sources[0]![0], {
    type: 'pointerMove',
    origin: 'viewport',
    duration: 0,
    x: 80,
    y: 40,
  });
  // Landed 62 px high, so the double tap aims 62 px lower. One sequence, since
  // separate calls arrived 715 ms apart; 250 ms apart, since 100 ms overlapped.
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[1], [
    { type: 'pointerMove', origin: 'viewport', duration: 0, x: 80, y: 102 },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerUp', button: 0 },
    { type: 'pause', duration: 250 },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerUp', button: 0 },
  ]);
  assert.ok(doubleTapPauseMilliseconds < 500, "inside Univer's double-click window");
  assert.deepEqual(
    calls[8]![1],
    [{ x: 80, y: 40 }, 'canvas'],
    'the trace measures against the in-page point',
  );
  calls.length = 0;
  await phoneDoubleTap(driver, 'canvas', { x: 10, y: 10 });
  assert.deepEqual(
    calls.map(([name]) => name),
    ['hit', 'hit', 'install', 'POST actions', 'DELETE actions'],
    'the session calibrates once, and checks the target after calibrating',
  );
});

test('with native touch (Safari), the calibration and the double tap are one native gesture each, the calibration at its own checked point', async () => {
  const calls: [string, unknown][] = [];
  const landed = {
    installed: true,
    events: [{ type: 'pointerdown', pointerType: 'touch', milliseconds: 5, dx: 0, dy: -62 }],
  };
  const driver = {
    execute: async (script: string, args: unknown[] = []) => {
      const name =
        script === tapTraceInstallScript
          ? 'install'
          : script === tapTraceReadScript
            ? args[0] === true
              ? 'peek'
              : 'read'
            : 'hit';
      calls.push([name, args]);
      return name === 'peek' || name === 'read' ? landed : true;
    },
    command: async (suffix: string, method = 'GET', body?: unknown) => {
      calls.push([`${method} ${suffix}`, body]);
      return null;
    },
    nativeTouch: async (point: unknown, taps: number) => {
      calls.push([`native ${taps}`, point]);
    },
    remaining: (maximum = 1) => maximum,
    record: async () => {},
  } as unknown as PhoneAcceptanceDriver;
  await phoneDoubleTap(driver, 'canvas', { x: 80, y: 40 }, { x: 220.4, y: 351.6 });
  assert.deepEqual(
    calls.map(([name]) => name),
    ['hit', 'hit', 'install', 'native 1', 'peek', 'read', 'hit', 'install', 'native 2'],
  );
  // Run 41928778203: the A1 aim's calibration landed on the sheet-tab bar, so
  // the calibration taps its own point, checked first, and the aim is rechecked.
  assert.deepEqual(calls[1]![1], ['canvas', { x: 220, y: 352 }]);
  assert.deepEqual(calls[3]![1], { x: 220, y: 352 });
  assert.deepEqual(calls[6]![1], ['canvas', { x: 80, y: 40 }]);
  // Calibrated the same way: landed 62 px high, so the double tap aims 62 px lower.
  assert.deepEqual(calls[8]![1], { x: 80, y: 102 });
});

test('a deadline during tap calibration fails as the deadline, not as an unseen tap', async () => {
  const deadline = new Error('capability-acceptance-phase-deadline');
  let reads = 0;
  const driver = {
    execute: async (script: string) => {
      if (script === tapTraceReadScript) reads++;
      return script === tapTraceReadScript ? { installed: true, events: [] } : true;
    },
    command: async () => null,
    remaining: (maximum = 1) => {
      if (reads > 0) throw deadline;
      return maximum;
    },
    record: async () => {},
  } as unknown as PhoneAcceptanceDriver;
  await assert.rejects(
    phoneDoubleTap(driver, 'canvas', { x: 5, y: 5 }),
    (error) => error === deadline,
  );
});

test('tap calibration refuses an unseen or implausible landing', () => {
  const trace = (events: TraceRow[]) => tapTraceDiagnostic({ installed: true, events });
  assert.deepEqual(
    tapOffset(
      trace([
        { type: 'click', dx: 1, dy: 1 },
        { type: 'touchstart', dx: -3, dy: 4 },
      ]),
    ),
    { x: -3, y: 4 },
  );
  assert.deepEqual(tapOffset(trace([{ type: 'pointerdown', dx: 0, dy: -tapCalibrationLimit }])), {
    x: 0,
    y: -120,
  });
  assert.throws(() => tapOffset(trace([])), /native-tap-calibration-unseen/);
  assert.throws(
    () => tapOffset(trace([{ type: 'click', dx: 0, dy: 0 }])),
    /native-tap-calibration-unseen/,
  );
  assert.throws(
    () => tapOffset(trace([{ type: 'pointerdown', dx: null, dy: 0 }])),
    /native-tap-calibration-unseen/,
  );
  assert.throws(
    () => tapOffset(trace([{ type: 'pointerdown', dx: 0, dy: 121 }])),
    /native-tap-calibration-offset/,
  );
});

test('the page tap trace keeps 24 bounded events and removes its listeners when read', () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const removed: string[] = [];
  const window: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => removed.push(type),
  };
  const context = createContext({ window, performance: { now: () => 1000 } });
  const run = (script: string, args: unknown[] = []) =>
    // WebDriver returns the script's value as JSON.
    JSON.parse(
      JSON.stringify(
        runInContext(`(function(){${script}}).apply(null, args)`, Object.assign(context, { args })),
      ),
    );
  assert.deepEqual(run(tapTraceReadScript), { installed: false, events: [] });
  assert.equal(run(tapTraceInstallScript, [{ x: 80, y: 40 }]), true);
  listeners.get('pointerdown')!({
    type: 'pointerdown',
    pointerType: 'touch',
    timeStamp: 1012.4,
    clientX: 81,
    clientY: 38,
    target: { textContent: 'secret' },
  });
  listeners.get('touchend')!({
    type: 'touchend',
    timeStamp: 1030,
    changedTouches: [{ clientX: 79, clientY: 40 }],
  });
  for (let index = 0; index < 30; index++)
    listeners.get('click')!({ type: 'click', pointerType: 'mouse', timeStamp: 1100 });
  const peeked = run(tapTraceReadScript, [true]) as { events: TraceRow[] };
  assert.equal(peeked.events.length, 24);
  assert.deepEqual(removed, [], 'a peek keeps the trace recording');
  const read = run(tapTraceReadScript) as { installed: boolean; events: TraceRow[] };
  assert.equal(read.installed, true);
  assert.equal(read.events.length, 24);
  assert.deepEqual(read.events.slice(0, 2), [
    {
      type: 'pointerdown',
      pointerType: 'touch',
      milliseconds: 12,
      dx: 1,
      dy: -2,
      target: null,
      element: null,
    },
    {
      type: 'touchend',
      pointerType: null,
      milliseconds: 30,
      dx: -1,
      dy: 0,
      target: null,
      element: null,
    },
  ]);
  assert.deepEqual([(read as TraceRow).viewport, (read as TraceRow).canvas], [null, null]);
  assert.equal(JSON.stringify(read).includes('secret'), false);
  assert.deepEqual(removed.sort(), [...listeners.keys()].sort());
  assert.equal('__spinelTapTrace' in window, false);
  assert.deepEqual(
    tapTraceDiagnostic({
      installed: true,
      events: [
        {
          type: 'pointer<down>',
          pointerType: 'touch-screen',
          milliseconds: 1.5,
          dx: 2,
          element: 'div[x]"leak"',
        },
      ],
      text: 'leak',
    }),
    {
      installed: true,
      events: [
        {
          type: 'other',
          pointerType: null,
          milliseconds: null,
          dx: 2,
          dy: null,
          target: null,
          element: null,
        },
      ],
      viewport: null,
      canvas: null,
    },
  );
});

test('given the canvas selector, the tap trace names each target and reads the viewport and box', () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const named = (tagName: string, comp: string | null) => ({
    tagName,
    closest: () => (comp === null ? null : { getAttribute: () => comp }),
  });
  const canvas = {
    ...named('CANVAS', 'sheet-canvas'),
    getBoundingClientRect: () => ({ x: 0.4, y: 251.6, width: 440, height: 600 }),
  };
  const sibling = named('DIV', null);
  const cover = named('SPAN', 'sheet-bar');
  Object.assign(canvas, { parentElement: { contains: (node: unknown) => node === sibling } });
  const window: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: () => {},
    visualViewport: { scale: 1.23456, offsetLeft: 0, offsetTop: 12.5 },
  };
  const document = { querySelector: (selector: string) => (selector === 'canvas' ? canvas : null) };
  const context = createContext({ window, document, performance: { now: () => 1000 } });
  const run = (script: string, args: unknown[] = []) =>
    JSON.parse(
      JSON.stringify(
        runInContext(`(function(){${script}}).apply(null, args)`, Object.assign(context, { args })),
      ),
    );
  run(tapTraceInstallScript, [{ x: 80, y: 40 }, 'canvas']);
  for (const target of [canvas, sibling, cover, {}])
    listeners.get('pointerdown')!({
      type: 'pointerdown',
      timeStamp: 1001,
      clientX: 80,
      clientY: 40,
      target,
    });
  const diagnostic = tapTraceDiagnostic(run(tapTraceReadScript));
  assert.deepEqual(
    diagnostic.events.map((event) => event.target),
    ['grid', 'region', 'other', 'other'],
  );
  assert.deepEqual(
    diagnostic.events.map((event) => event.element),
    ['canvas[sheet-canvas]', 'div', 'span[sheet-bar]', null],
  );
  assert.deepEqual(diagnostic.viewport, { scale: 1.23, offsetLeft: 0, offsetTop: 12.5 });
  assert.deepEqual(diagnostic.canvas, { x: 0, y: 252, width: 440, height: 600 });
});

test('an editor that never opens records the tap trace and keeps its own failure', async () => {
  const records: [string, unknown][] = [];
  const driver = (read: () => Promise<unknown>) =>
    ({
      execute: read,
      record: async (stage: string, value: unknown) => {
        records.push([stage, value]);
      },
    }) as unknown as PhoneAcceptanceDriver;
  assert.equal(
    await withTapTrace(
      driver(async () => assert.fail('read on success')),
      'sheet',
      async () => 7,
    ),
    7,
  );
  assert.deepEqual(records, []);
  const failure = new Error('capability-acceptance-native-sheet-formula-bar-unavailable');
  const traced = driver(async () => ({ installed: true, events: [] }));
  await assert.rejects(
    withTapTrace(traced, 'sheet', async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  const unreadable = driver(async () => {
    throw new Error('http-500');
  });
  await assert.rejects(
    withTapTrace(unreadable, 'doc', async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(records, [
    ['native-sheet-tap-trace', { installed: true, events: [], viewport: null, canvas: null }],
    ['native-doc-tap-trace', 'unavailable'],
  ]);
});
