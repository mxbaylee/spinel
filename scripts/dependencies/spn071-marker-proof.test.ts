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
import { markerAwareBalanced as allocationPrototype } from '../ci/spn071-marker-proof.ts';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as core from '@univerjs/core';
import type { IDocumentData, JSONXActions } from '@univerjs/core';
import type {
  DocStateChangeManagerService,
  IDocStateChangeInfo,
  IDocStateChangeParams,
} from '@univerjs/docs';
import { BehaviorSubject, Subject, takeUntil } from 'rxjs';
import { patchInstalledDocs, prepareDocsPatch } from './patch-univer-docs.ts';

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

function managerFixture(source: string, onHistory?: (entry: Entry, manager: Manager) => void) {
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
        observe('history');
        history.push(structuredClone(entry));
        onHistory?.(entry, manager);
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
// Proof fixture copied from patch-univer-docs.test.ts at 53ad684.
// Public DocInputController's ordinary collapsed keyboard-input body shape.
function keyboardBody(index = 0): core.IDocumentBody {
  return {
    dataStream: 'x',
    textRuns: [{ st: 0, ed: 1, ts: { bl: index % 2 === 0 ? 1 : 0, cl: { rgb: '#123456' } } }],
    customRanges: [],
    customDecorations: [],
  };
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

function flush(source: string, history: State[], collaboration = history) {
  const fixture = managerFixture(source);
  try {
    // Native caches are distinct arrays even when their state objects coincide.
    const cache = structuredClone({ history: [...history], collaboration: [...collaboration] });
    const retainedStates = [...cache.history, ...cache.collaboration];
    const before = structuredClone(retainedStates);
    fixture.manager.setStateCache(unitId, cache);
    fixture.manager.flushPendingChanges(unitId);
    assert.deepEqual(retainedStates, before, 'Composition must not mutate native state objects.');
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

function measuredFlush(source: string, states: State[], collaboration = states) {
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
    return { output: flush(source, states, collaboration), counts };
  } finally {
    core.TextX.compose = compose;
    core.ActionIterator.prototype.next = next;
    core.Tools.deepClone = clone;
  }
}

const variants: Record<string, (character: string) => core.IDocumentBody> = {
  absent: (dataStream) => ({ dataStream }),
  undefined: (dataStream) => ({ dataStream, textRuns: undefined, customRanges: undefined }),
  empty: (dataStream) => ({ dataStream, textRuns: [], customRanges: [], customDecorations: [] }),
  runAbsentStyle: (dataStream) => ({ dataStream, textRuns: [{ st: 0, ed: 1 }] }),
  runUndefinedStyle: (dataStream) => ({ dataStream, textRuns: [{ st: 0, ed: 1, ts: undefined }] }),
  plain: (dataStream) => ({ dataStream, textRuns: [{ st: 0, ed: 1, ts: {} }], customRanges: [], customDecorations: [] }),
  light: (dataStream) => ({ dataStream, textRuns: [{ st: 0, ed: 1, ts: { cl: { rgb: '#18181b' } } }], customRanges: [], customDecorations: [] }),
  dark: (dataStream) => ({ dataStream, textRuns: [{ st: 0, ed: 1, ts: { cl: { rgb: '#fafafa' } } }], customRanges: [], customDecorations: [] }),
  color: (dataStream) => ({ dataStream, textRuns: [{ st: 0, ed: 1, ts: { cl: { rgb: '#123456' } } }], paragraphs: [], sectionBreaks: [], customBlocks: [], customRanges: [], customDecorations: [] }),
};

test('captured native mobile caches preserve publications and demonstrate eligibility', async () => {
  const path = process.env.SPN071_CAPTURE;
  assert.ok(path, 'Supply the predeclared tagged native capture.');
  const capture = JSON.parse(await readFile(path, 'utf8'));
  const decode = (value: any): any => {
    if (value.kind === 'undefined') return undefined;
    if (value.kind === 'value') return value.value;
    const target: any = value.kind === 'array' ? [] : {};
    for (const [key, child] of value.entries) target[key] = decode(child);
    return target;
  };
  assert.equal(capture.captures.length, 8);
  for (const format of ['es', 'cjs'] as const) {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    const prototype = allocationPrototype(patched, format);
    let activated = 0;
    for (const [index, encoded] of capture.captures.entries()) {
      const cache = decode(encoded);
      assert.equal(cache.history.length, 32);
      assert.equal(cache.collaboration.length, 32);
      const native = measuredFlush(original, cache.history, cache.collaboration);
      const balanced = measuredFlush(patched, cache.history, cache.collaboration);
      const candidate = measuredFlush(prototype, cache.history, cache.collaboration);
      assert.deepEqual(candidate.output, native.output, `capture ${index}: native exact publication`);
      assert.deepEqual(candidate.output, balanced.output, `capture ${index}: balanced exact publication`);
      const active = candidate.counts.iteratorNext < balanced.counts.iteratorNext;
      if (active) {
        activated++;
        assert.ok(candidate.counts.allocations < balanced.counts.allocations * 0.8);
      } else assert.deepEqual(candidate.counts, balanced.counts, 'Ineligible cache uses complete fallback.');
      console.log(JSON.stringify({ format, capture: index, active, native: native.counts, balanced: balanced.counts, prototype: candidate.counts }));
    }
    assert.ok(activated >= 6, 'At least six of eight caches must qualify; paragraph groups may fall back.');
    console.log(JSON.stringify({ format, nativeCapturedCaches: 8, activated }));
  }
});

for (const format of ['es', 'cjs'] as const) {
  test(`${format}: finite exact publication and snapshot matrix`, async () => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    const prototype = allocationPrototype(patched, format);
    let cases = 0;
    for (const [name, body] of Object.entries(variants))
      for (const length of [2, 3, 7, 32])
        for (const start of [0, 2])
          for (const prepend of [false, true]) {
            const characters = ['a', 'b', 'é', '\ud83d', '\ude00', ' ', 'z'];
            const scenario = sequence(Array.from({ length }, (_, index) =>
              insertAt(start + (prepend ? 0 : index), { ...body(characters[index % characters.length]), __textXPreserveParagraphIds: true } as core.IDocumentBody)));
            const control = flush(original, scenario.states);
            const balanced = measuredFlush(patched, scenario.states);
            const candidate = measuredFlush(prototype, scenario.states);
            assertNativePreservation(control, balanced.output, scenario, `${name}/balanced/${length}/${start}/${prepend}`);
            assertNativePreservation(control, candidate.output, scenario, `${name}/prototype/${length}/${start}/${prepend}`);
            const guardStart = prototype.indexOf('function hasOnlyDocInsertKeys(');
            const guardEnd = prototype.indexOf('function composeDocStateActions(');
            const qualifies = runInNewContext(prototype.slice(guardStart, guardEnd) + '\ncanBalanceDocInserts;');
            assert.equal(qualifies(scenario.states, 'redoState'), true, `${name}/${length}/${start}/${prepend}: balanced guard qualifies`);
            cases++;
          }
    console.log(JSON.stringify({ format, exactMatrixCases: cases }));
  });

  test(`${format}: marker recognition reduces real work against current fallback; disabled control fails`, async () => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    const prototype = allocationPrototype(patched, format);
    for (const name of ['plain', 'light', 'dark', 'color']) {
      const scenario = sequence(Array.from({ length: 32 }, (_, index) => insertAt(index + 2, { ...variants[name]('x'), __textXPreserveParagraphIds: true } as core.IDocumentBody)));
      const native = measuredFlush(original, scenario.states);
      const balanced = measuredFlush(patched, scenario.states);
      const candidate = measuredFlush(prototype, scenario.states);
      assert.deepEqual(candidate.output, native.output);
      assert.deepEqual(candidate.output, balanced.output);
      const reduced = (counts: typeof candidate.counts) => {
        for (const key of ['bodySlices', 'cloneVisits', 'allocations'] as const)
          assert.ok(counts[key] < balanced.counts[key] * 0.8, `${name}/${key}: at least 20% reduction against balanced`);
      };
      console.log(JSON.stringify({ format, name, native: native.counts, balanced: balanced.counts, prototype: candidate.counts }));
      reduced(candidate.counts);
      assert.throws(() => reduced(balanced.counts), /at least 20% reduction/, 'Disabling shortcut must fail work criterion.');
    }
  });

  test(`${format}: mismatches and rich/structural states retain native results`, async () => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    const prototype = allocationPrototype(patched, format);
    const changes: Record<string, (body: Record<string, any>) => void> = {
      markerFalse: (body) => { body.__textXPreserveParagraphIds = false; },
      markerUndefined: (body) => { body.__textXPreserveParagraphIds = undefined; },
      markerString: (body) => { body.__textXPreserveParagraphIds = 'true'; },
      unknownField: (body) => { body.unknown = undefined; },
      extraRunField: (body) => { body.textRuns[0].unknown = undefined; },
      structural: (body) => { body.dataStream = '\r'; body.paragraphs = [{ startIndex: 0, paragraphId: 'para_proof' }]; },
      control: (body) => { body.dataStream = '\u007f'; },
    };
    for (const [name, change] of Object.entries(changes)) {
      const scenario = sequence(Array.from({ length: 7 }, (_, index) => insertAt(index + 2, { ...variants.light('x'), __textXPreserveParagraphIds: true } as core.IDocumentBody)));
      const actions = scenario.states[3].redoState.actions as any;
      change(actions[1].e.at(-1).body);
      const control = measuredFlush(patched, scenario.states);
      const candidate = measuredFlush(prototype, scenario.states);
      assert.deepEqual(candidate, control, `${name}: complete fallback including primitive counts`);
      assert.deepEqual(candidate.output, flush(original, scenario.states), `${name}: native raw publication`);
    }
    const scenario = sequence(mixed);
    assertNativePreservation(flush(original, scenario.states), flush(prototype, scenario.states), scenario, 'mixed-rich');
  });

  test(`${format}: empty/divergent cache ownership and publication mutation`, async () => {
    const { original, patched } = prepareDocsPatch(await readBuild(format), format);
    const prototype = allocationPrototype(patched, format);
    const scenario = sequence(Array.from({ length: 32 }, (_, index) => insertAt(index + 2, { ...variants.light('x'), __textXPreserveParagraphIds: true } as core.IDocumentBody)));
    for (const history of [[], scenario.states.slice(1), scenario.states.slice(17), scenario.states]) {
      for (const collaboration of [[], scenario.states.slice(2), scenario.states]) {
        assert.deepEqual(flush(prototype, history, collaboration), flush(original, history, collaboration));
      }
    }
    const duringPublication = (source: string, mutateCache: boolean) => {
      const fixture = managerFixture(source, (entry, manager) => {
        const actions = entry.redoMutations[0].params.actions as any;
        actions[1].e.at(-1).body.dataStream = 'mutated history output';
        if (mutateCache) {
          const next = structuredClone(scenario.states.slice(0, 3));
          manager.setStateCache(unitId, { history: [], collaboration: next });
        }
      });
      try {
        const input = structuredClone(scenario.states);
        const before = structuredClone(input);
        fixture.manager.setStateCache(unitId, { history: [...input], collaboration: [...input] });
        fixture.manager.flushPendingChanges(unitId);
        assert.deepEqual(input, before, 'Published output does not alias input actions.');
        return { history: fixture.history, changes: fixture.changes, publication: fixture.publication };
      } finally { fixture.close(); }
    };
    for (const mutateCache of [false, true])
      assert.deepEqual(duringPublication(prototype, mutateCache), duringPublication(original, mutateCache));
  });
}

