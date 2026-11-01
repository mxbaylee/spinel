import { createRequire } from 'node:module';
import {
  BuildTextUtils,
  CustomRangeType,
  getDocsEmptySnapshot,
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  JSONX,
  LocaleType,
  TextX,
  Univer,
  UniverInstanceType,
  UpdateDocsAttributeType,
} from '@univerjs/core';
import type {
  DocumentDataModel,
  IDocumentBody,
  IDocumentData,
  IParagraph,
  TextXAction,
} from '@univerjs/core';
import {
  DocStateChangeManagerService,
  RichTextEditingMutation,
  UniverDocsPlugin,
} from '@univerjs/docs';
import type { IRichTextEditingMutationParams } from '@univerjs/docs';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { afterEach, expect, test, vi } from 'vitest';
import {
  canonicalDocRanges,
  installNativeDocCompatibility,
} from '../src/native-docs.ts';

afterEach(() => vi.useRealTimers());

const require = createRequire(import.meta.url);
const builds = [
  { name: 'es', core: { BuildTextUtils, TextX } },
  { name: 'cjs', core: require('@univerjs/core') as typeof import('@univerjs/core') },
];

const paragraph: IParagraph = {
  startIndex: 0,
  paragraphId: 'stable-paragraph',
  bullet: { listId: 'list', listType: 'BULLET_LIST', nestingLevel: 0 },
  paragraphStyle: { namedStyleType: 4, outlineLevel: 0, headingId: 'heading' },
};
const update = (value: Omit<IParagraph, 'paragraphId'> & { paragraphId?: string }) =>
  value as IParagraph;
const linked = (ranges: [string, number, number][] = [['L', 3, 8]]): IDocumentBody => ({
  dataStream: 'abcdef\rghij\r\n',
  paragraphs: [
    { startIndex: 6, paragraphId: 'p1' },
    { startIndex: 11, paragraphId: 'p2' },
  ],
  sectionBreaks: [{ startIndex: 12, sectionId: 's1' }],
  customRanges: ranges.map(([rangeId, startIndex, endIndex]) => ({
    rangeId,
    rangeType: CustomRangeType.HYPERLINK,
    startIndex,
    endIndex,
    properties: { url: 'https://example.test' },
  })),
});
const rangeValues = (body: IDocumentBody) =>
  body.customRanges?.map(({ rangeId, startIndex, endIndex }) => [rangeId, startIndex, endIndex]);

