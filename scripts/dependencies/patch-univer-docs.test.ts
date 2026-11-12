/**
 * Copyright 2023-present DreamNum Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for Spinel: execute the pinned public Doc state manager region
 * against real JSONX/TextX operations and controlled service endpoints/timers.
 * Original bundle bytes are semantic and primitive-work negative controls.
 * Source: packages/docs/src/services/doc-state-change-manager.service.ts,
 * dream-num/univer v1.3.1. No Pro package is read or modified.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import * as core from '@univerjs/core';
import type { IDocumentData, JSONXActions } from '@univerjs/core';
import type {
  DocStateChangeManagerService,
  IDocStateChangeInfo,
  IDocStateChangeParams,
} from '@univerjs/docs';
import { BehaviorSubject, Subject, takeUntil } from 'rxjs';
import { patchInstalledDocs, prepareDocsPatch } from './patch-univer-docs.ts';
import { observeNativeDocComposition } from '../../src/ui/nativeDocFlushDiagnostic.ts';
import type { DiagnosticManager } from '../../src/ui/nativeDocFlushDiagnostic.ts';
import type {
  NativeDocFlushManager,
  NativeDocFlushObservation,
} from '../../src/ui/nativeDocFlush.ts';

type Format = 'es' | 'cjs';
type State = IDocStateChangeParams;
type Side = State['redoState'] & { unitId: string; segmentId?: string; trigger?: string };
type Entry = {
  unitID: string;
  undoMutations: { id: string; params: Side }[];
  redoMutations: { id: string; params: Side }[];
};
type Manager = Pick<
  DocStateChangeManagerService,
  | 'getStateCache'
  | 'setStateCache'
  | 'clearHistory'
  | 'flushPendingChanges'
  | 'docStateChange$'
  | 'dispose'
>;
type Request = (snapshot: IDocumentData) => JSONXActions;
const unitId = 'composition-doc';
const readBuild = (format: Format) =>
  readFile(
    new URL(`../../node_modules/@univerjs/docs/lib/${format}/index.js`, import.meta.url),
    'utf8',
  );

// Lossless native capture encoding preserves own undefined fields and arrays.
function decodeCapture(value: any): any {
  if (value.kind === 'undefined') return undefined;
  if (value.kind === 'value') return value.value;
  assert.ok(value.kind === 'array' || value.kind === 'object');
  const result: any = value.kind === 'array' ? [] : {};
  for (const [key, child] of value.entries) {
    if (Array.isArray(result) && key === 'length') result.length = decodeCapture(child);
    else
      Object.defineProperty(result, key, {
        value: decodeCapture(child),
        writable: true,
        enumerable: true,
        configurable: true,
      });
  }
  return result;
}

function clock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    count: () => pending.size,
    now: () => now,
    elapse(milliseconds: number) {
      now += milliseconds;
    },
    setTimeout(callback: () => void, delay: number) {
      const id = nextId++;
      pending.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id: number) {
      pending.delete(id);
    },
    tick(milliseconds: number) {
      now += milliseconds;
      for (const [id, task] of pending) {
        if (task.at > now) continue;
        pending.delete(id);
        task.callback();
      }
    },
  };
}

function managerFixture(
  source: string,
  costs: {
    history?: number;
    historyError?: Error;
    collaboration?: number;
    listEvaluation?: () => void;
  } = {},
) {
  const marker = '//#region src/services/doc-state-change-manager.service.ts\n';
  const start = source.indexOf(marker);
  const end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start, 'Execute the actual hash-verified manager region.');
  const timers = clock();
  const contextCore = { ...core, Inject: () => () => {}, Optional: () => () => {} };
  const ManagerClass = runInNewContext(
    `${source.slice(start + marker.length, end)}\nDocStateChangeManagerService;`,
    {
      __spn142List: <T>(value: T): T => {
        costs.listEvaluation?.();
        return value;
      },
      ...contextCore,
      Object,
      Array,
      performance: { now: timers.now },
      ...timers,
      BehaviorSubject,
      takeUntil,
      _univerjs_core: contextCore,
      rxjs: { BehaviorSubject, takeUntil },
      DocStateEmitService: {},
      _defineProperty: (object: Record<string, unknown>, key: string, value: unknown) => {
        object[key] = value;
        return object;
      },
      __decorate: (_decorators: unknown, constructor: unknown) => constructor,
      __decorateParam: () => () => {},
    },
    { filename: 'docs.installed-state-manager.js', timeout: 1000 },
  );
  const input = new Subject<IDocStateChangeInfo>();
  const history: Entry[] = [];
  const changes: State[] = [];
  const publication: { kind: string; history: number; collaboration: number }[] = [];
  const commands = new Set<(command: { id: string }) => void>();
  let manager: Manager;
  const observe = (kind: string) => {
    const cache = manager.getStateCache(unitId);
    publication.push({
      kind,
      history: cache.history.length,
      collaboration: cache.collaboration.length,
    });
  };
  manager = new ManagerClass(
    {
      pushUndoRedo(entry: Entry) {
        timers.elapse(costs.history ?? 0);
        if (costs.historyError) throw costs.historyError;
        observe('history');
        history.push(structuredClone(entry));
      },
    },
    {
      beforeCommandExecuted(listener: (command: { id: string }) => void) {
        commands.add(listener);
        return { dispose: () => commands.delete(listener) };
      },
    },
    { getCurrentUnitOfType: () => ({ getUnitId: () => unitId }) },
    { docStateChangeParams$: input },
  ) as Manager;
  const subscription = manager.docStateChange$.subscribe((state) => {
    if (!state) return;
    timers.elapse(costs.collaboration ?? 0);
    observe('collaboration');
    changes.push(structuredClone(state));
  });
  return {
    manager,
    input,
    timers,
    history,
    changes,
    publication,
    beforeCommand(id: string) {
      for (const listener of commands) listener({ id });
    },
    close() {
      subscription.unsubscribe();
      manager.dispose();
      input.complete();
      assert.equal(commands.size, 0);
      assert.equal(timers.count(), 0);
    },
  };
}

function apply(snapshot: IDocumentData, actions: JSONXActions) {
  const model = new core.DocumentDataModel(structuredClone(snapshot));
  try {
    model.apply(structuredClone(actions));
    return structuredClone(model.getSnapshot());
  } finally {
    model.dispose();
  }
}

function seed(text = 'alpha\rbravo\r\n') {
  const snapshot = core.getDocsEmptySnapshot(
    unitId,
    core.LocaleType.EN_US,
    'Composition',
    core.DocumentFlavor.MODERN,
  );
  snapshot.body = {
    dataStream: text,
    textRuns:
      text.length > 2
        ? [{ st: 0, ed: text.length - 2, ts: { bl: 1, cl: { rgb: '#123456' } } }]
        : [],
    paragraphs: [...text].flatMap((character, index) =>
      character === '\r'
        ? [
            {
              startIndex: index,
              // Native split replay preserves only IDs with the para_ prefix.
              paragraphId: `para_seed_${index}`,
              paragraphStyle: { outlineLevel: 1 },
            },
          ]
        : [],
    ),
    sectionBreaks: [{ startIndex: text.length - 1, sectionId: 'section_seed' }],
    customRanges:
      text.length > 6
        ? [
            {
              rangeId: 'link',
              rangeType: core.CustomRangeType.HYPERLINK,
              startIndex: 1,
              endIndex: 3,
              properties: { url: 'https://example.test/old' },
            },
          ]
        : [],
    customDecorations: [],
  };
  return apply(snapshot, null);
}

function sequence(requests: Request[], initial = seed()) {
  const snapshots = [initial];
  const states = requests.map((request, index): State => {
    const before = snapshots.at(-1)!;
    const actions = request(structuredClone(before));
    // This is the native mutation's inverse/apply order. Inversion realizes
    // inserted paragraph identities before the same actions are applied.
    const inverse = core.JSONX.invertWithDoc(actions, before);
    snapshots.push(apply(before, actions));
    return {
      commandId: 'doc.mutation.rich-text-editing',
      unitId,
      trigger: 'doc.command.insert-text',
      segmentId: '',
      noHistory: false,
      debounce: true,
      redoState: {
        actions,
        textRanges: [{ startOffset: index + 1, endOffset: index + 1, collapsed: true }],
        options: { restoreSelection: index % 2 === 0 },
        isEditing: index % 2 !== 0,
        layoutState: { step: index + 1, nested: ['redo', index] },
      },
      undoState: {
        actions: inverse,
        textRanges: [{ startOffset: index, endOffset: index, collapsed: true }],
        options: { restoreSelection: index % 2 !== 0 },
        isEditing: index % 2 === 0,
        layoutState: { step: index, nested: ['undo', index] },
      },
    };
  });
  // A native inverse need not recreate the seed's original representation:
  // deleting an insertion retains split style runs and initializes empty block
  // metadata. Derive the reverse oracle by applying the captured inverses one
  // at a time, with no composition and no metadata normalization in the test.
  const undoSnapshots: IDocumentData[] = [];
  undoSnapshots[states.length] = snapshots.at(-1)!;
  for (let index = states.length - 1; index >= 0; index--)
    undoSnapshots[index] = apply(undoSnapshots[index + 1], states[index].undoState.actions);
  return { states, snapshots, undoSnapshots };
}

const edit = (text: core.TextX) => core.JSONX.getInstance().editOp(text.serialize());
// Public DocInputController's collapsed input, after sync capture marks inserts
// before native apply. Captured browser caches in SPN-132 exposed this field.
function keyboardBody(index = 0): core.IDocumentBody {
  const body: core.IDocumentBody & { __textXPreserveParagraphIds: true } = {
    __textXPreserveParagraphIds: true,
    dataStream: 'x',
    textRuns: [{ st: 0, ed: 1, ts: { bl: index % 2 === 0 ? 1 : 0, cl: { rgb: '#123456' } } }],
    customRanges: [],
    customDecorations: [],
  };
  return body;
}
const insertAt =
  (offset: number, body = keyboardBody()): Request =>
  () =>
    edit(new core.TextX().retain(offset).insert(body.dataStream.length, body));

function paragraphSequence(
  position: number,
  length = 32,
  coverType = core.UpdateDocsAttributeType.COVER,
  offset = 0,
  decorate?: (body: core.IDocumentBody, isEnter: boolean) => void,
) {
  return sequence(
    Array.from({ length }, (_, index) => {
      const body = keyboardBody(index);
      decorate?.(body, index === position);
      if (index !== position) return insertAt(offset + index, body);
      return () =>
        edit(
          new core.TextX()
            .retain(offset + index)
            .insert(1, {
              ...body,
              dataStream: '\r',
              paragraphs: [
                { startIndex: 0, paragraphId: `para_insert_${position}`, paragraphStyle: {} },
              ],
            })
            .retain(
              1,
              {
                dataStream: '',
                textRuns: [{ st: 0, ed: 1, ts: { cl: { rgb: '#123456' } } }],
              },
              coverType,
            ),
        );
    }),
    seed('z'.repeat(offset + 1) + '\r\n'),
  );
}

const mixed: Request[] = [
  () =>
    edit(
      new core.TextX()
        .retain(2)
        .insert(2, { dataStream: 'XY', textRuns: [{ st: 0, ed: 2, ts: { it: 1 } }] }),
    ),
  () => edit(new core.TextX().retain(3).delete(1)),
  () =>
    edit(
      new core.TextX()
        .retain(8)
        .delete(2)
        .insert(1, { dataStream: 'Z', textRuns: [{ st: 0, ed: 1, ts: { bl: 0 } }] }),
    ),
  () =>
    edit(
      new core.TextX().retain(
        4,
        { dataStream: '', textRuns: [{ st: 0, ed: 4, ts: { bl: 1, it: 1 } }] },
        core.UpdateDocsAttributeType.COVER,
      ),
    ),
  () =>
    edit(
      new core.TextX().retain(
        4,
        { dataStream: '', textRuns: [{ st: 0, ed: 4, ts: { bl: 0 } }] },
        core.UpdateDocsAttributeType.REPLACE,
      ),
    ),
  (snapshot) =>
    edit(
      new core.TextX().retain(snapshot.body!.paragraphs![0].startIndex).retain(
        1,
        {
          dataStream: '',
          paragraphs: [
            {
              startIndex: 0,
              paragraphId: snapshot.body!.paragraphs![0].paragraphId,
              paragraphStyle: {},
            },
          ],
        },
        core.UpdateDocsAttributeType.REPLACE,
      ),
    ),
  (snapshot) => {
    const text = core.BuildTextUtils.customRange.add({
      ranges: [{ startOffset: 0, endOffset: 5, collapsed: false }],
      rangeId: 'replacement-link',
      rangeType: core.CustomRangeType.HYPERLINK,
      properties: { url: 'https://example.test/new' },
      body: snapshot.body!,
    });
    assert.ok(text);
    return edit(text);
  },
  (snapshot) => core.JSONX.getInstance().replaceOp(['title'], snapshot.title, 'Updated title'),
  (snapshot) =>
    edit(
      new core.TextX().retain(snapshot.body!.dataStream.length - 2).insert(1, {
        dataStream: '\r',
        paragraphs: [{ startIndex: 0, paragraphId: 'para_inserted' }],
      }),
    ),
  () => null,
  (snapshot) => edit(new core.TextX().retain(snapshot.body!.paragraphs![0].startIndex).delete(1)),
];

function ownDataShape(value: unknown, seen = new Map<object, number>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return { reference: seen.get(value) };
  seen.set(value, seen.size);
  return {
    prototype: Object.getPrototypeOf(value),
    properties: Reflect.ownKeys(value).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return [
        key,
        'value' in descriptor
          ? { ...descriptor, value: ownDataShape(descriptor.value, seen) }
          : descriptor,
      ];
    }),
  };
}

function flush(source: string, history: State[], collaboration = history, raw = false) {
  const fixture = managerFixture(source);
  try {
    // Native caches are distinct arrays even when their state objects coincide.
    const inputCache = { history: [...history], collaboration: [...collaboration] };
    const cache = raw ? inputCache : structuredClone(inputCache);
    const retainedStates = [...cache.history, ...cache.collaboration];
    const before = structuredClone(retainedStates);
    const shapeBefore = raw ? ownDataShape(retainedStates) : undefined;
    fixture.manager.setStateCache(unitId, cache);
    fixture.manager.flushPendingChanges(unitId);
    if (raw)
      assert.deepEqual(
        ownDataShape(retainedStates),
        shapeBefore,
        'Own keys, descriptors and prototypes remain unchanged without reading accessors.',
      );
    assert.deepEqual(
      raw ? structuredClone(retainedStates) : retainedStates,
      before,
      'Composition must not mutate native state objects.',
    );
    assert.deepEqual(structuredClone(fixture.manager.getStateCache(unitId)), {
      history: [],
      collaboration: [],
    });
    return { history: fixture.history, changes: fixture.changes, publication: fixture.publication };
  } finally {
    fixture.close();
  }
}

function appliedSnapshots(
  output: ReturnType<typeof flush>,
  { snapshots }: ReturnType<typeof sequence>,
  historyStart = 0,
) {
  const after = snapshots.at(-1)!;
  const [entry] = output.history;
  const [change] = output.changes;
  return {
    history: entry && {
      redo: apply(snapshots[historyStart], entry.redoMutations[0].params.actions),
      undo: apply(after, entry.undoMutations[0].params.actions),
    },
    collaboration: change && {
      redo: apply(snapshots[0], change.redoState.actions),
      undo: apply(after, change.undoState.actions),
    },
  };
}

// The unmodified SDK can partition identical styles differently after aggregate
// versus individual inverse replay. This view is ONLY for that independent
// sequential oracle. Candidate publications and snapshots always compare raw.
function sequentialStyleView(snapshot: IDocumentData, context: string) {
  const otherFields = structuredClone(snapshot);
  const body = otherFields.body!;
  const ownsTextRuns = Object.hasOwn(body, 'textRuns');
  const runs = body.textRuns;
  delete body.textRuns;
  if (runs == null) return { otherFields, ownsTextRuns, runs };
  assert.ok(Array.isArray(runs), `${context}: textRuns must be an array.`);
  const covered: (Record<PropertyKey, unknown> | null)[] = Array.from(
    { length: body.dataStream.length },
    () => null,
  );
  const zeroLength: { at: number; attributes: Record<PropertyKey, unknown> }[] = [];
  let previousEnd = 0;
  for (const run of runs) {
    const { st, ed } = run;
    assert.ok(
      Number.isSafeInteger(st) &&
        Number.isSafeInteger(ed) &&
        st >= previousEnd &&
        ed >= st &&
        ed <= covered.length,
      `${context}: textRuns must be ordered, bounded and nonoverlapping.`,
    );
    const attributes = Object.fromEntries(
      Reflect.ownKeys(run)
        .filter((key) => key !== 'st' && key !== 'ed')
        .map((key) => [key, Reflect.get(run, key)]),
    );
    if (st === ed) zeroLength.push({ at: st, attributes });
    else for (let offset = st; offset < ed; offset++) covered[offset] = attributes;
    previousEnd = ed;
  }
  return { otherFields, ownsTextRuns, runs: { covered, zeroLength } };
}

function assertNativePreservation(
  control: ReturnType<typeof flush>,
  candidate: ReturnType<typeof flush>,
  scenario: ReturnType<typeof sequence>,
  context: string,
  historyStart = 0,
) {
  const label = `${context}, historyStart=${historyStart}`;
  assert.deepEqual(
    candidate,
    control,
    `${label}: complete native publications, including own undefined fields.`,
  );
  const originalSnapshots = appliedSnapshots(control, scenario, historyStart);
  const candidateSnapshots = appliedSnapshots(candidate, scenario, historyStart);
  assert.deepEqual(
    candidateSnapshots,
    originalSnapshots,
    `${label}: all complete applied snapshots.`,
  );
  for (const side of ['history', 'collaboration'] as const) {
    const snapshots = originalSnapshots[side];
    if (!snapshots) continue;
    assert.deepEqual(
      snapshots.redo,
      scenario.snapshots.at(-1),
      `${label}, ${side}/redo: sequential forward oracle.`,
    );
    const reverse = scenario.undoSnapshots[side === 'history' ? historyStart : 0];
    assert.deepEqual(
      sequentialStyleView(snapshots.undo, `${label}, ${side}/undo native`),
      sequentialStyleView(reverse, `${label}, ${side}/undo sequential`),
      `${label}, ${side}/undo: independent sequential authored styles and every other field.`,
    );
  }
}

/** Doubling the states: linear work at most doubles, quadratic work roughly quadruples. */
const LINEAR_DOUBLING_MAX = 2;
const QUADRATIC_DOUBLING_MIN = 3;
type TailCounts = Record<'allocations' | 'cloneVisits', number>;
type TailWork = { length: number; native: TailCounts; before: TailCounts; after: TailCounts };
function assertTailWorkScaling(work: TailWork[], label: string) {
  for (const key of ['allocations', 'cloneVisits'] as const) {
    for (let i = 0; i < work.length; i++) {
      const row = work[i]!;
      assert.ok(
        row.after[key] < row.before[key],
        `${label} ${key} at ${row.length}: patched < previous`,
      );
      assert.ok(row.before[key] < row.native[key], `${key} at ${row.length}: previous < native`);
      if (i === 0) continue;
      const last = work[i - 1]!;
      assert.ok(
        row.after[key] <= LINEAR_DOUBLING_MAX * last.after[key],
        `${label} ${key} ${last.length}->${row.length}: patched work must be linear`,
      );
      assert.ok(
        row.native[key] > QUADRATIC_DOUBLING_MIN * last.native[key],
        `${key} ${last.length}->${row.length}: native work must be quadratic`,
      );
      assert.ok(
        row.before[key] > LINEAR_DOUBLING_MAX * last.before[key],
        `${key} ${last.length}->${row.length}: previous work is superlinear`,
      );
    }
  }
}

