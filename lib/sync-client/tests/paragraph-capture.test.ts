import {
  ICommandService,
  JSONX,
  PRESERVE_INSERTED_PARAGRAPH_IDS,
  TextXActionType,
} from '@univerjs/core';
import type { IDocumentBody, IDocumentData, TextXAction } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import { expect, test } from 'vitest';
import { captureNative, NativeReplica } from '../index.ts';
import type { ClientFailure } from '../index.ts';
import { comparable, doc, fixture } from './fixture.ts';

function lookalike() {
  return {
    t: 'i',
    len: 4,
    body: {
      dataStream: 'raw\r',
      paragraphs: [{ startIndex: 3, paragraphId: 'paragraph-1' }],
      [PRESERVE_INSERTED_PARAGRAPH_IDS]: 'opaque original value',
    },
  };
}

function opaqueProperties() {
  return {
    action: lookalike(),
    operations: [
      [
        'body',
        {
          et: 'text-x',
          e: [
            {
              t: 'i',
              len: 1,
              body: { dataStream: '\r', paragraphs: [{ startIndex: 0 }] },
            },
          ],
        },
      ],
    ],
    nested: [{ literal: 'unchanged', action: lookalike() }],
  };
}

function capture(replica: NativeReplica) {
  const mutations: Mutation[] = [];
  const failures: ClientFailure[] = [];
  const handle = captureNative({
    univer: replica.univer,
    unitId: 'doc',
    onMutation: (mutation) => mutations.push(mutation),
    onFailure: (failure) => failures.push(failure),
  });
  return { mutations, failures, dispose: () => handle.dispose() };
}

function body(replica: NativeReplica) {
  return (replica.snapshot() as IDocumentData).body!;
}

function insertion(mutation: Mutation) {
  // These actual native commands each produce one JSON1 text-x body component.
  expect(mutation.params.actions[0]).toBe('body');
  expect(mutation.params.actions[1].et).toBe('text-x');
  const actions = mutation.params.actions[1].e as TextXAction[];
  const insert = actions.find((action) => action.t === TextXActionType.INSERT);
  if (!insert) throw new Error('Expected a native TextX insertion');
  return insert.body;
}

function insertBody(properties: Record<string, unknown>): IDocumentBody {
  return {
    dataStream: 'first\rsecond\r',
    paragraphs: [{ startIndex: 5 }, { startIndex: 12, paragraphId: 'paragraph-1' }],
    customRanges: [{ startIndex: 0, endIndex: 4, rangeId: 'metadata', rangeType: 99, properties }],
  };
}

test('real native TextX inserts preserve opaque custom-range properties while realizing missing and colliding paragraph IDs once', async () => {
  const f = fixture(doc(), 'doc');
  const local = new NativeReplica(doc(), 'doc');
  const peer = new NativeReplica(doc(), 'doc');
  const sink = capture(local);
  const echoed = capture(peer);
  const properties = opaqueProperties();
  const bytes = JSON.stringify(properties);
  try {
    expect(
      await local.univer
        .__getInjector()
        .get(ICommandService)
        .executeCommand('doc.command.insert-text', {
          unitId: 'doc',
          segmentId: '',
          range: { startOffset: 2, endOffset: 2, collapsed: true },
          body: insertBody(properties),
          debounce: false,
        }),
    ).toBe(true);
    expect(sink.failures).toEqual([]);
    expect(sink.mutations).toHaveLength(1);
    const sentBody = insertion(sink.mutations[0]);
    const ids = sentBody.paragraphs!.map((paragraph) => paragraph.paragraphId);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0 && id !== 'paragraph-1')).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(2);
    expect(sentBody).toHaveProperty(PRESERVE_INSERTED_PARAGRAPH_IDS, true);
    expect(body(local).paragraphs!.map((paragraph) => paragraph.paragraphId)).toEqual([
      ...ids,
      'paragraph-1',
    ]);
    expect(JSON.stringify(body(local).customRanges![0].properties)).toBe(bytes);
    expect(JSON.stringify(sentBody.customRanges![0].properties)).toBe(bytes);
    expect(JSON.stringify(properties)).toBe(bytes);
    const immutable = structuredClone(sink.mutations);
    peer.apply(sink.mutations);
    expect(sink.mutations).toEqual(immutable);
    expect(comparable(peer.snapshot())).toEqual(comparable(local.snapshot()));
    expect(JSON.stringify(body(peer).customRanges![0].properties)).toBe(bytes);
    expect(echoed.mutations).toEqual([]);
    expect(echoed.failures).toEqual([]);
    await f.accept({
      type: 'submit',
      mutationId: '00000000-0000-4000-8000-000000000001',
      baseRevision: 1,
      mutations: sink.mutations,
    });
    const stored = f.storage.unit.snapshot as IDocumentData;
    expect(JSON.stringify(stored.body!.customRanges![0].properties)).toBe(bytes);
    f.server.invalidate('doc');
    const reopened = f.server.load('doc', undefined).snapshot as IDocumentData;
    expect(JSON.stringify(reopened.body!.customRanges![0].properties)).toBe(bytes);
    expect(comparable(reopened)).toEqual(comparable(local.snapshot()));
  } finally {
    sink.dispose();
    echoed.dispose();
    local.dispose();
    peer.dispose();
    f.close();
  }
});