function fixture(body?: IDocumentBody, compatibility = true) {
  const univer = new Univer({ locale: LocaleType.EN_US });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin);
  const policy = compatibility ? installNativeDocCompatibility(univer) : undefined;
  const snapshot: IDocumentData = {
    ...getDocsEmptySnapshot('doc'),
    ...(body ? { body: structuredClone(body) } : {}),
  };
  univer.createUnit(UniverInstanceType.UNIVER_DOC, snapshot);
  const injector = univer.__getInjector();
  const instances = injector.get(IUniverInstanceService);
  instances.focusUnit('doc');
  const model = instances.getUnit<DocumentDataModel>('doc', UniverInstanceType.UNIVER_DOC)!;
  const commands = injector.get(ICommandService);
  const manager = injector.get(DocStateChangeManagerService);
  const history = injector.get(IUndoRedoService);
  const published: IRichTextEditingMutationParams[] = [];
  commands.onMutationExecutedForCollab((info) => {
    if (info.id === RichTextEditingMutation.id)
      published.push(structuredClone(info.params as IRichTextEditingMutationParams));
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return {
    univer,
    model,
    commands,
    manager,
    history,
    policy,
    published,
    body: () => structuredClone(model.getBody()!),
    apply(actions: TextXAction[], options: Partial<IRichTextEditingMutationParams> = {}) {
      const params = {
        unitId: 'doc',
        trigger: 'native-docs-test',
        actions: JSONX.getInstance().editOp(structuredClone(actions)),
        textRanges: null,
        noNeedSetTextRange: true,
        debounce: true,
        ...options,
      };
      expect(commands.syncExecuteCommand(RichTextEditingMutation.id, params)).toBeTruthy();
      return params;
    },
    async undo() {
      expect(await commands.executeCommand('univer.command.undo', { unitId: 'doc' })).toBe(true);
    },
    async redo() {
      expect(await commands.executeCommand('univer.command.redo', { unitId: 'doc' })).toBe(true);
    },
    close() {
      univer.dispose();
    },
  };
}

test('stock ES and CJS retain the native range and paragraph failures the boundary handles', () => {
  for (const { name, core } of builds) {
    const bold = new core.TextX()
      .retain(4)
      .retain(2, { dataStream: '', textRuns: [{ st: 0, ed: 2, ts: { bl: 1 } }] })
      .serialize();
    expect(rangeValues(core.TextX.apply(linked(), structuredClone(bold))), name).not.toEqual([
      ['L', 3, 8],
    ]);
    const first = new core.TextX()
      .retain(1, { dataStream: '', paragraphs: [paragraph] }, UpdateDocsAttributeType.REPLACE)
      .serialize();
    const second = new core.TextX()
      .retain(
        1,
        { dataStream: '', paragraphs: [update({ startIndex: 0 })] },
        UpdateDocsAttributeType.REPLACE,
      )
      .serialize();
    const base = { dataStream: '\r\n', paragraphs: [{ startIndex: 0, paragraphId: 'stable-paragraph' }] };
    const sequential = core.TextX.apply(core.TextX.apply(structuredClone(base), first), second);
    const composed = core.TextX.apply(structuredClone(base), core.TextX.compose(first, second));
    expect(composed, name).not.toEqual(sequential);
    expect(composed.paragraphs![0].bullet?.listId, name).toBe('list');
  }
});

test.each(['style', 'paragraph', 'lone suffix'])(
  'native %s edits publish and persist canonical ranges, including undo and redo',
  async (kind) => {
    const f = fixture(linked([[kind === 'lone suffix' ? 'L$1' : 'L', 3, 8]]));
    try {
      const actions =
        kind === 'paragraph'
          ? new TextX()
              .retain(6)
              .retain(1, {
                dataStream: '',
                paragraphs: [update({ startIndex: 0, paragraphStyle: { indentStart: { v: 10 } } })],
              })
              .serialize()
          : new TextX()
              .retain(4)
              .retain(2, { dataStream: '', textRuns: [{ st: 0, ed: 2, ts: { bl: 1 } }] })
              .serialize();
      let observed: unknown;
      f.commands.onMutationExecutedForCollab(() => (observed = rangeValues(f.model.getBody()!)));
      f.apply(actions);
      expect(rangeValues(f.body())).toEqual([['L', 3, 8]]);
      expect(observed).toEqual([['L', 3, 8]]);
      await f.undo();
      expect(rangeValues(f.body())).toEqual([['L', 3, 8]]);
      await f.redo();
      expect(rangeValues(f.body())).toEqual([['L', 3, 8]]);
    } finally {
      f.close();
    }
  },
);

test.each([
  [0, 10, [['N', 0, 9]]],
  [4, 10, [['N', 3, 9]]],
  [7, 8, [['N', 3, 8]]],
] as const)('native link producer %i..%i has monotone captured retains and reversible results', async (startOffset, endOffset, expected) => {
  const f = fixture(linked());
  try {
    const text = BuildTextUtils.customRange.add({
      ranges: [{ startOffset, endOffset, collapsed: false }],
      rangeId: 'N',
      rangeType: CustomRangeType.HYPERLINK,
      properties: { url: 'https://new.test' },
      body: f.body(),
    });
    expect(text).toBeTruthy();
    const params = f.apply(text!.serialize());
    const edits = (params.actions as any[])[1].e as TextXAction[];
    expect(edits.every((action) => action.len >= 0)).toBe(true);
    expect(rangeValues(f.body())).toEqual(expected);
    expect(f.published[0].actions).toEqual(params.actions);
    await f.undo();
    expect(rangeValues(f.body())).toEqual([['L', 3, 8]]);
    await f.redo();
    expect(rangeValues(f.body())).toEqual(expected);
  } finally {
    f.close();
  }
});

test('compound style, deletion, insertion and link metadata preserve native disconnected identity', async () => {
  const f = fixture(linked());
  try {
    const actions = new TextX()
      .retain(4)
      .retain(1, { dataStream: '', textRuns: [{ st: 0, ed: 1, ts: { bl: 1 } }] })
      .delete(1)
      .insert(1, { dataStream: 'X' })
      .retain(2)
      .retain(1, {
        dataStream: '',
        customRanges: [{ ...linked().customRanges![0], startIndex: 0, endIndex: 0 }],
      })
      .serialize();
    f.apply(actions);
    const after = f.body();
    expect(after.dataStream).toBe('abcdeX\rghij\r\n');
    // The inserted X carries no link. Its gap must remain visible in the range
    // representation even though the neighboring runs share one root identity.
    expect(rangeValues(after)).toEqual([['L', 3, 4], ['L$1', 6, 8]]);
    await f.undo();
    expect(f.body().dataStream).toBe(linked().dataStream);
    expect(rangeValues(f.body())).toEqual([['L', 3, 8]]);
    await f.redo();
    expect(f.body()).toEqual(after);
  } finally {
    f.close();
  }
});

test.each([
  { startIndex: 0 },
  { startIndex: 0, paragraphStyle: {} },
  { startIndex: 0, paragraphStyle: { outlineLevel: 1 } },
  { startIndex: 0, paragraphId: 'replacement-id' },
])('native paragraph REPLACE retains sequential meaning and identity through history: %j', async (replacement) => {
  const base: IDocumentBody = {
    dataStream: '\r\n',
    paragraphs: [{ startIndex: 0, paragraphId: 'stable-paragraph' }],
  };
  const f = fixture(base);
  try {
    f.apply(new TextX().retain(1, { dataStream: '', paragraphs: [structuredClone(paragraph)] }, UpdateDocsAttributeType.REPLACE).serialize());
    const first = f.body();
    f.apply(new TextX().retain(1, { dataStream: '', paragraphs: [update(replacement)] }, UpdateDocsAttributeType.REPLACE).serialize());
    const second = f.body();
    expect(second.paragraphs![0].bullet).toBeUndefined();
    expect(second.paragraphs![0].paragraphStyle?.headingId).toBeUndefined();
    expect(second.paragraphs![0].paragraphId).toBe(replacement.paragraphId ?? 'stable-paragraph');
    expect(f.manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });
    expect(f.history.getUndoRedoStatus('doc').undos).toBe(2);
    await f.undo();
    expect(f.body()).toEqual(first);
    await f.undo();
    expect(f.body().paragraphs).toEqual(base.paragraphs);
    await f.redo();
    expect(f.body()).toEqual(first);
    await f.redo();
    expect(f.body()).toEqual(second);
  } finally {
    f.close();
  }
});

