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
 * Changed by Spinel: maintain native custom-range invariants at the public
 * document mutation boundary, without replacing or modifying Univer's TextX.
 */
import {
  CustomRangeType,
  ICommandService,
  IUniverInstanceService,
  JSONX,
  shallowEqual,
  TextXActionType,
  UniverInstanceType,
} from '@univerjs/core';
import type {
  DocumentDataModel,
  ICustomRange,
  IDisposable,
  JSONXActions,
  TextXAction,
  Univer,
} from '@univerjs/core';
import {
  DocStateChangeManagerService,
  IDocStateChangeInterceptorService,
  RichTextEditingMutation,
} from '@univerjs/docs';
import type { IDocStateChangeInfo, IRichTextEditingMutationParams } from '@univerjs/docs';

/** Only JSON1 branches are traversed; bodies and custom metadata are opaque. */
function textEdits(actions: JSONXActions): Array<{ e: TextXAction[] }> {
  const result: Array<{ e: TextXAction[] }> = [];
  const visit = (branch: unknown) => {
    if (!Array.isArray(branch)) return;
    for (const child of branch) {
      if (Array.isArray(child)) visit(child);
      else if (
        child !== null &&
        typeof child === 'object' &&
        child.et === 'text-x' &&
        Array.isArray(child.e)
      )
        result.push(child);
    }
  };
  visit(actions);
  return result;
}

/**
 * Same identity convention as native insertion/deletion: adjacent pieces of one
 * range join, disconnected pieces receive stable $n suffixes. Attribute-only
 * stock retains skip that step, including when only one suffixed piece remains.
 */
export function canonicalDocRanges(ranges: readonly ICustomRange[]): ICustomRange[] {
  // This listener must never turn a native validation failure into an RxJS
  // observer exception. Leave malformed input intact for native admission.
  if (
    ranges.some(
      (range) =>
        !range ||
        typeof range.rangeId !== 'string' ||
        !range.rangeId ||
        !Number.isSafeInteger(range.startIndex) ||
        range.startIndex < 0 ||
        !Number.isSafeInteger(range.endIndex) ||
        range.endIndex < range.startIndex,
    )
  )
    return [...ranges];
  const ordered = [...ranges].sort((a, b) => a.startIndex - b.startIndex);
  const result: ICustomRange[] = [];
  const latest = new Map<string, ICustomRange>();
  for (const range of ordered) {
    const root = range.rangeId.split('$')[0];
    const previous = latest.get(root);
    if (
      previous &&
      previous.rangeType === range.rangeType &&
      shallowEqual(previous.properties, range.properties) &&
      previous.endIndex + 1 >= range.startIndex
    )
      previous.endIndex = Math.max(previous.endIndex, range.endIndex);
    else {
      const next = { ...range, rangeId: root };
      result.push(next);
      latest.set(root, next);
    }
  }
  const count = new Map<string, number>();
  for (const range of result) {
    const root = range.rangeId;
    const ordinal = count.get(root) ?? 0;
    if (ordinal) range.rangeId = `${root}$${ordinal}`;
    count.set(root, ordinal + 1);
  }
  return result;
}

/**
 * Apply derived range identity through the public model API, before native state
 * publication. A separate JSON1 operation avoids combining a text subtype edit
 * with a replacement below that subtype: JSON1 removes before editing a parent.
 */
export function normalizeNativeDocRanges(document: DocumentDataModel): boolean {
  const snapshot = document.getSnapshot();
  let changes: JSONXActions = null;
  const body = (path: string[], ranges: ICustomRange[] | undefined) => {
    if (!Array.isArray(ranges) || !ranges.length) return;
    const next = canonicalDocRanges(ranges);
    if (
      next.length === ranges.length &&
      next.every((range, index) => shallowEqual(range, ranges[index]))
    )
      return;
    changes = JSONX.compose(
      changes,
      JSONX.getInstance().replaceOp([...path, 'customRanges'], ranges, next),
    );
  };
  body(['body'], snapshot.body?.customRanges);
  for (const kind of ['headers', 'footers', 'notes'] as const)
    for (const [id, segment] of Object.entries(snapshot[kind] ?? {}))
      body([kind, id, 'body'], segment.body?.customRanges);
  if (!changes) return false;
  document.apply(changes);
  // Flat JSON1 paths do not rebuild native cached header/footer models. Keep
  // their public snapshots aligned with the root after the derived replacement.
  const current = document.getSnapshot();
  for (const kind of ['headers', 'footers'] as const)
    for (const [id, segment] of Object.entries(current[kind] ?? {})) {
      const model = document.getSelfOrHeaderFooterModel(id);
      if (model && model.getBody() !== segment.body)
        model.reset({ ...segment, id: document.getUnitId() });
    }
  return true;
}

/**
 * A link spanning paragraph boundaries can make the native builder revisit an
 * already consumed part of an existing link. Repair only that producer shape:
 * pure retains carrying one consistent hyperlink, never mixed content edits.
 */