function measuredFlush(source: string, states: State[], collaboration = states, raw = false) {
  const counts = { textCompose: 0, iteratorNext: 0, bodySlices: 0, cloneVisits: 0, allocations: 0 };
  const compose = core.TextX.compose;
  const next = core.ActionIterator.prototype.next;
  const clone = core.Tools.deepClone;
  core.TextX.compose = function (this: typeof core.TextX, ...args: Parameters<typeof compose>) {
    counts.textCompose++;
    return Reflect.apply(compose, this, args);
  };
  core.ActionIterator.prototype.next = function (
    this: core.ActionIterator,
    ...args: Parameters<typeof next>
  ) {
    counts.iteratorNext++;
    const action = Reflect.apply(next, this, args) as ReturnType<typeof next>;
    if (
      action.t === core.TextXActionType.INSERT ||
      (action.t === core.TextXActionType.RETAIN && action.body != null)
    )
      counts.bodySlices++;
    return action;
  };
  core.Tools.deepClone = function <T>(this: typeof core.Tools, value: T): T {
    counts.cloneVisits++;
    if (
      this.isDefine(value) &&
      (this.isRegExp(value) ||
        Reflect.apply(this.isDate, this, [value]) ||
        this.isArray(value) ||
        this.isObject(value))
    )
      counts.allocations++;
    return Reflect.apply(clone, this, [value]) as T;
  };
  try {
    return { output: flush(source, states, collaboration, raw), counts };
  } finally {
    core.TextX.compose = compose;
    core.ActionIterator.prototype.next = next;
    core.Tools.deepClone = clone;
  }
}

test('sequential style oracle preserves complete attributes and rejects ambiguous runs', () => {
  const original = seed('abc\r\n');
  original.body!.textRuns = [{ st: 0, ed: 3, sId: 'authored', ts: { bl: 0 } }];
  const split = structuredClone(original);
  split.body!.textRuns = [
    { st: 0, ed: 1, sId: 'authored', ts: { bl: 0 } },
    { st: 1, ed: 3, sId: 'authored', ts: { bl: 0 } },
  ];
  assert.deepEqual(sequentialStyleView(split, 'split'), sequentialStyleView(original, 'whole'));
  for (const mutation of [
    (body: core.IDocumentBody) => {
      body.textRuns![0].sId = 'different';
    },
    (body: core.IDocumentBody) => {
      body.textRuns![0].ts = { bl: 1 };
    },
    (body: core.IDocumentBody) => {
      Object.assign(body.textRuns![0], { future: undefined });
    },
    (body: core.IDocumentBody) => {
      body.textRuns!.push({ st: 3, ed: 3, ts: {} });
    },
    (body: core.IDocumentBody) => {
      body.customBlocks = [];
    },
  ]) {
    const changed = structuredClone(original);
    mutation(changed.body!);
    assert.notDeepEqual(
      sequentialStyleView(changed, 'changed'),
      sequentialStyleView(original, 'whole'),
    );
  }
  const absent = seed('\r\n');
  delete absent.body!.textRuns;
  const present = structuredClone(absent);
  present.body!.textRuns = undefined;
  assert.notDeepEqual(
    sequentialStyleView(absent, 'missing'),
    sequentialStyleView(present, 'own undefined'),
  );
  present.body!.textRuns = [];
  const emptyRun = structuredClone(present);
  emptyRun.body!.textRuns = [{ st: 0, ed: 1 }];
  assert.notDeepEqual(
    sequentialStyleView(present, 'uncovered'),
    sequentialStyleView(emptyRun, 'covered without attributes'),
  );
  for (const runs of [
    [{ st: -1, ed: 1 }],
    [{ st: 1, ed: 0 }],
    [{ st: 0, ed: 6 }],
    [{ st: 0.5, ed: 1 }],
    [
      { st: 0, ed: 2 },
      { st: 1, ed: 3 },
    ],
    [
      { st: 2, ed: 3 },
      { st: 0, ed: 1 },
    ],
  ]) {
    const invalid = structuredClone(original);
    invalid.body!.textRuns = runs;
    assert.throws(
      () => sequentialStyleView(invalid, 'invalid'),
      /ordered, bounded and nonoverlapping/,
    );
  }
});