test.each([undefined, [], [update({ startIndex: 1 })]])(
  'native explicit paragraph arrays and absent arrays retain sequential semantics: %j',
  async (updates) => {
    const base: IDocumentBody = {
      dataStream: '\r\r\n',
      paragraphs: [{ ...paragraph }, { ...paragraph, startIndex: 1, paragraphId: 'second' }],
    };
    const f = fixture(base);
    try {
      const first = new TextX().retain(2, { dataStream: '', paragraphs: structuredClone(base.paragraphs) }, UpdateDocsAttributeType.REPLACE).serialize();
      const second = new TextX().retain(2, { dataStream: '', ...(updates ? { paragraphs: updates } : {}) }, UpdateDocsAttributeType.REPLACE).serialize();
      const sequential = TextX.apply(TextX.apply(structuredClone(base), structuredClone(first)), structuredClone(second));
      f.apply(first);
      f.apply(second);
      expect(f.body().paragraphs).toEqual(sequential.paragraphs);
      const after = f.body();
      await f.undo();
      await f.redo();
      expect(f.body()).toEqual(after);
    } finally {
      f.close();
    }
  },
);

test('ordinary native typing keeps one debounced group and installation is idempotent', async () => {
  const f = fixture();
  try {
    expect(installNativeDocCompatibility(f.univer)).toBe(f.policy);
    for (const letter of 'phrase')
      f.apply(new TextX().retain(f.body().dataStream.length - 2).insert(1, { dataStream: letter }).serialize());
    expect(f.manager.getStateCache('doc').history).toHaveLength(6);
    expect(f.history.getUndoRedoStatus('doc').undos).toBe(0);
    await f.undo();
    expect(f.body().dataStream).toBe('\r\n');
    await f.redo();
    expect(f.body().dataStream).toBe('phrase\r\n');
  } finally {
    f.close();
  }
});

test('canonical range joining preserves opaque properties and disconnected identities', () => {
  const opaque = { nested: { arrays: [{ et: 'text-x', e: [{ t: 'r', len: -4 }] }] } };
  const base = linked([['L$3', 7, 8], ['L', 0, 1], ['L$2', 1, 2]]).customRanges!;
  base.forEach((range) => (range.properties = opaque));
  const next = canonicalDocRanges(base);
  expect(next.map(({ rangeId, startIndex, endIndex }) => [rangeId, startIndex, endIndex])).toEqual([
    ['L', 0, 2],
    ['L$1', 7, 8],
  ]);
  expect(next.every((range) => range.properties === opaque)).toBe(true);
  expect(base[0].rangeId).toBe('L$3');
});