test('an actual native JSON1 object insertion never interprets its opaque payload as a TextX action', async () => {
  const snapshot = doc();
  snapshot.body!.customRanges = [
    {
      startIndex: 0,
      endIndex: 4,
      rangeId: 'metadata',
      rangeType: 99,
      properties: { kept: 'literal' },
    },
  ];
  const f = fixture(snapshot, 'doc');
  const local = new NativeReplica(snapshot, 'doc');
  const peer = new NativeReplica(snapshot, 'doc');
  const sink = capture(local);
  const payload = { ...lookalike(), nested: opaqueProperties() };
  const bytes = JSON.stringify(payload);
  const actions = JSONX.getInstance().insertOp(
    ['body', 'customRanges', 0, 'properties', 'payload'],
    payload,
  );
  const mutation = {
    id: 'doc.mutation.rich-text-editing',
    params: { unitId: 'doc', actions, textRanges: [] },
  };
  try {
    expect(
      local.univer
        .__getInjector()
        .get(ICommandService)
        .syncExecuteCommand(mutation.id, mutation.params),
    ).toBeTruthy();
    expect(sink.failures).toEqual([]);
    expect(sink.mutations).toHaveLength(1);
    expect(JSON.stringify(body(local).customRanges![0].properties!.payload)).toBe(bytes);
    expect(sink.mutations[0].params.actions).toEqual(actions);
    peer.apply(sink.mutations);
    expect(JSON.stringify(body(peer).customRanges![0].properties!.payload)).toBe(bytes);
    expect(comparable(peer.snapshot())).toEqual(comparable(local.snapshot()));
    await f.accept({
      type: 'submit',
      mutationId: '00000000-0000-4000-8000-000000000001',
      baseRevision: 1,
      mutations: sink.mutations,
    });
    const stored = f.storage.unit.snapshot as IDocumentData;
    expect(JSON.stringify(stored.body!.customRanges![0].properties!.payload)).toBe(bytes);
    f.server.invalidate('doc');
    const reopened = f.server.load('doc', undefined).snapshot as IDocumentData;
    expect(JSON.stringify(reopened.body!.customRanges![0].properties!.payload)).toBe(bytes);
    expect(comparable(reopened)).toEqual(comparable(local.snapshot()));
  } finally {
    sink.dispose();
    local.dispose();
    peer.dispose();
    f.close();
  }
});

test('syncOnly captures already-realized native paragraph IDs without changing opaque properties or applying the edit twice', () => {
  const local = new NativeReplica(doc(), 'doc');
  const peer = new NativeReplica(doc(), 'doc');
  const sink = capture(local);
  const properties = opaqueProperties();
  const bytes = JSON.stringify(properties);
  const inserted = insertBody(properties);
  const params = {
    unitId: 'doc',
    textRanges: [],
    actions: JSONX.getInstance().editOp([
      { t: TextXActionType.INSERT, len: inserted.dataStream.length, body: inserted },
    ]),
  };
  const commands = local.univer.__getInjector().get(ICommandService);
  try {
    // The producer executes the real native handler first, which realizes IDs.
    commands.syncExecuteCommand('doc.mutation.rich-text-editing', params, { onlyLocal: true });
    expect(sink.mutations).toEqual([]);
    const realized = insertion({ id: 'doc.mutation.rich-text-editing', params });
    const ids = realized.paragraphs!.map((paragraph) => paragraph.paragraphId);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(body(local).paragraphs!.map((paragraph) => paragraph.paragraphId)).toEqual([
      ...ids,
      'paragraph-1',
    ]);
    expect(JSON.stringify(body(local).customRanges![0].properties)).toBe(bytes);
    const before = local.snapshot();
    const immutable = structuredClone(params);
    commands.syncExecuteCommand('doc.mutation.rich-text-editing', params, { syncOnly: true });
    expect(local.snapshot()).toEqual(before);
    expect(params).toEqual(immutable);
    expect(sink.failures).toEqual([]);
    expect(sink.mutations).toHaveLength(1);
    const sentBody = insertion(sink.mutations[0]);
    expect(sentBody.paragraphs!.map((paragraph) => paragraph.paragraphId)).toEqual(ids);
    expect(sentBody).toHaveProperty(PRESERVE_INSERTED_PARAGRAPH_IDS, true);
    expect(JSON.stringify(sentBody.customRanges![0].properties)).toBe(bytes);
    peer.apply(sink.mutations);
    expect(comparable(peer.snapshot())).toEqual(comparable(local.snapshot()));
  } finally {
    sink.dispose();
    local.dispose();
    peer.dispose();
  }
});

test('syncOnly still refuses a genuine insertion whose producer has not realized its paragraph IDs', () => {
  const local = new NativeReplica(doc(), 'doc');
  const sink = capture(local);
  const params = {
    unitId: 'doc',
    actions: JSONX.getInstance().editOp([
      {
        t: TextXActionType.INSERT,
        len: 1,
        body: { dataStream: '\r', paragraphs: [{ startIndex: 0 }] },
      },
    ]),
  };
  const immutable = structuredClone(params);
  try {
    const before = local.snapshot();
    local.univer
      .__getInjector()
      .get(ICommandService)
      .syncExecuteCommand('doc.mutation.rich-text-editing', params, { syncOnly: true });
    expect(sink.mutations).toEqual([]);
    expect(sink.failures).toEqual(['malformed']);
    expect(params).toEqual(immutable);
    expect(local.snapshot()).toEqual(before);
  } finally {
    sink.dispose();
    local.dispose();
  }
});