for (const format of ['es', 'cjs'] as const) {
  test(`${format}: complete module binds native helpers for qualified paragraph flushes`, async () => {
    if (format === 'cjs' && process.env.SPINEL_DOCS_MODULE_CHILD !== '1') {
      // CJS Core registers its TextX type in JSONX's shared registry. Keep that
      // real registration isolated from the ES primitive-work instrumentation.
      execFileSync(
        process.execPath,
        [
          '--test',
          '--test-name-pattern=^cjs: complete module binds',
          'scripts/dependencies/patch-univer-docs.test.ts',
        ],
        { env: { ...process.env, SPINEL_DOCS_MODULE_CHILD: '1' }, timeout: 10_000 },
      );
      return;
    }
    const { patched } = prepareDocsPatch(await readBuild(format), format);
    const directory = await mkdtemp(resolve('.spinel-docs-module-'));
    async function load(source: string, name: string) {
      if (format === 'es') {
        const path = resolve(directory, `${name}.ts`);
        await writeFile(path, source);
        return import(pathToFileURL(path).href);
      }
      const module = { exports: {} };
      Function(
        'require',
        'module',
        'exports',
        source,
      )(createRequire(import.meta.url), module, module.exports);
      return module.exports as Record<string, any>;
    }
    function exercise(ManagerClass: any, states: State[]) {
      const input = new Subject<IDocStateChangeInfo>();
      const history: Entry[] = [],
        changes: State[] = [];
      const manager = new ManagerClass(
        { pushUndoRedo: (entry: Entry) => history.push(structuredClone(entry)) },
        { beforeCommandExecuted: () => ({ dispose() {} }) },
        { getCurrentUnitOfType: () => ({ getUnitId: () => unitId }) },
        { docStateChangeParams$: input },
      );
      const subscription = manager.docStateChange$.subscribe((state: State | null) => {
        if (state) changes.push(structuredClone(state));
      });
      try {
        manager.setStateCache(
          unitId,
          structuredClone({ history: [...states], collaboration: [...states] }),
        );
        manager.flushPendingChanges(unitId);
        assert.deepEqual(manager.getStateCache(unitId), { history: [], collaboration: [] });
        return { history, changes };
      } finally {
        subscription.unsubscribe();
        manager.dispose();
        input.complete();
      }
    }
    try {
      const module = await load(patched, 'complete');
      for (const position of [3, 4, 23]) {
        const { states } = paragraphSequence(position);
        const expected = flush(patched, states);
        assert.deepEqual(exercise(module.DocStateChangeManagerService, states), {
          history: expected.history,
          changes: expected.changes,
        });
      }
      if (format === 'es') {
        // The isolated manager fixture supplies Core bindings and hid this exact
        // integration defect in rejected candidate418f8b6f. Execute the full file.
        const missing = patched.replace(
          'import { ActionIterator, AlignTypeH,',
          'import { AlignTypeH,',
        );
        assert.notEqual(missing, patched);
        assert.throws(() => prepareDocsPatch(missing, format), /Partially modified/);
        const broken = await load(missing, 'missing-iterator');
        assert.throws(
          () => exercise(broken.DocStateChangeManagerService, paragraphSequence(4).states),
          /ActionIterator is not defined/,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test(`${format}: native publications preserve mixed operations, independent caches and complete metadata`, async () => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    assert.deepEqual(flush(patched, []), flush(original, []));
    const cases: { name: string; requests: Request[] }[] = [
      { name: 'singleton noop', requests: [() => null] },
      { name: 'singleton insert', requests: mixed.slice(0, 1) },
      { name: 'noop insert noop', requests: [() => null, mixed[0], () => null] },
      { name: 'mixed five', requests: mixed.slice(0, 5) },
      { name: 'mixed eleven', requests: mixed },
    ];
    for (const { name, requests } of cases) {
      const scenario = sequence(requests);
      const { states } = scenario;
      for (const historyStart of states.length > 5 ? [0, 4] : [0]) {
        const control = flush(original, states.slice(historyStart), states);
        const candidate = flush(patched, states.slice(historyStart), states);
        assertNativePreservation(control, candidate, scenario, `${format}: ${name}`, historyStart);
      }
    }
    const scenario = sequence(mixed.slice(0, 5));
    const { states } = scenario;
    const separateCaches: [State[], State[]][] = [
      [[], states],
      [states, []],
    ];
    for (const caches of separateCaches)
      assertNativePreservation(
        flush(original, ...caches),
        flush(patched, ...caches),
        scenario,
        `${format}: mixed five, ${caches[0].length ? 'history' : 'collaboration'} only`,
      );
  });

  test(`${format}: real composition work falls for both typed inserts and deletes whose undo inserts`, async () => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    for (const name of [
      'typing',
      'plain delete/undo-insert',
      'annotated delete with supported Undo prefix',
    ]) {
      const deleting = name !== 'typing';
      const initial = seed(deleting ? `${'x'.repeat(32)}\r\n` : '\r\n');
      // The annotated deletion retains a native tail after its qualified Undo
      // prefix; the plain document qualifies throughout the inverse fold.
      if (name === 'plain delete/undo-insert') initial.body!.customRanges = [];
      const requests = Array.from(
        { length: 32 },
        (): Request => (snapshot) =>
          edit(
            deleting
              ? new core.TextX().delete(1)
              : new core.TextX().retain(snapshot.body!.dataStream.length - 2).insert(1, {
                  dataStream: 'x',
                  textRuns: [{ st: 0, ed: 1, ts: { cl: { rgb: '#123456' } } }],
                }),
          ),
      );
      const scenario = sequence(requests, initial);
      const { states } = scenario;
      const control = measuredFlush(original, states);
      const candidate = measuredFlush(patched, states);
      assertNativePreservation(control.output, candidate.output, scenario, `${format}: ${name}`);
      assert.equal(
        control.counts.textCompose,
        124,
        'The native subtype counter must observe all four nontrivial folds.',
      );
      assert.ok(candidate.counts.textCompose <= control.counts.textCompose);
      for (const key of ['iteratorNext', 'bodySlices', 'cloneVisits', 'allocations'] as const)
        assert.ok(
          candidate.counts[key] < control.counts[key],
          `${name}: actual ${key} must fall, independently of wall-clock noise.`,
        );
    }
  });

  test(`${format}: Enter-tail work grows quadratically in the original, superlinearly before this patch and linearly after`, async () => {
    // SPN-146 demonstrates the diagnosed cost at the lowest layer: the native Undo fold's work
    // against the number of states in one flush, with one Enter in the middle (so the fold has a
    // forward tail to assemble). Counts are deterministic operation counts, not timings, so the
    // contract holds on any runner. `previous` is the build installed before this PR (the build
    // the hosted A/B labels `previous`).
    const {
      original,
      qualifiedRangesPatched: previous,
      patched,
    } = prepareDocsPatch(await readBuild(format), format);
    const work = [16, 32, 64, 128, 256].map((length) => {
      const scenario = paragraphSequence(length >> 1, length);
      const native = measuredFlush(original, scenario.states);
      const before = measuredFlush(previous, scenario.states);
      const after = measuredFlush(patched, scenario.states);
      assertNativePreservation(native.output, after.output, scenario, `length ${length}`);
      assertNativePreservation(native.output, before.output, scenario, `length ${length}`);
      return { length, native: native.counts, before: before.counts, after: after.counts };
    });
    assertTailWorkScaling(work, 'after');
    // Negative controls: each assertion branch must reject a build that lacks the property, so the
    // test is known to fail without this patch's linear tail assembly.
    const times = (counts: TailCounts, by: number): TailCounts => ({
      allocations: counts.allocations * by,
      cloneVisits: counts.cloneVisits * by,
    });
    // The previous build in the patched slot (slightly cheaper than itself): not linear.
    assert.throws(
      () =>
        assertTailWorkScaling(
          work.map((row) => ({ ...row, after: times(row.before, 0.9) })),
          'previous',
        ),
      /patched work must be linear/,
    );
    // A native build whose growth is only the previous build's: not quadratic.
    assert.throws(
      () =>
        assertTailWorkScaling(
          work.map((row) => ({ ...row, native: times(row.before, 1.1) })),
          'native',
        ),
      /native work must be quadratic/,
    );
    // A previous build that is just a constant multiple of the patched one: not superlinear.
    assert.throws(
      () =>
        assertTailWorkScaling(
          work.map((row) => ({ ...row, before: times(row.after, 1.1) })),
          'constant',
        ),
      /previous work is superlinear/,
    );
    console.log(
      `${format}: tail work by states ${JSON.stringify(work.map((r) => [r.length, r.native.allocations, r.before.allocations, r.after.allocations]))} (native, previous, patched allocations)`,
    );
  });

  // Wall-clock distribution of one real native flush through each build (SPN-146 supporting
  // measurement; timing is never asserted, so it is off unless SPN146_BENCH=1 and cannot flake).
  //   SPN146_BENCH=1 [SPN146_BENCH_STATES=128] [SPN146_BENCH_REPS=100] node --test --test-name-pattern="wall-clock flush" scripts/dependencies/patch-univer-docs.test.ts
  test(
    `${format}: wall-clock flush per build (SPN146_BENCH_STATES, default 32)`,
    { skip: process.env.SPN146_BENCH !== '1' },
    async () => {
      const builds = prepareDocsPatch(await readBuild(format), format);
      const variants = [
        ['original', builds.original],
        ['previous', builds.qualifiedRangesPatched],
        ['patched', builds.patched],
      ] as const;
      const fixtures = variants.map(([, source]) => managerFixture(source));
      try {
        for (const position of [4, 16, 28]) {
          const count = Number(process.env.SPN146_BENCH_STATES ?? 32);
          const { states } = paragraphSequence(Math.min(position, count - 1), count);
          const samples = variants.map((): number[] => []);
          const reps = Number(process.env.SPN146_BENCH_REPS ?? 300);
          for (let rep = 0; rep < reps + 20; rep++)
            // Rotate which build goes first so none always runs on a warm or cold heap.
            for (let k = 0; k < variants.length; k++) {
              const v = (k + rep) % variants.length;
              const fixture = fixtures[v]!;
              fixture.manager.setStateCache(unitId, {
                history: structuredClone(states),
                collaboration: structuredClone(states),
              });
              const started = performance.now();
              fixture.manager.flushPendingChanges(unitId);
              const took = performance.now() - started;
              if (rep >= 20) samples[v]!.push(took);
            }
          const q = (values: number[], at: number) =>
            [...values].sort((a, b) => a - b)[
              Math.min(values.length - 1, Math.floor(at * values.length))
            ]!;
          for (let v = 0; v < variants.length; v++)
            console.log(
              `BENCH ${format} enter@${position} ${variants[v]![0]} p50=${q(samples[v]!, 0.5).toFixed(3)} p95=${q(samples[v]!, 0.95).toFixed(3)} p99=${q(samples[v]!, 0.99).toFixed(3)} max=${Math.max(...samples[v]!).toFixed(3)} ms`,
            );
        }
      } finally {
        for (const fixture of fixtures) fixture.close();
      }
    },
  );

  test(`${format}: opt-in native observations preserve outputs and include synchronous publication`, async () => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    const scenario = sequence([insertAt(0), insertAt(1)], seed('\r\n'));
    const fixture = managerFixture(patched, { history: 10, collaboration: 12 });
    const manager = fixture.manager as Manager & NativeDocFlushManager;
    const observations: NativeDocFlushObservation[] = [];
    const observer = manager.observeFlushes(unitId, (value) => observations.push(value));
    const other: NativeDocFlushObservation[] = [];
    const otherObserver = manager.observeFlushes('other-doc', (value) => other.push(value));
    try {
      for (const state of scenario.states) fixture.input.next(state);
      fixture.timers.tick(300);
      assert.deepEqual(
        observations.map((value) => [
          value.phase,
          value.origin,
          value.startedAt,
          value.endedAt,
          value.outcome,
        ]),
        [
          ['history', 'history-timer', 300, 310, 'returned'],
          ['collaboration', 'collaboration-timer', 310, 322, 'returned'],
        ],
      );
      assert.equal(other.length, 0);
      assert.deepEqual(
        { history: fixture.history, changes: fixture.changes, publication: fixture.publication },
        flush(original, scenario.states),
      );
      assert.deepEqual(structuredClone(observer.readStatus()), { active: true, observerErrors: 0 });
      manager.flushPendingChanges(unitId, 'idle');
      assert.deepEqual(
        observations
          .slice(2)
          .map((value) => [value.phase, value.origin, structuredClone(value.before)]),
        [
          ['history', 'policy-idle', { history: 0, collaboration: 0 }],
          ['collaboration', 'policy-idle', { history: 0, collaboration: 0 }],
          ['pair', 'policy-idle', { history: 0, collaboration: 0 }],
        ],
      );
      const broken = manager.observeFlushes(unitId, () => {
        throw new Error('observer failed');
      });
      assert.doesNotThrow(() => manager.flushPendingChanges(unitId));
      assert.equal(broken.readStatus().observerErrors, 3);
      broken.dispose();
      observer.dispose();
      const count = observations.length;
      manager.flushPendingChanges(unitId);
      assert.equal(observations.length, count);
    } finally {
      fixture.close();
    }
    assert.equal(otherObserver.readStatus().active, false);
  });

  test(`${format}: observed native exceptions preserve identity and uncleared cache`, async () => {
    const { patched } = prepareDocsPatch(await readBuild(format), format);
    const error = new Error('native publication failed');
    const fixture = managerFixture(patched, { history: 7, historyError: error });
    const manager = fixture.manager as Manager & NativeDocFlushManager;
    const observations: NativeDocFlushObservation[] = [];
    manager.observeFlushes(unitId, (value) => observations.push(value));
    try {
      const { states } = sequence([insertAt(0)], seed('\r\n'));
      manager.setStateCache(unitId, { history: [...states], collaboration: [...states] });
      assert.throws(
        () => manager.flushPendingChanges(unitId),
        (value) => value === error,
      );
      assert.deepEqual(
        observations.map((value) => [
          value.phase,
          value.origin,
          value.outcome,
          value.endedAt - value.startedAt,
        ]),
        [
          ['history', 'public-flush', 'threw', 7],
          ['pair', 'public-flush', 'threw', 7],
        ],
      );
      assert.equal(manager.getStateCache(unitId).history.length, 1);
      assert.equal(manager.getStateCache(unitId).collaboration.length, 1);
    } finally {
      fixture.close();
    }
  });

  test(`${format}: retained six-state native caches preserve raw publications with less Undo work`, async () => {
    const { original, patched, prefixPatched } = prepareDocsPatch(await readBuild(format), format);
    const archive = JSON.parse(
      gunzipSync(
        await readFile(
          new URL(
            '../../docs/implementation/evidence/SPN-135/corrected-3g/plain-2/spn135-native-caches.json.gz',
            import.meta.url,
          ),
        ),
      ).toString(),
    );
    const phases = archive.native.filter((entry: any) => entry.count === 6 && entry.cache);
    assert.equal(phases.length, 2);
    const history = decodeCapture(
      phases.find((entry: any) => entry.phase === 'history').cache,
    ) as State[];
    const collaboration = decodeCapture(
      phases.find((entry: any) => entry.phase === 'collaboration').cache,
    ) as State[];
    const control = measuredFlush(original, history, collaboration);
    const previous = measuredFlush(prefixPatched, history, collaboration);
    const candidate = measuredFlush(patched, history, collaboration);
    assert.deepEqual(candidate.output, control.output);
    assert.deepEqual(candidate.output, previous.output);
    const reduced = (counts: typeof candidate.counts) => {
      assert.equal(counts.textCompose, 10);
      assert.ok(counts.iteratorNext < previous.counts.iteratorNext);
      assert.ok(counts.cloneVisits < previous.counts.cloneVisits);
      assert.ok(counts.allocations < previous.counts.allocations);
    };
    reduced(candidate.counts);
    assert.throws(() => reduced(previous.counts));
    console.log(
      `${format}: retained tail work ${JSON.stringify({ original: control.counts, previous: previous.counts, candidate: candidate.counts })}`,
    );
    // The last (lowest-offset) deleted body survives native merging. Distinct
    // characters/styles plus own undefined fields must remain byte-shape exact.
    const undo = (candidate.output.history[0].undoMutations[0].params.actions as any)[1].e.at(-1);
    assert.equal(undo.len, 6);
    assert.equal(undo.body.dataStream, 'a');
    const mutations = [
      (edits: any[]) => {
        edits[0].len += 2;
      },
      (edits: any[]) => {
        edits.at(-1).valueRangeId = 'range';
      },
      (edits: any[]) => {
        edits.at(-1).unknown = undefined;
      },
      (edits: any[]) => {
        edits.at(-1).len = 2;
      },
      (edits: any[]) => {
        edits.at(-1).body.dataStream = '\r';
      },
      (edits: any[]) => {
        edits.at(-1).body.customRanges = [{ rangeId: 'range' }];
      },
      (edits: any[]) => {
        edits.at(-1).body.__textXPreserveParagraphIds = false;
      },
      (edits: any[]) => {
        Object.setPrototypeOf(edits.at(-1), { extra: true });
      },
      (edits: any[]) => {
        Object.defineProperty(edits.at(-1), 'body', {
          get: () => keyboardBody(),
          enumerable: true,
          configurable: true,
        });
      },
      (edits: any[]) => {
        Object.defineProperty(edits.at(-1), 'valueRangeId', {
          value: undefined,
          enumerable: false,
        });
      },
    ];
    mutations.push((edits: any[]) => {
      edits.at(-1)[Symbol.for('spn142-unsupported')] = undefined;
    });
    for (const change of mutations)
      for (let index = 0; index < history.length; index++) {
        const makeStates = () => {
          const states = structuredClone(history);
          change((states[index].undoState.actions as any)[1].e);
          return states;
        };
        const candidateStates = makeStates();
        const previousStates = makeStates();
        const candidate = measuredFlush(patched, candidateStates, candidateStates, true);
        const previous = measuredFlush(prefixPatched, previousStates, previousStates, true);
        assert.deepEqual(
          candidate.output,
          previous.output,
          `Unsupported raw delete shape ${mutations.indexOf(change)} member ${index} keeps raw publication.`,
        );
        // Undo folds in reverse order: only the leading plain members qualify.
        if (history.length - 1 - index < 2) assert.deepEqual(candidate.counts, previous.counts);
        else assert.ok(candidate.counts.allocations < previous.counts.allocations);
      }
  });

  test(`${format}: qualification reuses fixed lists across actual manager flushes`, async () => {
    const { patched, deletePrefixPatched } = prepareDocsPatch(await readBuild(format), format);
    const archive = JSON.parse(
      gunzipSync(
        await readFile(
          new URL(
            '../../docs/implementation/evidence/SPN-135/corrected-3g/plain-2/spn135-native-caches.json.gz',
            import.meta.url,
          ),
        ),
      ).toString(),
    );
    const phases = archive.native.filter((entry: any) => entry.count === 6 && entry.cache);
    const history = decodeCapture(
      phases.find((entry: any) => entry.phase === 'history').cache,
    ) as State[];
    const collaboration = decodeCapture(
      phases.find((entry: any) => entry.phase === 'collaboration').cache,
    ) as State[];
    const outputs = [];
    const work: { initialization: number; flushes: number[] }[] = [];
    for (const source of [deletePrefixPatched, patched]) {
      const start = source.indexOf('const DEBOUNCE_DELAY = 300;');
      const end = source.indexOf('const IDocStateChangeInterceptorService =', start);
      assert.ok(start > 0 && end > start);
      const helper = source.slice(start, end);
      // Count executed string-list expressions, not native allocations or time.
      const instrumented = helper.replace(
        /\[(?:"[^"]*"(?:,\s*)?)+\]/g,
        (literal) => `__spn142List(${literal})`,
      );
      assert.notEqual(instrumented, helper);
      let evaluations = 0;
      const fixture = managerFixture(source.replace(helper, instrumented), {
        listEvaluation: () => {
          evaluations++;
        },
      });
      const initialization = evaluations;
      try {
        const flushes = [];
        for (let flushIndex = 0; flushIndex < 2; flushIndex++) {
          evaluations = 0;
          fixture.manager.setStateCache(unitId, structuredClone({ history, collaboration }));
          fixture.manager.flushPendingChanges(unitId);
          flushes.push(evaluations);
        }
        outputs.push(
          structuredClone({
            history: fixture.history,
            changes: fixture.changes,
            publication: fixture.publication,
          }),
        );
        work.push({ initialization, flushes });
      } finally {
        fixture.close();
      }
    }
    assert.deepEqual(outputs[1], outputs[0]);
    assert.equal(work[0].initialization, 0);
    // Three additional Enter-shape lists are initialized once with the nine
    // existing lists; the regression contract is still zero per-flush lists.
    assert.equal(work[1].initialization, 12);
    const noRepeatedLists = (counts: (typeof work)[number]) =>
      assert.deepEqual(counts.flushes, [0, 0]);
    noRepeatedLists(work[1]);
    assert.throws(
      () => noRepeatedLists(work[0]),
      'Exact pre-hoist build fails the repeated-work contract.',
    );
    assert.deepEqual(work[0].flushes, [274, 274]);
    // Uninstrumented execution remains the semantic oracle, and no native work changes.
    assert.deepEqual(
      measuredFlush(patched, history, collaboration),
      measuredFlush(deletePrefixPatched, history, collaboration),
    );
  });

  test(`${format}: retained capacity caches preserve publications and reduce structural Undo prefix work`, async () => {
    const { patched, completeDeletePatched } = prepareDocsPatch(await readBuild(format), format);
    const raw = gunzipSync(
      await readFile(
        new URL(
          '../../docs/implementation/evidence/SPN-142/native-caches.json.gz',
          import.meta.url,
        ),
      ),
    );
    assert.equal(
      createHash('sha256').update(raw).digest('hex'),
      '714376723b3ef6a048796f7a1903a58181098960960cecb111e22e0594a2e7c8',
    );
    const archive = JSON.parse(raw.toString());
    assert.equal(archive.captures.length, 8);
    let improved = 0;
    for (const capture of archive.captures) {
      const { history, collaboration } = decodeCapture(capture) as {
        history: State[];
        collaboration: State[];
      };
      assert.equal(history.length, 32);
      assert.equal(collaboration.length, 32);
      const before = measuredFlush(completeDeletePatched, history, collaboration);
      const after = measuredFlush(patched, history, collaboration);
      assert.deepEqual(after.output, before.output);
      assert.ok(after.counts.allocations <= before.counts.allocations);
      if (after.counts.allocations < before.counts.allocations) improved++;
    }
    assert.equal(
      improved,
      1,
      'Only the captured paragraph-containing group gains a delete prefix.',
    );
  });

  test(`${format}: delete prefixes own their accumulator and preserve every tail call`, async () => {
    const { patched, completeDeletePatched } = prepareDocsPatch(await readBuild(format), format);
    const start = patched.indexOf('const DEBOUNCE_DELAY = 300;');
    const end = patched.indexOf('const IDocStateChangeInterceptorService =', start);
    assert.ok(start > 0 && end > start);
    const calls: { left: JSONXActions; right: JSONXActions }[] = [];
    const json = {
      compose(left: JSONXActions, right: JSONXActions) {
        calls.push({ left: structuredClone(left), right });
        return core.JSONX.compose(left, right);
      },
    };
    const compose = runInNewContext(patched.slice(start, end) + ';composeDocStateActions;', {
      ...core,
      JSONX: json,
      _univerjs_core: { ...core, JSONX: json },
      Object,
      Array,
    }) as (states: State[], key: 'undoState') => JSONXActions;
    for (const prefix of [0, 1, 2, 3, 5, 7]) {
      const scenario = sequence(
        Array.from({ length: 7 }, (_, i) => insertAt(i, keyboardBody(i))),
        seed('z\r\n'),
      );
      const states = [...scenario.states].reverse();
      if (prefix < states.length) {
        // Own unknown fields forbid admission even when native composition ignores them.
        (states[prefix].undoState.actions as any)[1].e.at(-1).unsupported = undefined;
      }
      const before = structuredClone(states);
      const expected = states.reduce(
        (a, s) => core.JSONX.compose(a, s.undoState.actions),
        null as JSONXActions,
      );
      calls.length = 0;
      const actual = compose(states, 'undoState');
      assert.deepEqual(actual, expected);
      assert.deepEqual(states, before);
      const firstTail = prefix >= 2 ? prefix : 0;
      assert.equal(
        calls.length,
        states.length - firstTail,
        'Do not optimize later eligible islands.',
      );
      for (let i = 0; i < calls.length; i++)
        assert.equal(calls[i].right, states[firstTail + i].undoState.actions);
      if (prefix >= 2 && calls.length)
        assert.deepEqual(
          calls[0].left,
          states
            .slice(0, prefix)
            .reduce((a, s) => core.JSONX.compose(a, s.undoState.actions), null as JSONXActions),
        );
      // Mutating the actual result must not mutate even the lowest-offset input body.
      (actual as any)[1].e.at(-1).body.dataStream = 'changed result';
      assert.deepEqual(states, before);
      const control = flush(completeDeletePatched, scenario.states);
      assert.deepEqual(flush(patched, scenario.states), control);
    }
  });

  test(`${format}: eligible keyboard shapes preserve odd tails, offsets and independent cache folds`, async () => {
    const { original, patched, prefixPatched } = prepareDocsPatch(await readBuild(format), format);
    const cases = [
      { name: 'odd five', length: 5, start: 0 },
      { name: 'six-state tail', length: 6, start: 0 },
      { name: 'nonzero append', length: 7, start: 2 },
      { name: 'constant offset', length: 7, start: 2, constant: true },
      { name: 'divergent cache', length: 9, start: 2, historyStart: 3 },
      { name: 'eligible history with mixed collaboration', length: 9, start: 2, historyStart: 3 },
      { name: 'known empty and undefined fields', length: 7, start: 0 },
      { name: 'dataStream only', length: 7, start: 0 },
    ];
    for (const { name, length, start, constant, historyStart = 0 } of cases) {
      const requests = Array.from({ length }, (_, index) => {
        const body: core.IDocumentBody =
          name === 'dataStream only'
            ? { dataStream: 'x' }
            : name === 'eligible history with mixed collaboration' && index === 0
              ? { dataStream: 'XY' }
              : keyboardBody(index);
        if (name === 'known empty and undefined fields') {
          Object.assign(body, {
            paragraphs: index % 2 ? undefined : [],
            customBlocks: [],
            sectionBreaks: undefined,
          });
          Object.assign(body.textRuns![0], { sId: undefined });
        }
        return insertAt(start + (constant ? 0 : index), body);
      });
      const scenario = sequence(requests, seed('ab\r\n'));
      const history = scenario.states.slice(historyStart);
      const control = measuredFlush(original, history, scenario.states);
      const candidate = measuredFlush(patched, history, scenario.states);
      assertNativePreservation(
        control.output,
        candidate.output,
        scenario,
        `${format}: ${name}`,
        historyStart,
      );
      if (name === 'six-state tail') {
        const previous = measuredFlush(prefixPatched, history, scenario.states);
        assert.deepEqual(candidate.output, previous.output);
        assert.equal(candidate.counts.textCompose, 10);
        assert.equal(previous.counts.textCompose, 20);
        assert.ok(candidate.counts.cloneVisits < previous.counts.cloneVisits);
        assert.ok(candidate.counts.allocations < previous.counts.allocations);
      }
      assert.ok(candidate.counts.textCompose <= control.counts.textCompose);
      assert.ok(control.counts.textCompose > 0);
      assert.ok(
        candidate.counts.allocations < control.counts.allocations,
        `${name}: balanced insert work must actually execute.`,
      );
    }
  });

  test(`${format}: unsupported tails preserve native output and short prefixes retain the original work`, async (t) => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    const decorateInsert =
      (change: (action: core.IInsertAction) => void): Request =>
      () => {
        const text = new core.TextX().retain(2).insert(1, keyboardBody());
        change(text.serialize().at(-1)! as core.IInsertAction);
        return edit(text);
      };
    const decorateBody = (fields: Partial<core.IDocumentBody>): Request =>
      decorateInsert((action) => Object.assign(action.body, fields));
    const cases: { name: string; request: Request }[] = [
      { name: 'incompatible offset', request: insertAt(3) },
      { name: 'length two', request: insertAt(2, { dataStream: 'XY' }) },
      { name: 'null in typed group', request: () => null },
      {
        name: 'replacement',
        request: () => edit(new core.TextX().retain(2).delete(1).insert(1, keyboardBody())),
      },
      {
        name: 'attribute retain',
        request: () =>
          edit(
            new core.TextX()
              .retain(
                2,
                {
                  dataStream: '',
                  textRuns: [{ st: 0, ed: 2, ts: { bl: 0 } }],
                },
                core.UpdateDocsAttributeType.REPLACE,
              )
              .insert(1, keyboardBody()),
          ),
      },
      {
        name: 'JSON sibling edit',
        request: (snapshot) =>
          core.JSONX.compose(
            insertAt(2)(snapshot),
            core.JSONX.getInstance().replaceOp(['title'], snapshot.title, 'Sibling edit'),
          ),
      },
      {
        name: 'header path',
        request: () =>
          core.JSONX.getInstance().editOp(new core.TextX().insert(1, keyboardBody()).serialize(), [
            'headers',
            'top',
            'body',
          ]),
      },
      {
        name: 'defined valueRangeId',
        request: decorateInsert((action) => {
          action.valueRangeId = 'scalar';
        }),
      },
      {
        name: 'unknown insert metadata',
        request: decorateInsert((action) => {
          Object.assign(action, { future: undefined });
        }),
      },
      { name: 'unknown body metadata', request: decorateBody({ docxRawBlocks: undefined }) },
      {
        name: 'defined text style ID',
        request: decorateInsert((action) => {
          action.body.textRuns![0].sId = 'named';
        }),
      },
      {
        name: 'unknown run metadata',
        request: decorateInsert((action) => {
          Object.assign(action.body.textRuns![0], { future: undefined });
        }),
      },
      {
        name: 'paragraph insert',
        request: insertAt(2, {
          dataStream: '\r',
          paragraphs: [{ startIndex: 0, paragraphId: 'para_boundary' }],
        }),
      },
      { name: 'CR without supplied paragraphs', request: insertAt(2, { dataStream: '\r' }) },
      {
        name: 'section insert',
        request: insertAt(2, {
          dataStream: '\n',
          sectionBreaks: [{ startIndex: 0, sectionId: 'section_boundary' }],
        }),
      },
      { name: 'LF without supplied sections', request: insertAt(2, { dataStream: '\n' }) },
      {
        name: 'nonempty range',
        request: decorateBody({
          customRanges: [
            {
              startIndex: 0,
              endIndex: 0,
              rangeId: 'boundary-range',
              rangeType: core.CustomRangeType.HYPERLINK,
              properties: { url: 'https://example.test/boundary' },
            },
          ],
        }),
      },
      {
        name: 'nonempty decoration',
        request: decorateBody({
          customDecorations: [
            {
              startIndex: 0,
              endIndex: 0,
              id: 'boundary-comment',
              type: core.CustomDecorationType.COMMENT,
            },
          ],
        }),
      },
      {
        name: 'custom block',
        request: insertAt(2, {
          dataStream: core.DataStreamTreeTokenType.CUSTOM_BLOCK,
          customBlocks: [{ startIndex: 0, blockId: 'boundary-block' }],
        }),
      },
    ];
    for (const field of ['body', 'oldBody', 'coverType', 'rangeUpdates'])
      cases.push({
        name: `prefix retain own undefined ${field}`,
        request: () => {
          const text = new core.TextX().retain(2).insert(1, keyboardBody());
          Object.assign(text.serialize()[0], { [field]: undefined });
          return edit(text);
        },
      });
    // Keep the fixed matrix observable after any failure, and await each case
    // because the native primitive counters temporarily wrap shared methods.
    for (const { name, request } of cases)
      for (const prefixLength of [1, 5])
        await t.test(`${name}/prefix=${prefixLength}`, () => {
          const initial = seed('abcd\r\n');
          // Native deletion initializes this array, but composition cancels the
          // replacement's deletion of an earlier insertion. Start both replay
          // paths with the field present; never normalize their resulting snapshots.
          if (name === 'replacement') initial.body!.customBlocks = [];
          initial.headers = { top: { headerId: 'top', body: { dataStream: '\r\n' } } };
          const requests = Array.from({ length: 6 }, () => insertAt(2));
          requests[prefixLength] = request;
          const scenario = sequence(requests, initial);
          const control = measuredFlush(original, scenario.states);
          const candidate = measuredFlush(patched, scenario.states);
          assertNativePreservation(
            control.output,
            candidate.output,
            scenario,
            `${format}: ${name}`,
          );
          if (prefixLength === 1)
            assert.deepEqual(
              candidate.counts,
              control.counts,
              `${name}: a short prefix keeps the complete original fold.`,
            );
          else
            assert.ok(
              candidate.counts.allocations < control.counts.allocations,
              `${name}: the supported prefix reduces native allocation work.`,
            );
        });
  });

  test(`${format}: bare structural and other C0/DEL tokens keep native publication and work`, async (t) => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    for (const [name, token] of Object.entries(core.DataStreamTreeTokenType)) {
      if (token === '' || token === ' ') continue;
      assert.ok(
        token.length === 1 && token.charCodeAt(0) < 32,
        `${name}: the pinned structural enum is covered by C0.`,
      );
    }
    const template = sequence(
      Array.from({ length: 6 }, () => insertAt(2)),
      seed('abcd\r\n'),
    );
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      const label = `${format}: U+${code.toString(16).padStart(4, '0')}`;
      await t.test(label, () => {
        const states = structuredClone(template.states);
        const body = { ...keyboardBody(), dataStream: String.fromCharCode(code) };
        const actions = new core.TextX().retain(2).insert(1, body).serialize();
        states[1].redoState.actions = core.JSONX.getInstance().editOp(actions);
        states[1].undoState.actions = core.JSONX.getInstance().editOp(core.TextX.invert(actions));
        // Bare table/block delimiters need not form a valid document. This boundary
        // checks composition/publication only, without applying an unbalanced story.
        const control = measuredFlush(original, states);
        const candidate = measuredFlush(patched, states);
        assert.deepEqual(
          candidate.output,
          control.output,
          `${label}: complete native publication.`,
        );
        assert.deepEqual(candidate.counts, control.counts, `${label}: complete original folds.`);
      });
    }
  });

  test(`${format}: native idle, segment, remote and pre-Undo flush boundaries retain their ordering`, async () => {
    const builds = prepareDocsPatch(await readBuild(format), format);
    const { states } = sequence(mixed.slice(0, 5));
    const outputs = [];
    for (const source of [builds.original, builds.patched]) {
      const f = managerFixture(source);
      try {
        f.input.next(states[0]);
        f.timers.tick(299);
        assert.equal(f.history.length, 0);
        f.input.next(states[1]);
        f.timers.tick(299);
        assert.equal(f.history.length, 0);
        f.timers.tick(1);
        assert.equal(f.history.length, 1);
        assert.equal(f.changes.length, 1);
        f.input.next({ ...states[2], segmentId: 'header' });
        f.input.next({ ...states[3], segmentId: 'footer' });
        assert.equal(f.history.length, 2, 'Changing segments closes the previous native group.');
        f.input.next({ ...states[4], isSync: true });
        f.input.next({ ...states[4], noHistory: true });
        assert.equal(f.manager.getStateCache(unitId).history.length, 1);
        f.beforeCommand(core.UndoCommandId);
        assert.equal(f.history.length, 3);
        assert.equal(f.changes.length, 3);
        f.timers.tick(300);
        assert.equal(f.history.length, 3, 'Already-flushed idle callbacks publish nothing.');
        outputs.push(
          structuredClone({ history: f.history, changes: f.changes, publication: f.publication }),
        );
      } finally {
        f.close();
      }
    }
    assert.deepEqual(outputs[1], outputs[0]);
  });

  test(`${format}: every paragraph position preserves exact native output and reduces eligible prefix work`, async () => {
    const { original, patched, markerPatched, completeDeletePatched, constantGuardPatched } =
      prepareDocsPatch(await readBuild(format), format);
    for (let position = 0; position < 32; position++) {
      const scenario = paragraphSequence(position);
      const native = measuredFlush(original, scenario.states);
      const previous = measuredFlush(markerPatched, scenario.states);
      const candidate = measuredFlush(patched, scenario.states);
      const beforePrefix = measuredFlush(completeDeletePatched, scenario.states);
      const beforeTail = measuredFlush(constantGuardPatched, scenario.states);
      assertNativePreservation(
        native.output,
        candidate.output,
        scenario,
        `paragraph position ${position}`,
      );
      assert.deepEqual(
        previous,
        native,
        'The previous patch uses the complete original mixed fold.',
      );
      assert.deepEqual(candidate.output, beforePrefix.output);
      assert.deepEqual(candidate.output, beforeTail.output);
      if (position <= 23) {
        const reducedTail = (counts: typeof candidate.counts) =>
          assert.ok(
            counts.allocations < beforeTail.counts.allocations,
            'Enter tail work decreases.',
          );
        reducedTail(candidate.counts);
        assert.throws(() => reducedTail(beforeTail.counts), /Enter tail work/);
      }
      if (position < 30) {
        const reduced = (counts: typeof candidate.counts) =>
          assert.ok(
            counts.allocations < beforePrefix.counts.allocations,
            'Qualified inverse prefix must reduce actual native allocations.',
          );
        reduced(candidate.counts);
        assert.throws(() => reduced(beforePrefix.counts), /inverse prefix/);
      } else assert.deepEqual(candidate.counts, beforePrefix.counts);
      if (position >= 5) {
        const reduced = (counts: typeof candidate.counts) =>
          assert.ok(
            counts.allocations < previous.counts.allocations,
            'Qualified prefix must reduce actual native allocations.',
          );
        reduced(candidate.counts);
        assert.throws(
          () => reduced(previous.counts),
          /must reduce/,
          'The previous patch fails the work regression.',
        );
      }
      if (position === 5 || position === 19) {
        const historyStart = 7;
        assertNativePreservation(
          flush(original, scenario.states.slice(historyStart), scenario.states),
          flush(patched, scenario.states.slice(historyStart), scenario.states),
          scenario,
          'different prefix lengths in independent caches',
          historyStart,
        );
      }
    }
  });

  test(`${format}: seeded random Enter positions, tail lengths, offsets and covers match the previous build`, async () => {
    const { patched, qualifiedRangesPatched } = prepareDocsPatch(await readBuild(format), format);
    const helper = (source: string) => {
      const start = source.indexOf('const DEBOUNCE_DELAY = 300;');
      const end = source.indexOf('const IDocStateChangeInterceptorService =', start);
      return Function(
        'core',
        `const {${Object.keys(core).join(',')}}=core; const _univerjs_core=core;\n${source.slice(start, end)}\nreturn composeDocStateActions;`,
      )(core) as (states: State[], key: 'redoState' | 'undoState') => JSONXActions;
    };
    const current = helper(qualifiedRangesPatched),
      candidate = helper(patched);
    // mulberry32: a fixed seed keeps the cases reproducible; a failure names its parameters.
    let state = 0x146a5eed;
    const random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
    const covers = [core.UpdateDocsAttributeType.COVER, core.UpdateDocsAttributeType.REPLACE];
    let admitted = 0;
    for (let index = 0; index < 150; index++) {
      const length = between(2, 48),
        position = between(0, length - 1),
        offset = between(0, 20),
        cover = covers[between(0, 1)]!,
        equalStyle = random() < 0.5;
      const scenario = paragraphSequence(position, length, cover, offset, (body) => {
        if (equalStyle) body.textRuns![0].ts = { bl: 1, cl: { rgb: '#123456' } };
      });
      const label = `${format} case ${index}: length ${length}, Enter ${position}, offset ${offset}, cover ${cover}, equalStyle ${equalStyle}`;
      for (const key of ['redoState', 'undoState'] as const) {
        const before = current(scenario.states, key),
          after = candidate(scenario.states, key);
        assert.deepEqual(after, before, `${label}/${key}`);
        assert.deepEqual(
          ownDataShape({ input: scenario.states, output: after }),
          ownDataShape({ input: scenario.states, output: before }),
          `${label}/${key}: descriptors, prototypes and alias topology`,
        );
      }
      if (length - position > 5) admitted++;
    }
    assert.ok(admitted > 40, `the seeded cases exercise the admitted tail shape (${admitted})`);
  });

  test(`${format}: linear paragraph ranges preserve raw ownership and reduce repeated native copies`, async () => {
    const { patched, qualifiedRangesPatched, linearTailPatched } = prepareDocsPatch(
      await readBuild(format),
      format,
    );
    const helper = (source: string) => {
      const start = source.indexOf('const DEBOUNCE_DELAY = 300;');
      const end = source.indexOf('const IDocStateChangeInterceptorService =', start);
      // Same realm keeps prototype/descriptor comparisons about native semantics.
      // Only the complete hash-verified public manager region is evaluated.
      return Function(
        'core',
        `const {${Object.keys(core).join(',')}}=core; const _univerjs_core=core;\n${source.slice(start, end)}\nreturn composeDocStateActions;`,
      )(core) as (states: State[], key: 'redoState' | 'undoState') => JSONXActions;
    };
    const current = helper(qualifiedRangesPatched),
      candidate = helper(patched);
    for (const cover of [core.UpdateDocsAttributeType.COVER, core.UpdateDocsAttributeType.REPLACE])
      for (const offset of [0, 7])
        for (let position = 0; position < 32; position++) {
          const scenario = paragraphSequence(position, 32, cover, offset);
          const label = `${format}/${cover}/${offset}/${position}`;
          const originalShape = ownDataShape(scenario.states);
          for (const key of ['redoState', 'undoState'] as const) {
            const before = current(scenario.states, key),
              after = candidate(scenario.states, key);
            assert.deepEqual(after, before, `${label}/${key}: every native field`);
            assert.deepEqual(
              ownDataShape({ input: scenario.states, output: after }),
              ownDataShape({ input: scenario.states, output: before }),
              `${label}/${key}: descriptors, prototypes and alias topology`,
            );
          }
          assert.deepEqual(ownDataShape(scenario.states), originalShape);
          const before = measuredFlush(qualifiedRangesPatched, scenario.states);
          const tailOnly = measuredFlush(linearTailPatched, scenario.states);
          const after = measuredFlush(patched, scenario.states);
          assertNativePreservation(before.output, after.output, scenario, label);
          assert.deepEqual(after.output, tailOnly.output);
          if (position < 28) {
            assert.ok(
              after.counts.allocations < before.counts.allocations,
              'Admitted native copying falls',
            );
            if (position >= 4)
              for (const counter of [
                'textCompose',
                'iteratorNext',
                'bodySlices',
                'allocations',
              ] as const)
                assert.ok(
                  after.counts[counter] < tailOnly.counts[counter],
                  `${label}: isolated prefix ${counter}`,
                );
            else
              assert.deepEqual(
                after.counts,
                tailOnly.counts,
                'Tiny head keeps its original null fold',
              );
          } else assert.deepEqual(after.counts, before.counts, 'Short tail is not admitted');
        }
    for (const position of [3, 4, 23])
      for (const repetitions of [0, 1, 3])
        for (const equalStyle of [false, true]) {
          const scenario = paragraphSequence(
            position,
            32,
            core.UpdateDocsAttributeType.REPLACE,
            7,
            (body, enter) => {
              if (equalStyle) body.textRuns![0].ts = { bl: 1, cl: { rgb: '#123456' } };
              if (!enter)
                for (let index = 0; index < repetitions; index++) {
                  const normalized = new core.ActionIterator([
                    { t: core.TextXActionType.INSERT, len: 1, body },
                  ]).next(1);
                  assert.ok(normalized.t === core.TextXActionType.INSERT);
                  for (const key of Object.keys(body)) delete (body as any)[key];
                  Object.assign(body, normalized.body);
                }
            },
          );
          const before = current(scenario.states, 'redoState'),
            after = candidate(scenario.states, 'redoState');
          assert.deepEqual(after, before);
          assert.deepEqual(
            ownDataShape({ input: scenario.states, output: after }),
            ownDataShape({ input: scenario.states, output: before }),
          );
          const originalShape = ownDataShape(scenario.states),
            expected = structuredClone(after);
          const edits = (after as any)[1].e;
          edits.find((edit: any) => edit.t === 'i').body.dataStream = 'changed output';
          assert.deepEqual(
            ownDataShape(scenario.states),
            originalShape,
            'Output mutation cannot alter inputs',
          );
          assert.deepEqual(
            candidate(scenario.states, 'redoState'),
            expected,
            'Independent calls own their result',
          );
        }
  });

  test(`${format}: REPLACE paragraph tails preserve the non-null accumulator and own their result`, async () => {
    const { patched, constantGuardPatched, original } = prepareDocsPatch(
      await readBuild(format),
      format,
    );
    const helper = (source: string) => {
      const start = source.indexOf('const DEBOUNCE_DELAY = 300;');
      const end = source.indexOf('const IDocStateChangeInterceptorService =', start);
      return runInNewContext(source.slice(start, end) + ';composeDocStateActions;', {
        ...core,
        _univerjs_core: core,
        Object,
        Array,
      }) as (states: State[], key: 'redoState') => JSONXActions;
    };
    const current = helper(constantGuardPatched),
      candidate = helper(patched);
    for (let position = 0; position < 32; position++) {
      const scenario = paragraphSequence(position, 32, core.UpdateDocsAttributeType.REPLACE, 7);
      const before = measuredFlush(constantGuardPatched, scenario.states);
      const after = measuredFlush(patched, scenario.states);
      assertNativePreservation(
        flush(original, scenario.states),
        after.output,
        scenario,
        `REPLACE ${position}`,
      );
      assert.deepEqual(after.output, before.output);
      const expected = current(scenario.states, 'redoState');
      const actual = candidate(scenario.states, 'redoState');
      assert.deepEqual(
        actual,
        expected,
        'The result from the non-null structural accumulator is raw-equal.',
      );
      const prior = structuredClone(scenario.states);
      const references = new Set<object>();
      const collect = (value: unknown) => {
        if (!value || typeof value !== 'object' || references.has(value)) return;
        references.add(value);
        for (const child of Object.values(value)) collect(child);
      };
      collect(scenario.states);
      const checkOwned = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        assert.ok(!references.has(value), 'No result object aliases a source state.');
        assert.equal(
          Object.getPrototypeOf(value),
          Array.isArray(value) ? Array.prototype : Object.prototype,
        );
        for (const child of Object.values(value)) checkOwned(child);
      };
      checkOwned(actual);
      (actual as any)[1].e[1].body.dataStream = 'mutated output';
      assert.deepEqual(scenario.states, prior, 'Output mutation leaves all source states intact.');
      assert.deepEqual(
        candidate(scenario.states, 'redoState'),
        expected,
        'Independent composition retains its own output.',
      );
      if (position < 24) assert.ok(after.counts.allocations < before.counts.allocations);
      if (position === 5 || position === 19)
        assertNativePreservation(
          flush(original, scenario.states.slice(7), scenario.states),
          flush(patched, scenario.states.slice(7), scenario.states),
          scenario,
          'REPLACE unequal caches',
          7,
        );
    }
  });

  test(`${format}: unsupported paragraph bridges retain exact fallback calls and accessor reads`, async () => {
    const { patched, constantGuardPatched } = prepareDocsPatch(await readBuild(format), format);
    const calls: { left: unknown; right: JSONXActions }[] = [];
    const json = {
      compose(left: JSONXActions, right: JSONXActions) {
        calls.push({ left: ownDataShape(left), right });
        return core.JSONX.compose(left, right);
      },
    };
    const helper = (source: string) => {
      const start = source.indexOf('const DEBOUNCE_DELAY = 300;');
      const end = source.indexOf('const IDocStateChangeInterceptorService =', start);
      return runInNewContext(source.slice(start, end) + ';composeDocStateActions;', {
        ...core,
        JSONX: json,
        _univerjs_core: { ...core, JSONX: json },
        Object,
        Array,
      }) as (states: State[], key: 'redoState') => JSONXActions;
    };
    const current = helper(constantGuardPatched),
      candidate = helper(patched);
    let getterReads = 0;
    const cases: [string, (states: State[]) => void][] = [
      [
        'paragraph identity absent',
        (states) => {
          delete (states[3].redoState.actions as any)[1].e[1].body.paragraphs[0].paragraphId;
        },
      ],
      [
        'paragraph attributes',
        (states) => {
          (states[3].redoState.actions as any)[1].e[1].body.paragraphs[0].paragraphStyle = {
            spaceAbove: 2,
          };
        },
      ],
      ...[0, false, '', 'style'].map((value): [string, (states: State[]) => void] => [
        `primitive paragraph style ${JSON.stringify(value)}`,
        (states) => {
          (states[3].redoState.actions as any)[1].e[1].body.paragraphs[0].paragraphStyle = value;
        },
      ]),
      [
        'unknown paragraph key',
        (states) => {
          (states[3].redoState.actions as any)[1].e[1].body.paragraphs[0].future = undefined;
        },
      ],
      [
        'unknown body key',
        (states) => {
          (states[3].redoState.actions as any)[1].e[1].body.future = undefined;
        },
      ],
      [
        'unknown symbol',
        (states) => {
          (states[3].redoState.actions as any)[1].e[1].body[Symbol('unknown')] = 1;
        },
      ],
      [
        'wrong structural token',
        (states) => {
          (states[3].redoState.actions as any)[1].e[1].body.dataStream = '\n';
        },
      ],
      [
        'unknown cover mode',
        (states) => {
          (states[3].redoState.actions as any)[1].e[2].coverType = 3;
        },
      ],
      [
        'old body absent',
        (states) => {
          delete (states[3].redoState.actions as any)[1].e[2].oldBody;
        },
      ],
      [
        'second Enter',
        (states) => {
          states[8].redoState.actions = structuredClone(states[3].redoState.actions);
        },
      ],
      [
        'unsupported final marker',
        (states) => {
          (states.at(-1)!.redoState.actions as any)[1].e[1].body.__textXPreserveParagraphIds =
            false;
        },
      ],
      [
        'tail offset gap',
        (states) => {
          (states[4].redoState.actions as any)[1].e[0].len++;
        },
      ],
      [
        'internally contiguous but displaced tail',
        (states) => {
          for (const state of states.slice(4)) (state.redoState.actions as any)[1].e[0].len++;
        },
      ],
      [
        'prepend suffix',
        (states) => {
          for (const state of states.slice(4)) (state.redoState.actions as any)[1].e[0].len = 4;
        },
      ],
      [
        'prefix offset gap',
        (states) => {
          (states[1].redoState.actions as any)[1].e[0].len++;
        },
      ],
      [
        'different unit',
        (states) => {
          states[7].unitId = 'different';
        },
      ],
      [
        'different segment',
        (states) => {
          states[7].segmentId = 'different';
        },
      ],
      [
        'scope accessor',
        (states) => {
          Object.defineProperty(states[7], 'segmentId', {
            configurable: true,
            enumerable: true,
            get: () => {
              getterReads++;
              return '';
            },
          });
        },
      ],
      [
        'body accessor',
        (states) => {
          const action = (states[3].redoState.actions as any)[1].e[1];
          const body = action.body;
          Object.defineProperty(action, 'body', {
            configurable: true,
            enumerable: true,
            get: () => {
              getterReads++;
              return body;
            },
          });
        },
      ],
      [
        'nonplain prototype',
        (states) => {
          Object.setPrototypeOf((states[3].redoState.actions as any)[1].e[1].body, {
            inherited: 1,
          });
        },
      ],
      [
        'generic unsupported boundary',
        (states) => {
          (states[3].redoState.actions as any)[1].e[1].t = 'd';
        },
      ],
    ];
    for (const [name, mutate] of cases) {
      const states = paragraphSequence(3, 12).states;
      mutate(states);
      const shape = ownDataShape(states);
      const run = (compose: typeof current) => {
        calls.length = 0;
        getterReads = 0;
        let output: unknown, error: unknown;
        try {
          output = ownDataShape(compose(states, 'redoState'));
        } catch (value) {
          error = String(value);
        }
        return { output, error, calls: [...calls], getterReads };
      };
      const expected = run(current),
        actual = run(candidate);
      assert.deepEqual(
        actual,
        expected,
        `${name}: exact fallback calls, raw result/failure and reads.`,
      );
      actual.calls.forEach((call, index) => {
        if (states.some((state) => state.redoState.actions === expected.calls[index].right))
          assert.equal(
            call.right,
            expected.calls[index].right,
            `${name}: original right operand identity`,
          );
      });
      assert.deepEqual(ownDataShape(states), shape, `${name}: descriptors and inputs unchanged.`);
    }
  });

  test(`${format}: six tail admission guard cases each change the native fold when removed, independent of hash pins`, async () => {
    // Remove one guard from the generated helper and show that a scenario it must
    // reject now leaves the native fold. This proves these guards by behavior, so a
    // regenerated pin could never hide one that stopped doing its job. The offset and
    // plain-insert checks are proven as a pair. Other conditions (accessors, paragraph
    // and old-body shapes, markers) are covered by the fallback matrices in "unsupported
    // paragraph bridges" and "following-retain and old-body variants". The assertion is
    // on compose calls: without the guard the helper stops reproducing the native fold.
    const { patched, constantGuardPatched } = prepareDocsPatch(await readBuild(format), format);
    const composeCalls = (source: string, states: State[], key: 'redoState' | 'undoState') => {
      const calls: JSONXActions[] = [];
      const json = {
        compose(left: JSONXActions, right: JSONXActions) {
          calls.push(right);
          return core.JSONX.compose(left, right);
        },
      };
      const start = source.indexOf('const DEBOUNCE_DELAY = 300;');
      const end = source.indexOf('const IDocStateChangeInterceptorService =', start);
      const compose = runInNewContext(source.slice(start, end) + ';composeDocStateActions;', {
        ...core,
        JSONX: json,
        _univerjs_core: { ...core, JSONX: json },
        Object,
        Array,
      }) as (states: State[], key: string) => JSONXActions;
      compose(states, key);
      return calls;
    };
    const without = (source: string, text: string, replacement = '') => {
      assert.ok(source.includes(text), `generated helper contains guard: ${text}`);
      return source.replace(text, replacement);
    };
    const guards: {
      name: string;
      mutated: string;
      key: 'redoState' | 'undoState';
      states: () => State[];
      admitted: () => State[];
    }[] = [
      {
        name: 'redo-only key',
        mutated: without(patched, 'key === "redoState" && '),
        key: 'undoState',
        // An undo cache that is otherwise a qualified single-Enter append tail.
        states: () => {
          const states = paragraphSequence(3, 12).states;
          for (const state of states) state.undoState.actions = state.redoState.actions;
          return states;
        },
        admitted: () => paragraphSequence(3, 12).states,
      },
      {
        name: 'tail of more than four states',
        mutated: without(patched, 'states.length - prefix > 4', 'states.length - prefix > 0'),
        key: 'redoState',
        states: () => paragraphSequence(28, 32).states,
        admitted: () => paragraphSequence(27, 32).states,
      },
      {
        // The plain-insert tail check and the offset check each reject what the
        // other would (the prefix scan also walks offsets; a second Enter's three
        // edits never match an append offset), so removing either alone changes
        // nothing. Only the pair keeps exactly one Enter and a contiguous tail.
        name: 'exactly one native Enter (plain-insert tail and offset checks together)',
        mutated: without(
          without(patched, 'if (docInsertPrefixLength(tail, key) !== tail.length) return false;'),
          'if (currentOffset !== firstOffset + index) return false;',
        ),
        key: 'redoState',
        states: () => {
          // A second Enter whose offset is correct, so only this guard rejects it.
          const states = paragraphSequence(3, 12).states;
          states[8].redoState.actions = paragraphSequence(8, 12).states[8].redoState.actions;
          return states;
        },
        admitted: () => paragraphSequence(3, 12).states,
      },
      {
        name: 'contiguous tail offsets (same overlapping pair)',
        mutated: without(
          without(patched, 'if (docInsertPrefixLength(tail, key) !== tail.length) return false;'),
          'if (currentOffset !== firstOffset + index) return false;',
        ),
        key: 'redoState',
        states: () => {
          const states = paragraphSequence(3, 12).states;
          (states[4].redoState.actions as any)[1].e[0].len++;
          return states;
        },
        admitted: () => paragraphSequence(3, 12).states,
      },
      {
        name: 'one unit and segment',
        mutated: without(
          patched,
          'if (state.unitId !== states[0].unitId || state.segmentId !== states[0].segmentId) return false;',
        ),
        key: 'redoState',
        states: () => {
          const states = paragraphSequence(3, 12).states;
          states[7].unitId = 'different';
          return states;
        },
        admitted: () => paragraphSequence(3, 12).states,
      },
      {
        name: 'native cover modes only',
        mutated: without(patched, '(following.coverType !== 0 && following.coverType !== 1) || '),
        key: 'redoState',
        states: () => {
          const states = paragraphSequence(3, 12).states;
          (states[3].redoState.actions as any)[1].e[2].coverType = 3;
          return states;
        },
        admitted: () => paragraphSequence(3, 12).states,
      },
    ];
    for (const guard of guards) {
      const rejected = guard.states();
      const fallback = composeCalls(constantGuardPatched, rejected, guard.key);
      assert.deepEqual(
        composeCalls(patched, guard.states(), guard.key),
        fallback,
        `${guard.name}: the guard keeps the native fold`,
      );
      assert.notDeepEqual(
        composeCalls(guard.mutated, guard.states(), guard.key),
        fallback,
        `${guard.name}: without the guard the scenario leaves the native fold`,
      );
      // The same guard still admits the qualified shape, so it is not a blanket reject.
      assert.notDeepEqual(
        composeCalls(patched, guard.admitted(), 'redoState'),
        composeCalls(constantGuardPatched, guard.admitted(), 'redoState'),
        `${guard.name}: a qualified shape takes the linear path`,
      );
    }
  });

  test(`${format}: admitted paragraph joins preserve absent, undefined and empty metadata`, async () => {
    const { original, patched, constantGuardPatched } = prepareDocsPatch(
      await readBuild(format),
      format,
    );
    const cases: [string, (body: any, isEnter: boolean) => void][] = [
      [
        'marker absent',
        (body) => {
          delete body.__textXPreserveParagraphIds;
        },
      ],
      [
        'plain runs absent',
        (body, enter) => {
          if (!enter) delete body.textRuns;
        },
      ],
      [
        'plain runs undefined',
        (body, enter) => {
          if (!enter) body.textRuns = undefined;
        },
      ],
      [
        'plain runs empty',
        (body, enter) => {
          if (!enter) body.textRuns = [];
        },
      ],
      [
        'run style absent',
        (body) => {
          delete body.textRuns[0].ts;
        },
      ],
      [
        'run style undefined',
        (body) => {
          body.textRuns[0].ts = undefined;
        },
      ],
      [
        'run style empty',
        (body) => {
          body.textRuns[0].ts = {};
        },
      ],
      [
        'run identity undefined',
        (body) => {
          body.textRuns[0].sId = undefined;
        },
      ],
      ...[
        'paragraphs',
        'customRanges',
        'customDecorations',
        'customBlocks',
        'sectionBreaks',
      ].flatMap((field) =>
        (['absent', 'undefined', 'empty'] as const).map(
          (mode): [string, (body: any, enter: boolean) => void] => [
            `${field} ${mode}`,
            (body, enter) => {
              if (field === 'paragraphs' && enter) return;
              if (mode === 'absent') delete body[field];
              else body[field] = mode === 'undefined' ? undefined : [];
            },
          ],
        ),
      ),
    ];
    for (const cover of [core.UpdateDocsAttributeType.COVER, core.UpdateDocsAttributeType.REPLACE])
      for (const [name, decorate] of cases) {
        const scenario = paragraphSequence(4, 16, cover, 5, decorate);
        const current = measuredFlush(constantGuardPatched, scenario.states, scenario.states, true);
        const candidate = measuredFlush(patched, scenario.states, scenario.states, true);
        assertNativePreservation(
          flush(original, scenario.states),
          candidate.output,
          scenario,
          `${cover}/${name}`,
        );
        assert.deepEqual(
          candidate.output,
          current.output,
          `${cover}/${name}: exact current raw metadata`,
        );
        assert.ok(
          candidate.counts.allocations < current.counts.allocations,
          `${cover}/${name}: admitted join reduces work`,
        );
      }
  });

  test(`${format}: following-retain and old-body variants preserve exact paragraph joins`, async () => {
    const { original, patched, constantGuardPatched } = prepareDocsPatch(
      await readBuild(format),
      format,
    );
    const variants: [string, (body: any) => void][] = [
      [
        'style absent',
        (body) => {
          delete body.textRuns[0].ts;
        },
      ],
      [
        'style undefined',
        (body) => {
          body.textRuns[0].ts = undefined;
        },
      ],
      [
        'style empty',
        (body) => {
          body.textRuns[0].ts = {};
        },
      ],
      [
        'run identity undefined',
        (body) => {
          body.textRuns[0].sId = undefined;
        },
      ],
      [
        'marker present',
        (body) => {
          body.__textXPreserveParagraphIds = true;
        },
      ],
      ...[
        'paragraphs',
        'customRanges',
        'customDecorations',
        'customBlocks',
        'sectionBreaks',
      ].flatMap((field) =>
        (['absent', 'undefined', 'empty'] as const).map((mode): [string, (body: any) => void] => [
          `${field} ${mode}`,
          (body) => {
            if (mode === 'absent') delete body[field];
            else body[field] = mode === 'undefined' ? undefined : [];
          },
        ]),
      ),
    ];
    for (const cover of [core.UpdateDocsAttributeType.COVER, core.UpdateDocsAttributeType.REPLACE])
      for (const target of ['body', 'oldBody'])
        for (const [name, mutate] of [
          ...variants,
          ...(target === 'oldBody'
            ? [
                [
                  'old runs empty',
                  (body: any) => {
                    body.textRuns = [];
                  },
                ] as [string, (body: any) => void],
              ]
            : []),
        ]) {
          const scenario = paragraphSequence(4, 16, cover, 5);
          mutate((scenario.states[4].redoState.actions as any)[1].e[2][target]);
          const native = measuredFlush(original, scenario.states, scenario.states, true);
          const before = measuredFlush(
            constantGuardPatched,
            scenario.states,
            scenario.states,
            true,
          );
          const after = measuredFlush(patched, scenario.states, scenario.states, true);
          const context = `${cover}/${target}/${name}`;
          assert.deepEqual(
            after.output,
            native.output,
            `${context}: upstream raw bridge semantics`,
          );
          assert.deepEqual(after.output, before.output, `${context}: current raw bridge semantics`);
          // These artificial old-body representations use native composition as
          // the oracle; do not claim they came from an independently authored edit.
          assert.deepEqual(
            appliedSnapshots(after.output, scenario),
            appliedSnapshots(before.output, scenario),
            `${context}: complete applied snapshots`,
          );
          assert.ok(
            after.counts.allocations < before.counts.allocations,
            `${context}: admitted join`,
          );
        }
  });

  test(`${format}: diagnostic wrappers preserve actual manager output and native phase ownership`, async () => {
    const { constantGuardPatched } = prepareDocsPatch(await readBuild(format), format);
    const scenario = paragraphSequence(3);
    const control = flush(constantGuardPatched, scenario.states);
    const fixture = managerFixture(constantGuardPatched);
    const compose = core.JSONX.compose;
    const diagnostic = observeNativeDocComposition(
      fixture.manager as unknown as DiagnosticManager,
      core.JSONX,
      unitId,
    );
    try {
      fixture.manager.setStateCache(unitId, {
        history: [...scenario.states],
        collaboration: [...scenario.states],
      });
      fixture.manager.flushPendingChanges(unitId);
      const report = diagnostic.finish();
      assert.equal(report.restored, true);
      assert.equal(report.dropped, 0);
      assert.equal(report.states, 64);
      assert.deepEqual(
        report.captures.map((value) => value.phase),
        ['history', 'collaboration'],
      );
      assert.deepEqual(
        report.captures.map((value) => decodeCapture(value.cache)),
        [scenario.states, scenario.states],
      );
      assert.ok(report.calls.length > 0);
      assert.deepEqual(
        { history: fixture.history, changes: fixture.changes, publication: fixture.publication },
        control,
      );
      assert.equal(core.JSONX.compose, compose);
    } finally {
      diagnostic.finish();
      fixture.close();
    }
  });

  test(`${format}: unsupported markers after odd and even prefixes retain raw native publication`, async () => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    for (const length of [0, 1, 3, 6, 19, 31])
      for (const value of [undefined, false, null, 0, 1, 'true']) {
        const scenario = sequence(
          Array.from({ length: 32 }, (_, index) => insertAt(index, keyboardBody(index))),
        );
        const actions = scenario.states[length].redoState.actions as any;
        actions[1].e.at(-1).body.__textXPreserveParagraphIds = value;
        const native = measuredFlush(original, scenario.states);
        const candidate = measuredFlush(patched, scenario.states);
        assert.deepEqual(
          candidate.output,
          native.output,
          `prefix=${length}, marker=${String(value)}`,
        );
        // A short forward prefix still falls back; its inverse may now have a
        // long qualified delete prefix. Do not confuse their combined work.
        if (length < 4) assert.equal(candidate.counts.bodySlices, native.counts.bodySlices);
        assert.ok(
          candidate.counts.allocations < native.counts.allocations,
          `prefix=${length}, marker=${String(value)}: ${candidate.counts.allocations} < ${native.counts.allocations}`,
        );
      }
  });

  test(`${format}: guard accepts the pinned original and exact current or previous patch`, async () => {
    const {
      original,
      patched,
      previousPatched,
      markerPatched,
      prefixPatched,
      completeDeletePatched,
      deletePrefixPatched,
      constantGuardPatched,
      paragraphTailPatched,
      qualifiedRangesPatched,
      linearTailPatched,
    } = prepareDocsPatch(await readBuild(format), format);
    const markerHash = {
      es: 'dab591090c464e72138f4decb51f595a3307faefd8ba3af8dab61cd04d646bd2',
      cjs: '7c31808ffa040ef2069e9ffe9be47235bbd6b6441f751c25ec553e9e869b0787',
    }[format];
    assert.equal(createHash('sha256').update(markerPatched).digest('hex'), markerHash);
    assert.equal(prepareDocsPatch(markerPatched, format).patched, patched);
    assert.equal(prepareDocsPatch(prefixPatched, format).patched, patched);
    assert.equal(
      createHash('sha256').update(completeDeletePatched).digest('hex'),
      {
        es: '3f6bc0f99450961af5219f0d635353e2e42f4b7c6136142e578f0d13de385302',
        cjs: '1b89369c144869aef94c983aadbea939256098371b411e5e85464e78d0f82803',
      }[format],
    );
    assert.equal(prepareDocsPatch(completeDeletePatched, format).patched, patched);
    assert.equal(
      createHash('sha256').update(deletePrefixPatched).digest('hex'),
      {
        es: '3a6afe19366ab5426023a2e0c5abcef836bc574c343a3b705160571abbb86097',
        cjs: '58cf26efaa11cc1427c74c90e4d6a0881c0d717aba6c6d4f4f0871f4ab6659ed',
      }[format],
    );
    assert.equal(prepareDocsPatch(deletePrefixPatched, format).patched, patched);
    assert.equal(
      createHash('sha256').update(constantGuardPatched).digest('hex'),
      {
        es: 'a326d165b7288f7bb503259e1247e271ae58ef63acfee99e47dc47ac967fa64e',
        cjs: '5b3a9d2559c9831cad691e0c2eef98227652e40b309b4ddc57b35d43de826817',
      }[format],
    );
    assert.equal(prepareDocsPatch(constantGuardPatched, format).patched, patched);
    assert.equal(
      createHash('sha256').update(paragraphTailPatched).digest('hex'),
      {
        es: 'ff54155b5bde5e951b5d9ca7672651cab6903f2565e3961121a0c5c8eb09f3d7',
        cjs: 'b0020de90c3bb15b1edfb5ed79d2180b69841b7bc24a284b7475a91f94dd3495',
      }[format],
    );
    assert.equal(prepareDocsPatch(paragraphTailPatched, format).patched, patched);
    assert.throws(() => prepareDocsPatch(paragraphTailPatched + '\n// unknown edit', format));
    assert.throws(() => prepareDocsPatch(constantGuardPatched + '\n// unknown edit', format));
    assert.throws(() => prepareDocsPatch(deletePrefixPatched + '\n// unknown edit', format));
    assert.throws(() => prepareDocsPatch(completeDeletePatched + '\n// unknown edit', format));
    assert.throws(() => prepareDocsPatch(prefixPatched + '\n// unknown edit', format));
    assert.throws(
      () => prepareDocsPatch(markerPatched + '\n// unknown edit', format),
      /Unrecognized/,
    );
    const previousHash = {
      es: '9cdb0811942ba53265a614ea059a65d14240e7e91a73ab71df97b7218e5052a3',
      cjs: '8ad78de1a1667c47fac91ef33aa045cc30f1c655f0e977aca1cf8ce25bd555ac',
    }[format];
    assert.equal(createHash('sha256').update(previousPatched).digest('hex'), previousHash);
    assert.equal(prepareDocsPatch(previousPatched, format).patched, patched);
    assert.equal(
      createHash('sha256').update(qualifiedRangesPatched).digest('hex'),
      {
        es: '83b7c9780e3c7e23767f65357915e6d419d3be64d9717f9d6f4c4588f0803a77',
        cjs: '4505cd09d6237053f43c2cdc32d3027be24d381a0917844f47c2c41949b5fa5c',
      }[format],
    );
    assert.equal(prepareDocsPatch(qualifiedRangesPatched, format).patched, patched);
    assert.throws(() => prepareDocsPatch(qualifiedRangesPatched + '\n// unknown edit', format));
    assert.throws(
      () => prepareDocsPatch(linearTailPatched, format),
      /Unrecognized/,
      'Unpublished intermediate is not an accepted installed build',
    );
    assert.equal(
      createHash('sha256').update(patched).digest('hex'),
      {
        es: '788566fd844ad732f3dce124c64daf9f14a742487b5e11191d96da7c82b0563c',
        cjs: 'f5d9d7a67e528159e16bb1abc341f4efd7b62dcfa29d18d925c7bd60904626a9',
      }[format],
    );
    assert.equal(prepareDocsPatch(patched, format).patched, patched);
    assert.throws(() => prepareDocsPatch(original + '\n// unknown edit', format), /Unrecognized/);
    assert.throws(
      () => prepareDocsPatch(previousPatched + '\n// unknown edit', format),
      /Unrecognized/,
    );
    const json = format === 'cjs' ? '_univerjs_core.JSONX' : 'JSONX';
    const partial = patched.replace(
      'composeDocStateActions(cacheStates, "redoState")',
      `cacheStates.reduce((acc, cur) => ${json}.compose(acc, cur.redoState.actions), null)`,
    );
    assert.throws(() => prepareDocsPatch(partial, format), /Partially modified/);
  });

  test(`${format}: native preservation markers qualify without changing forward or inverse actions`, async () => {
    const { original, patched, previousPatched } = prepareDocsPatch(
      await readBuild(format),
      format,
    );
    const marker = '__textXPreserveParagraphIds';
    for (const length of [3, 32])
      for (const mode of ['absent', 'true', 'mixed'])
        for (const inverse of [false, true]) {
          const initial = seed(inverse ? `${'x'.repeat(length)}\r\n` : '\r\n');
          initial.body!.customRanges = [];
          const scenario = sequence(
            Array.from({ length }, (_, index) =>
              inverse ? () => edit(new core.TextX().delete(1)) : insertAt(index),
            ),
            initial,
          );
          for (const [index, state] of scenario.states.entries()) {
            const edits = (state[inverse ? 'undoState' : 'redoState'].actions as any)[1].e;
            const body = edits.at(-1).body;
            if (mode === 'true' || (mode === 'mixed' && index % 2 === 0)) body[marker] = true;
            else delete body[marker];
          }
          const native = measuredFlush(original, scenario.states);
          const previous = measuredFlush(previousPatched, scenario.states);
          const candidate = measuredFlush(patched, scenario.states);
          assertNativePreservation(
            native.output,
            candidate.output,
            scenario,
            `${mode}/${length}/inverse=${inverse}`,
          );
          if (mode === 'absent')
            assert.deepEqual(
              candidate.output,
              previous.output,
              'Existing unmarked publications remain unchanged.',
            );
          else if (length === 32) {
            const reduced = (counts: typeof candidate.counts) => {
              for (const key of ['bodySlices', 'cloneVisits', 'allocations'] as const)
                assert.ok(
                  counts[key] < previous.counts[key] * 0.8,
                  `${mode}/${key}: native marker must not bypass balanced work`,
                );
            };
            reduced(candidate.counts);
            assert.throws(
              () => reduced(previous.counts),
              /must not bypass/,
              'The exact prior patch must fail the regression criterion.',
            );
          }
        }
    for (const value of [undefined, false, null, 0, 1, 'true']) {
      const scenario = sequence(Array.from({ length: 7 }, (_, index) => insertAt(index)));
      const actions = scenario.states[1].redoState.actions as any;
      actions[1].e.at(-1).body[marker] = value;
      const candidate = measuredFlush(patched, scenario.states);
      const native = measuredFlush(original, scenario.states);
      assert.deepEqual(
        candidate.output,
        native.output,
        'An unsupported own marker retains raw publication in both directions.',
      );
      assert.equal(
        candidate.counts.bodySlices,
        native.counts.bodySlices,
        'One leading insert retains the complete forward fold.',
      );
      assert.ok(
        candidate.counts.allocations < native.counts.allocations,
        'The independently qualified inverse prefix still reduces native allocation work.',
      );
    }
  });
}