function repairLinkRetains(actions: TextXAction[]): TextXAction[] | undefined {
  if (!actions.some((action) => action.len < 0)) return;
  let cursor = 0;
  let consumed = 0;
  let identity: ICustomRange | undefined;
  const result: TextXAction[] = [];
  for (const action of actions) {
    if (
      action.t !== TextXActionType.RETAIN ||
      !Number.isSafeInteger(action.len) ||
      Object.keys(action).some((key) => !['t', 'len', 'body', 'coverType'].includes(key))
    )
      return;
    if (!action.body) {
      if (action.coverType !== undefined) return;
      cursor += action.len;
      if (cursor < 0) return;
      continue;
    }
    const { body } = action;
    const range = body.customRanges?.[0];
    if (
      body.dataStream !== '' ||
      Object.keys(body).some((key) => !['dataStream', 'customRanges'].includes(key)) ||
      body.customRanges?.length !== 1 ||
      !range ||
      range.rangeType !== CustomRangeType.HYPERLINK ||
      range.startIndex !== 0 ||
      range.endIndex !== action.len - 1 ||
      action.len < 1
    )
      return;
    if (
      identity &&
      (range.rangeId.split('$')[0] !== identity.rangeId.split('$')[0] ||
        range.wholeEntity !== identity.wholeEntity ||
        !shallowEqual(range.properties, identity.properties))
    )
      return;
    identity = range;
    const end = cursor + action.len;
    const start = Math.max(cursor, consumed);
    if (end > start) {
      if (start > consumed)
        result.push({ t: TextXActionType.RETAIN, len: start - consumed });
      result.push({
        ...action,
        len: end - start,
        body: {
          dataStream: '',
          customRanges: [{ ...range, startIndex: 0, endIndex: end - start - 1 }],
        },
      });
      consumed = end;
    }
    cursor = end;
  }
  return identity ? result : undefined;
}

function containsParagraphChange(actions: JSONXActions): boolean {
  return textEdits(actions).some(({ e }) =>
    e.some(
      (action) =>
        Array.isArray(action.body?.paragraphs) &&
        (action.t === TextXActionType.RETAIN || action.body.paragraphs.length > 0),
    ),
  );
}

const installed = new WeakMap<Univer, IDisposable>();

/**
 * Install once, after registering the native plugins and before creating a unit.
 * The public state interceptor must be present when Docs creates its manager.
 * Browser, confirmed and server replicas all use this boundary. Wire operations
 * remain native JSON1/TextX; normalization also runs after remote and undo edits.
 */
export function installNativeDocCompatibility(univer: Univer): IDisposable {
  const existing = installed.get(univer);
  if (existing) return existing;
  const injector = univer.__getInjector();
  let disposed = false;
  const instances = injector.get(IUniverInstanceService);
  const subscriptions = new Map<DocumentDataModel, { unsubscribe(): void }>();
  const normalizing = new Set<DocumentDataModel>();
  const watch = (document: DocumentDataModel) => {
    if (subscriptions.has(document)) return;
    const subscription = document.change$.subscribe(() => {
      if (disposed || normalizing.has(document)) return;
      normalizing.add(document);
      try {
        // change$ runs inside public apply, before Docs checks structure and
        // resets the view. Every native consumer therefore receives the same
        // canonical model, including a paragraph retain through a hyperlink.
        normalizeNativeDocRanges(document);
      } finally {
        normalizing.delete(document);
      }
    });
    subscriptions.set(document, subscription);
  };
  const added = instances
    .getTypeOfUnitAdded$<DocumentDataModel>(UniverInstanceType.UNIVER_DOC)
    .subscribe(({ unit }) => watch(unit));
  const removed = instances
    .getTypeOfUnitDisposed$<DocumentDataModel>(UniverInstanceType.UNIVER_DOC)
    .subscribe((unit) => {
      subscriptions.get(unit)?.unsubscribe();
      subscriptions.delete(unit);
    });
  for (const document of instances.getAllUnitsForType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC))
    watch(document);
  const interceptor: IDocStateChangeInterceptorService = {
    transformChangeStateInfo(state: IDocStateChangeInfo) {
      if (disposed) return state;
      if (
        !state.isSync &&
        !state.noHistory &&
        (containsParagraphChange(state.redoState.actions) ||
          containsParagraphChange(state.undoState.actions))
      ) {
        // Native compose merges paragraph REPLACE bodies with prior formatting.
        // Keep those states as their own native history group; ordinary typing
        // retains the existing debounce and bounded-history policy.
        injector.get(DocStateChangeManagerService).flushPendingChanges(state.unitId);
        return { ...state, debounce: false };
      }
      return state;
    },
  };
  injector.add([IDocStateChangeInterceptorService, { useValue: interceptor }]);
  const before = injector.get(ICommandService).beforeCommandExecuted((info, options) => {
    if (
      info.id !== RichTextEditingMutation.id ||
      options?.syncOnly ||
      options?.fromCollab ||
      options?.fromChangeset
    )
      return;
    const params = info.params as IRichTextEditingMutationParams;
    for (const edit of textEdits(params.actions)) {
      const repaired = repairLinkRetains(edit.e);
      if (repaired) edit.e = repaired;
    }
  });
  const handle: IDisposable = {
    dispose() {
      if (disposed) return;
      disposed = true;
      before.dispose();
      added.unsubscribe();
      removed.unsubscribe();
      for (const subscription of subscriptions.values()) subscription.unsubscribe();
      subscriptions.clear();
    },
  };
  installed.set(univer, handle);
  univer.onDispose(() => handle.dispose());
  return handle;
}
