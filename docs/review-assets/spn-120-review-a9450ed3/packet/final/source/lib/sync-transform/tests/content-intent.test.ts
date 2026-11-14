import { JSONX } from '@univerjs/core';
import { expect, test } from 'vitest';
import { docIds } from '../src/docs.ts';
import { structureIds } from '../src/structure.ts';
import { ContentIntent, contentState } from './content-intent.ts';
import { seededDoc } from './generate-docs.ts';
import { seededWorkbook } from './generate.ts';
import { Replica } from './harness.ts';

const insert = (text: string) => [
  {
    id: docIds.richText,
    params: {
      unitId: 'doc',
      actions: JSONX.getInstance().editOp([
        { t: 'i', len: text.length, body: { dataStream: text } },
      ] as never),
      textRanges: [],
    },
  },
];
const remove = (length: number) => [
  {
    id: docIds.richText,
    params: {
      unitId: 'doc',
      actions: JSONX.getInstance().editOp([{ t: 'd', len: length }] as never),
      textRanges: [],
    },
  },
];

test('equal replicas cannot silently reverse untouched Doc characters', () => {
  const source = new Replica({ doc: seededDoc() });
  const server = new Replica({ doc: seededDoc() });
  const other = new Replica({ doc: seededDoc() });
  try {
    for (const replica of [source, server, other]) replica.apply(insert('\uE001\uE002'));
    const oracle = new ContentIntent(server);
    oracle.record('unchanged', contentState(source), contentState(source), source);
    for (const replica of [server, other]) {
      replica.apply(remove(2));
      replica.apply(insert('\uE002\uE001'));
    }
    expect(server.snapshot()).toEqual(other.snapshot());
    expect(() => oracle.accept('unchanged', server)).toThrow('surviving Doc character order');
  } finally {
    for (const replica of [source, server, other]) replica.univer.dispose();
  }
});

test('an inserted Doc character keeps the sender’s observed anchors', () => {
  const source = new Replica({ doc: seededDoc() });
  const server = new Replica({ doc: seededDoc() });
  try {
    for (const replica of [source, server]) replica.apply(insert('\uE001\uE002'));
    const oracle = new ContentIntent(server);
    const before = contentState(source);
    source.apply(insert('\uE003'));
    oracle.record('insert-first', before, contentState(source), source);
    server.apply([
      {
        id: docIds.richText,
        params: {
          unitId: 'doc',
          actions: JSONX.getInstance().editOp([
            { t: 'r', len: 2 },
            { t: 'i', len: 1, body: { dataStream: '\uE003' } },
          ] as never),
          textRanges: [],
        },
      },
    ]);
    expect(() => oracle.accept('insert-first', server)).toThrow('original Doc insertion anchors');
  } finally {
    source.univer.dispose();
    server.univer.dispose();
  }
});

test('an inserted worksheet keeps its original cells even when every replica agrees on its ID', () => {
  const source = new Replica({ workbook: seededWorkbook() });
  const server = new Replica({ workbook: seededWorkbook() });
  const other = new Replica({ workbook: seededWorkbook() });
  try {
    const sheet = {
      ...structuredClone(source.workbook()!.getSheetBySheetId('s1')!.getSnapshot()),
      id: 'added',
      name: 'Added',
      cellData: { 0: { 0: { v: 'irreplaceable source content' } } },
    };
    const oracle = new ContentIntent(server);
    const before = contentState(source);
    source.apply([{ id: structureIds.insertSheet, params: { unitId: 'wb', index: 2, sheet } }]);
    oracle.record('insert', before, contentState(source), source);
    for (const replica of [server, other]) {
      replica.apply([
        {
          id: structureIds.insertSheet,
          params: { unitId: 'wb', index: 2, sheet: { ...sheet, cellData: {} } },
        },
      ]);
    }
    expect(server.snapshot()).toEqual(other.snapshot());
    expect(() => oracle.accept('insert', server)).toThrow('original inserted worksheet content');
  } finally {
    for (const replica of [source, server, other]) replica.univer.dispose();
  }
});

test('Doc intent rejects an accepted insertion lost on otherwise equal replicas', () => {
  const document = { doc: seededDoc() };
  const source = new Replica(document);
  const server = new Replica(document);
  const other = new Replica(document);
  try {
    const oracle = new ContentIntent(server);
    const before = contentState(source);
    source.apply(insert('\uE001'));
    oracle.record('0:0', before, contentState(source), source);
    expect(server.snapshot()).toEqual(other.snapshot());
    expect(() => oracle.accept('0:0', server)).toThrow('accepted Doc character intent');
  } finally {
    for (const replica of [source, server, other]) replica.univer.dispose();
  }
});

test('Doc deletion may not remove a character its sender never saw', () => {
  const document = { doc: seededDoc() };
  const source = new Replica(document);
  const server = new Replica(document);
  try {
    source.apply(insert('\uE001'));
    server.apply(insert('\uE001'));
    const oracle = new ContentIntent(server);
    const deletionBase = contentState(source);
    source.apply(remove(1));
    oracle.record('0:delete', deletionBase, contentState(source), source);
    const peerBase = contentState(server);
    server.apply(insert('\uE002'));
    oracle.record('1:insert', peerBase, contentState(server), server);
    oracle.accept('1:insert', server);
    // A broken transform deletes the concurrent peer character too.
    server.apply(remove(2));
    expect(() => oracle.accept('0:delete', server)).toThrow('accepted Doc character intent');
  } finally {
    source.univer.dispose();
    server.univer.dispose();
  }
});

test('causal undo and redo can remove and reintroduce the same Doc character', () => {
  const replica = new Replica({ doc: seededDoc() });
  try {
    const oracle = new ContentIntent(replica);
    for (const [label, mutations] of [
      ['edit', insert('\uE003')],
      ['undo', remove(1)],
      ['redo', insert('\uE003')],
    ] as const) {
      const before = contentState(replica);
      replica.apply(mutations);
      oracle.record(label, before, contentState(replica), replica);
      oracle.accept(label, replica);
    }
    expect(oracle.checks.doc).toBe(3);
  } finally {
    replica.univer.dispose();
  }
});

test('worksheet intent rejects a lost insert and an unrelated sheet deletion', () => {
  for (const action of ['insert', 'remove'] as const) {
    const source = new Replica({ workbook: seededWorkbook() });
    const server = new Replica({ workbook: seededWorkbook() });
    try {
      const oracle = new ContentIntent(server);
      const before = contentState(source);
      const mutations =
        action === 'insert'
          ? [
              {
                id: structureIds.insertSheet,
                params: {
                  unitId: 'wb',
                  index: 2,
                  sheet: {
                    ...structuredClone(source.workbook()!.getSheetBySheetId('s1')!.getSnapshot()),
                    id: 'added',
                    name: 'Added',
                    cellData: {},
                  },
                },
              },
            ]
          : [{ id: structureIds.removeSheet, params: { unitId: 'wb', subUnitId: 's2', index: 1 } }];
      source.apply(mutations);
      oracle.record(action, before, contentState(source), source);
      if (action === 'remove') {
        server.apply([
          { id: structureIds.removeSheet, params: { unitId: 'wb', subUnitId: 's1', index: 0 } },
        ]);
      }
      expect(() => oracle.accept(action, server)).toThrow('accepted worksheet identity intent');
    } finally {
      source.univer.dispose();
      server.univer.dispose();
    }
  }
});