test('Docs installer validates package identity and both complete builds before any write', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'spinel-docs-composition-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'node_modules/@univerjs/docs');
  const originals = {
    es: prepareDocsPatch(await readBuild('es'), 'es').original,
    cjs: prepareDocsPatch(await readBuild('cjs'), 'cjs').original,
  };
  for (const format of ['es', 'cjs'] as const) {
    await mkdir(resolve(directory, 'lib', format), { recursive: true });
    await writeFile(resolve(directory, 'lib', format, 'index.js'), originals[format]);
  }
  const metadataPath = resolve(directory, 'package.json');
  for (const metadata of [
    { name: '@univerjs/docs', version: '1.2.0' },
    { name: 'other', version: '1.3.1' },
  ]) {
    await writeFile(metadataPath, JSON.stringify(metadata));
    await assert.rejects(patchInstalledDocs(root), /Upgrading/);
  }
  await writeFile(metadataPath, JSON.stringify({ name: '@univerjs/docs', version: '1.3.1' }));
  const cjs = resolve(directory, 'lib/cjs/index.js');
  await writeFile(cjs, originals.cjs + '\n// unknown edit');
  await assert.rejects(patchInstalledDocs(root), /Unrecognized/);
  assert.equal(await readFile(resolve(directory, 'lib/es/index.js'), 'utf8'), originals.es);
  assert.equal(await readFile(cjs, 'utf8'), originals.cjs + '\n// unknown edit');
  await writeFile(cjs, originals.cjs);
  await patchInstalledDocs(root);
  await patchInstalledDocs(root);
  for (const format of ['es', 'cjs'] as const)
    assert.equal(
      await readFile(resolve(directory, 'lib', format, 'index.js'), 'utf8'),
      prepareDocsPatch(originals[format], format).patched,
    );
  for (const previous of [
    'completeDeletePatched',
    'deletePrefixPatched',
    'paragraphTailPatched',
  ] as const) {
    // Existing installs upgrade exact complete prior patches, atomically with
    // respect to validation of both formats, just like fresh upstream installs.
    for (const format of ['es', 'cjs'] as const)
      await writeFile(
        resolve(directory, 'lib', format, 'index.js'),
        prepareDocsPatch(originals[format], format)[previous],
      );
    const oldEs = await readFile(resolve(directory, 'lib/es/index.js'), 'utf8');
    const oldCjs = await readFile(cjs, 'utf8');
    await writeFile(cjs, oldCjs + '\n// unknown edit');
    await assert.rejects(patchInstalledDocs(root), /Unrecognized/);
    assert.equal(await readFile(resolve(directory, 'lib/es/index.js'), 'utf8'), oldEs);
    await writeFile(cjs, oldCjs);
    await patchInstalledDocs(root);
    for (const format of ['es', 'cjs'] as const)
      assert.equal(
        await readFile(resolve(directory, 'lib', format, 'index.js'), 'utf8'),
        prepareDocsPatch(originals[format], format).patched,
      );
  }
});
