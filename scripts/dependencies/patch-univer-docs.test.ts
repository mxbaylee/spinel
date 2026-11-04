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
 * dream-num/univer v1.1.0. No Pro package is read or modified.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
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
  costs: { history?: number; historyError?: Error; collaboration?: number } = {},
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

function flush(source: string, history: State[], collaboration = history, raw = false) {
  const fixture = managerFixture(source);
  try {
    // Native caches are distinct arrays even when their state objects coincide.
    const inputCache = { history: [...history], collaboration: [...collaboration] };
    const cache = raw ? inputCache : structuredClone(inputCache);
    const retainedStates = [...cache.history, ...cache.collaboration];
    const before = structuredClone(retainedStates);
    fixture.manager.setStateCache(unitId, cache);
    fixture.manager.flushPendingChanges(unitId);
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
    // Lossless tagged archive retains own undefined fields, unlike JSON round trips.
    function decode(value: any): any {
      if (value.kind === 'undefined') return undefined;
      if (value.kind === 'value') return value.value;
      assert.ok(value.kind === 'array' || value.kind === 'object');
      const result: any = value.kind === 'array' ? [] : {};
      for (const [key, child] of value.entries) {
        if (Array.isArray(result) && key === 'length') result.length = decode(child);
        else
          Object.defineProperty(result, key, {
            value: decode(child),
            writable: true,
            enumerable: true,
            configurable: true,
          });
      }
      return result;
    }
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
    const history = decode(phases.find((entry: any) => entry.phase === 'history').cache) as State[];
    const collaboration = decode(
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
    for (const change of mutations)
      for (let index = 0; index < history.length; index++) {
        const makeStates = () => {
          const states = structuredClone(history);
          change((states[index].undoState.actions as any)[1].e);
          return states;
        };
        const candidateStates = makeStates();
        const previousStates = makeStates();
        assert.deepEqual(
          measuredFlush(patched, candidateStates, candidateStates, true),
          measuredFlush(prefixPatched, previousStates, previousStates, true),
          `Unsupported raw delete shape ${mutations.indexOf(change)} member ${index} keeps the native fold and work.`,
        );
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
    const { original, patched, markerPatched } = prepareDocsPatch(await readBuild(format), format);
    for (let position = 0; position < 32; position++) {
      const scenario = sequence(
        Array.from({ length: 32 }, (_, index) => {
          if (index !== position) return insertAt(index, keyboardBody(index));
          // Native Enter inserts a paragraph and retains the following character's
          // style. This unsupported state and all following calls stay sequential.
          return () =>
            edit(
              new core.TextX()
                .retain(index)
                .insert(1, {
                  ...keyboardBody(index),
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
                  core.UpdateDocsAttributeType.COVER,
                ),
            );
        }),
        seed('z\r\n'),
      );
      const native = measuredFlush(original, scenario.states);
      const previous = measuredFlush(markerPatched, scenario.states);
      const candidate = measuredFlush(patched, scenario.states);
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
      if (position < 4) assert.deepEqual(candidate.counts, native.counts);
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
      if (position === 19) {
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
        if (length < 4) assert.deepEqual(candidate.counts, native.counts);
        else if (length >= 6)
          assert.ok(
            candidate.counts.allocations < native.counts.allocations,
            `prefix=${length}, marker=${String(value)}: ${candidate.counts.allocations} < ${native.counts.allocations}`,
          );
      }
  });

  test(`${format}: guard accepts the pinned original and exact current or previous patch`, async () => {
    const { original, patched, previousPatched, markerPatched, prefixPatched } = prepareDocsPatch(
      await readBuild(format),
      format,
    );
    const markerHash = {
      es: '259dd5a4ce24744a442b2cfc7211a89f46437c0257a2ca7b2b9aaaceddd946ba',
      cjs: 'd96e32ba1177187d3bffa1ac0dce9cbddb589070b5303159b7b6b6b460eb4f92',
    }[format];
    assert.equal(createHash('sha256').update(markerPatched).digest('hex'), markerHash);
    assert.equal(prepareDocsPatch(markerPatched, format).patched, patched);
    assert.equal(prepareDocsPatch(prefixPatched, format).patched, patched);
    assert.throws(() => prepareDocsPatch(prefixPatched + '\n// unknown edit', format));
    assert.throws(
      () => prepareDocsPatch(markerPatched + '\n// unknown edit', format),
      /Unrecognized/,
    );
    const previousHash = {
      es: '1f454109e7520cd09b5b046f45f9ceefbed546d643139d95952157d8e503d747',
      cjs: '7329999ae29c047b0fcd67a10104f1f48e097313fb9019e72f5868a263c432e4',
    }[format];
    assert.equal(createHash('sha256').update(previousPatched).digest('hex'), previousHash);
    assert.equal(prepareDocsPatch(previousPatched, format).patched, patched);
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
      assert.deepEqual(
        measuredFlush(patched, scenario.states),
        measuredFlush(original, scenario.states),
        'An unsupported own marker after one insert keeps the complete native fold.',
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
    { name: 'other', version: '1.1.0' },
  ]) {
    await writeFile(metadataPath, JSON.stringify(metadata));
    await assert.rejects(patchInstalledDocs(root), /Upgrading/);
  }
  await writeFile(metadataPath, JSON.stringify({ name: '@univerjs/docs', version: '1.1.0' }));
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
});
