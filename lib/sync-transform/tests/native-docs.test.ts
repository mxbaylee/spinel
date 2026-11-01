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
import { canonicalDocRanges, installNativeDocCompatibility } from '../src/native-docs.ts';

afterEach(() => vi.useRealTimers());

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

function fixture(body?: IDocumentBody, compatibility = true, segments?: Partial<IDocumentData>) {
  const univer = new Univer({ locale: LocaleType.EN_US });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin);
  const policy = compatibility ? installNativeDocCompatibility(univer) : undefined;
  const snapshot: IDocumentData = {
    ...getDocsEmptySnapshot('doc'),
    ...(body ? { body: structuredClone(body) } : {}),
    ...structuredClone(segments),
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

test('stock TextX retains the native range and paragraph failures the boundary handles', () => {
  const bold = new TextX()
    .retain(4)
    .retain(2, { dataStream: '', textRuns: [{ st: 0, ed: 2, ts: { bl: 1 } }] })
    .serialize();
  expect(rangeValues(TextX.apply(linked(), structuredClone(bold)))).not.toEqual([['L', 3, 8]]);
  const first = new TextX()
    .retain(1, { dataStream: '', paragraphs: [paragraph] }, UpdateDocsAttributeType.REPLACE)
    .serialize();
  const second = new TextX()
    .retain(
      1,
      { dataStream: '', paragraphs: [update({ startIndex: 0 })] },
      UpdateDocsAttributeType.REPLACE,
    )
    .serialize();
  const base = {
    dataStream: '\r\n',
    paragraphs: [{ startIndex: 0, paragraphId: 'stable-paragraph' }],
  };
  const sequential = TextX.apply(TextX.apply(structuredClone(base), first), second);
  const composed = TextX.apply(structuredClone(base), TextX.compose(first, second));
  expect(composed).not.toEqual(sequential);
  expect(composed.paragraphs![0].bullet?.listId).toBe('list');
});

test.each(['style', 'paragraph', 'lone suffix inside', 'lone suffix outside'])(
  'native %s edits publish and persist canonical ranges, including undo and redo',
  async (kind) => {
    const f = fixture(linked([[kind.startsWith('lone suffix') ? 'L$1' : 'L', 3, 8]]));
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
          : kind === 'lone suffix outside'
            ? new TextX()
                .retain(1, { dataStream: '', textRuns: [{ st: 0, ed: 1, ts: { bl: 1 } }] })
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
] as const)(
  'native link producer %i..%i has monotone captured retains and reversible results',
  async (startOffset, endOffset, expected) => {
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
      if (!text) throw new Error('Expected the native hyperlink builder to produce an edit.');
      const params = f.apply(text.serialize());
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
  },
);

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
    expect(rangeValues(after)).toEqual([
      ['L', 3, 4],
      ['L$1', 6, 8],
    ]);
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
])(
  'native paragraph REPLACE retains sequential meaning and identity through history: %j',
  async (replacement) => {
    const base: IDocumentBody = {
      dataStream: '\r\n',
      paragraphs: [{ startIndex: 0, paragraphId: 'stable-paragraph' }],
    };
    const f = fixture(base);
    try {
      f.apply(
        new TextX()
          .retain(
            1,
            { dataStream: '', paragraphs: [structuredClone(paragraph)] },
            UpdateDocsAttributeType.REPLACE,
          )
          .serialize(),
      );
      const first = f.body();
      f.apply(
        new TextX()
          .retain(
            1,
            { dataStream: '', paragraphs: [update(replacement)] },
            UpdateDocsAttributeType.REPLACE,
          )
          .serialize(),
      );
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
  },
);

test.each([undefined, [], [update({ startIndex: 1 })]])(
  'native explicit paragraph arrays and absent arrays retain sequential semantics: %j',
  async (updates) => {
    const base: IDocumentBody = {
      dataStream: '\r\r\n',
      paragraphs: [{ ...paragraph }, { ...paragraph, startIndex: 1, paragraphId: 'second' }],
    };
    const f = fixture(base);
    try {
      const first = new TextX()
        .retain(
          2,
          { dataStream: '', paragraphs: structuredClone(base.paragraphs) },
          UpdateDocsAttributeType.REPLACE,
        )
        .serialize();
      const second = new TextX()
        .retain(
          2,
          { dataStream: '', ...(updates ? { paragraphs: updates } : {}) },
          UpdateDocsAttributeType.REPLACE,
        )
        .serialize();
      const sequential = TextX.apply(
        TextX.apply(structuredClone(base), structuredClone(first)),
        structuredClone(second),
      );
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

test('native paragraph COVER preserves list, heading and identity while changing one style key', async () => {
  const f = fixture({ dataStream: '\r\n', paragraphs: [structuredClone(paragraph)] });
  try {
    f.apply(
      new TextX()
        .retain(
          1,
          {
            dataStream: '',
            paragraphs: [update({ startIndex: 0, paragraphStyle: { outlineLevel: 1 } })],
          },
          UpdateDocsAttributeType.COVER,
        )
        .serialize(),
    );
    expect(f.body().paragraphs![0]).toMatchObject({
      paragraphId: 'stable-paragraph',
      bullet: { listId: 'list', listType: 'BULLET_LIST', nestingLevel: 0 },
      paragraphStyle: { namedStyleType: 4, headingId: 'heading', outlineLevel: 1 },
    });
    const after = f.body();
    await f.undo();
    expect(f.body().paragraphs).toEqual([paragraph]);
    await f.redo();
    expect(f.body()).toEqual(after);
  } finally {
    f.close();
  }
});

test('ordinary native typing keeps one debounced group and installation is idempotent', async () => {
  const f = fixture();
  try {
    expect(installNativeDocCompatibility(f.univer)).toBe(f.policy);
    for (const letter of 'phrase')
      f.apply(
        new TextX()
          .retain(f.body().dataStream.length - 2)
          .insert(1, { dataStream: letter })
          .serialize(),
      );
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
  const base = linked([
    ['L$3', 7, 8],
    ['L', 0, 1],
    ['L$2', 1, 2],
  ]).customRanges!;
  base.forEach((range) => (range.properties = opaque));
  const next = canonicalDocRanges(base);
  expect(next.map(({ rangeId, startIndex, endIndex }) => [rangeId, startIndex, endIndex])).toEqual([
    ['L', 0, 2],
    ['L$1', 7, 8],
  ]);
  expect(next.every((range) => range.properties === opaque)).toBe(true);
  expect(base[0].rangeId).toBe('L$3');
});

test.each(['headers', 'footers', 'notes'] as const)(
  'successive %s mutations keep the persisted segment and native cached model aligned',
  async (kind) => {
    const id = 'segment';
    const segmentBody = { ...linked(), customBlocks: [] };
    const segment =
      kind === 'headers'
        ? { headerId: id, body: segmentBody }
        : kind === 'footers'
          ? { footerId: id, body: segmentBody }
          : { noteId: id, type: 'footnote' as const, showBodyReference: false, body: segmentBody };
    const f = fixture(undefined, true, { [kind]: { [id]: segment } });
    const current = () => f.model.getSelfOrHeaderFooterModel(id)!.getBody()!;
    const saved = () => f.model.getSnapshot()[kind]![id].body;
    const apply = (text: TextX) =>
      f.apply([], {
        segmentId: id,
        actions: JSONX.getInstance().editOp(text.serialize(), [kind, id, 'body']),
      });
    try {
      apply(
        new TextX()
          .retain(4)
          .retain(2, { dataStream: '', textRuns: [{ st: 0, ed: 2, ts: { bl: 1 } }] }),
      );
      expect(rangeValues(saved())).toEqual([['L', 3, 8]]);
      expect(current()).toEqual(saved());
      apply(
        new TextX().retain(6).retain(1, {
          dataStream: '',
          paragraphs: [update({ startIndex: 0, paragraphStyle: { indentStart: { v: 12 } } })],
        }),
      );
      expect(rangeValues(saved())).toEqual([['L', 3, 8]]);
      expect(current()).toEqual(saved());
      const beforeInsert = structuredClone(saved());
      apply(new TextX().retain(4).insert(1, { dataStream: 'X' }));
      const afterInsert = structuredClone(saved());
      expect(afterInsert.dataStream).toBe('abcdXef\rghij\r\n');
      expect(rangeValues(afterInsert)).toEqual([
        ['L', 3, 3],
        ['L$1', 5, 9],
      ]);
      expect(current()).toEqual(saved());
      await f.undo();
      expect(saved()).toEqual(beforeInsert);
      expect(current()).toEqual(saved());
      await f.redo();
      expect(saved()).toEqual(afterInsert);
      expect(current()).toEqual(saved());
      expect(f.model.getBody()!.dataStream).toBe('\r\n');
    } finally {
      f.close();
    }
  },
);

test('native structure validation still rejects and rolls back an invalid field without changing link identity', async () => {
  const f = fixture(linked());
  try {
    // Materialize the SDK's ordinary empty collections before comparing the
    // failure rollback, so the assertion measures content and exact native data.
    f.apply(new TextX().retain(1, { dataStream: '', textRuns: [] }).serialize(), {
      noHistory: true,
    });
    const before = f.body();
    const invalid = new TextX()
      .retain(3)
      .retain(
        6,
        {
          dataStream: '',
          // Include the existing paragraph at its relative offset so this uses
          // native structural validation, which checks field tokens.
          paragraphs: [{ ...before.paragraphs![0], startIndex: 3 }],
          customRanges: [
            {
              rangeId: 'invalid-field',
              rangeType: CustomRangeType.FIELD,
              startIndex: 0,
              endIndex: 5,
            },
          ],
        },
        UpdateDocsAttributeType.REPLACE,
      )
      .serialize();
    expect(() => f.apply(invalid)).toThrow(/DocStructure.*custom-range-token-mismatch/);
    expect(f.body()).toEqual(before);
    expect(f.manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });
    // RxJS reports escaped observer exceptions on a later timer. Let that turn
    // run: the rejected native mutation must not leave an unhandled failure.
    await vi.advanceTimersByTimeAsync(0);
  } finally {
    f.close();
  }
});

test('the public model observer leaves malformed range shapes intact without asynchronous exceptions', async () => {
  const f = fixture(linked());
  const original = structuredClone(f.model.getBody()!.customRanges);
  const range = original![0];
  try {
    for (const malformed of [
      'not-an-array',
      { length: 1 },
      [null],
      [42],
      ['not-a-range'],
      [{ ...range, rangeId: 42 }],
      [{ ...range, rangeId: '' }],
      [{ ...range, rangeId: '$1' }],
      [{ ...range, startIndex: -1 }],
      [{ ...range, endIndex: 8.5 }],
    ]) {
      f.model.apply(
        JSONX.getInstance().replaceOp(
          ['body', 'customRanges'],
          f.model.getBody()!.customRanges,
          malformed,
        ),
      );
      expect(f.model.getBody()!.customRanges).toEqual(malformed);
      await vi.advanceTimersByTimeAsync(0);
      f.model.apply(
        JSONX.getInstance().replaceOp(
          ['body', 'customRanges'],
          malformed,
          structuredClone(original),
        ),
      );
      expect(f.model.getBody()!.customRanges).toEqual(original);
    }
  } finally {
    f.close();
  }
});

test('negative-retain repair does not rewrite mixed edits, remote operations or opaque metadata', () => {
  const f = fixture(linked());
  const produced = BuildTextUtils.customRange.add({
    ranges: [{ startOffset: 0, endOffset: 10, collapsed: false }],
    rangeId: 'N',
    rangeType: CustomRangeType.HYPERLINK,
    properties: { url: 'https://new.test' },
    body: linked(),
  });
  if (!produced) throw new Error('Expected the native hyperlink builder to produce an edit.');
  const raw = produced.serialize();
  expect(raw.some((action) => action.len < 0)).toBe(true);
  const stop = new Error('observe before the native handler');
  const observer = f.commands.beforeCommandExecuted((info) => {
    if (info.id === RichTextEditingMutation.id) throw stop;
  });
  try {
    for (const execution of [{ fromCollab: true }, { fromChangeset: true }, { syncOnly: true }]) {
      const params = {
        unitId: 'doc',
        actions: JSONX.getInstance().editOp(structuredClone(raw)),
        textRanges: null,
      };
      const before = structuredClone(params.actions);
      expect(() =>
        f.commands.syncExecuteCommand(RichTextEditingMutation.id, params, execution),
      ).toThrow(stop);
      expect(params.actions).toEqual(before);
    }
    const mixed = structuredClone(raw);
    mixed.push(...new TextX().insert(1, { dataStream: 'X' }).serialize());
    const params = { unitId: 'doc', actions: JSONX.getInstance().editOp(mixed), textRanges: null };
    const before = structuredClone(params.actions);
    expect(() => f.commands.syncExecuteCommand(RichTextEditingMutation.id, params)).toThrow(stop);
    expect(params.actions).toEqual(before);

    const opaque = { nested: { et: 'text-x', e: structuredClone(raw) } };
    const opaqueParams = {
      unitId: 'doc',
      actions: JSONX.getInstance().editOp(
        new TextX()
          .retain(1, {
            dataStream: '',
            customRanges: [
              { ...linked().customRanges![0], startIndex: 0, endIndex: 0, properties: opaque },
            ],
          })
          .serialize(),
      ),
      textRanges: null,
    };
    const opaqueBefore = structuredClone(opaqueParams.actions);
    expect(() => f.commands.syncExecuteCommand(RichTextEditingMutation.id, opaqueParams)).toThrow(
      stop,
    );
    expect(opaqueParams.actions).toEqual(opaqueBefore);
    expect(f.body()).toEqual(linked());
  } finally {
    observer.dispose();
    f.close();
  }
});

test('late installation fails before creating a partial native compatibility boundary', () => {
  const f = fixture(undefined, false);
  try {
    expect(() => installNativeDocCompatibility(f.univer)).toThrow(/before creating any units/);
  } finally {
    f.close();
  }
});

test('an already resolved native manager refuses installation without leaving model subscriptions', () => {
  const univer = new Univer({ locale: LocaleType.EN_US });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin);
  const injector = univer.__getInjector();
  const manager = injector.get(DocStateChangeManagerService);
  try {
    expect(() => installNativeDocCompatibility(univer)).toThrow(/already resolved/);
    expect(injector.get(DocStateChangeManagerService)).toBe(manager);
    univer.createUnit(UniverInstanceType.UNIVER_DOC, {
      ...getDocsEmptySnapshot('doc'),
      body: linked([['L$1', 3, 8]]),
    });
    const model = injector
      .get(IUniverInstanceService)
      .getUnit<DocumentDataModel>('doc', UniverInstanceType.UNIVER_DOC)!;
    // A failed installation must not later normalize documents through a
    // stranded unitAdded/change subscription.
    expect(rangeValues(model.getBody()!)).toEqual([['L$1', 3, 8]]);
  } finally {
    univer.dispose();
  }
});
