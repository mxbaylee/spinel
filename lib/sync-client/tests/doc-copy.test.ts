import { CustomRangeType, IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import type { DocumentDataModel, IDocumentBody, IDocumentData } from '@univerjs/core';
import { InsertTextCommand } from '@univerjs/docs';
import { InnerPasteCommand } from '@univerjs/docs-ui';
import { docFormulas, formulaBody } from '@spinel/doc-formulas';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import { expect, test } from 'vitest';
import { comparable, doc, turns, wire } from './fixture.ts';
import { nativeSession } from './native-session.ts';
import type { NativePeer } from './native-session.ts';

const definition = (range: string): FormulaDefinition => {
  const expression = `=Budget.Summary.${range}`;
  return {
    version: 1,
    expression,
    references: [{ start: 1, end: expression.length, itemId: 'budget', sheetId: 'summary', range }],
  };
};
const hyperlink = (changed = false): IDocumentBody => {
  const dataStream = changed ? 'Edited link' : 'Original link';
  return {
    dataStream,
    customRanges: [
      {
        rangeId: 'source',
        rangeType: CustomRangeType.HYPERLINK,
        startIndex: 0,
        endIndex: dataStream.length - 1,
        properties: { url: changed ? 'https://example.test/new' : 'https://example.test/original' },
      },
    ],
  };
};
const source = (kind: 'hyperlink' | 'formula', changed = false) =>
  kind === 'hyperlink'
    ? hyperlink(changed)
    : formulaBody('source', definition(changed ? 'B2' : 'A1'));

function snapshot(body: IDocumentBody) {
  const value = doc();
  const dataStream = `${body.dataStream} -- \r\n`;
  value.body = {
    ...structuredClone(body),
    dataStream,
    paragraphs: [{ startIndex: dataStream.length - 2, paragraphId: 'paragraph-1' }],
    sectionBreaks: [{ startIndex: dataStream.length - 1, sectionId: 'section-1' }],
  };
  return value;
}

function copy(peer: NativePeer, length: number) {
  const model = peer.live.univer
    .__getInjector()
    .get(IUniverInstanceService)
    .getUnit<DocumentDataModel>('doc', UniverInstanceType.UNIVER_DOC)!;
  const body = structuredClone(model.sliceBody(0, length)!);
  // The native clipboard service removes paragraph-style metadata for a
  // terminator outside the copied text before calling InnerPasteCommand.
  if (body.paragraphs)
    body.paragraphs = body.paragraphs.filter(
      (paragraph) => body.dataStream[paragraph.startIndex] === '\r',
    );
  return body;
}

async function paste(peer: NativePeer, body: IDocumentBody, at: number) {
  // This is the public native clipboard command, not a synthetic rich-text
  // mutation or isolated identity helper. It creates each pasted range ID.
  peer.commands.registerCommand(InnerPasteCommand);
  expect(
    await peer.commands.executeCommand(InnerPasteCommand.id, {
      unitId: 'doc',
      segmentId: '',
      doc: { body },
      selections: [{ startOffset: at, endOffset: at, collapsed: true }],
      textRanges: [],
    }),
  ).toBe(true);
}

for (const kind of ['hyperlink', 'formula'] as const) {
  for (const scenario of ['edit-source', 'same-copy'] as const) {
    test.each([0, 1])(
      `native ${kind} clipboard ${scenario} keeps independent identities through sync/reopen (%s first)`,
      async (first) => {
        const original = source(kind);
        const f = nativeSession(snapshot(original), 'doc');
        try {
          const peers = [f.client('owner'), f.client('collaborator')];
          await turns();
          const copied = peers.map((peer) => copy(peer, original.dataStream.length));
          for (const body of copied) {
            expect(body.dataStream).toBe(original.dataStream);
            expect(body.customRanges).toEqual(original.customRanges);
          }
          const at = original.dataStream.length + 4;
          await paste(peers[0], copied[0], at);
          if (scenario === 'same-copy') await paste(peers[1], copied[1], at);
          else
            expect(
              await peers[1].commands.executeCommand(InsertTextCommand.id, {
                unitId: 'doc',
                segmentId: '',
                body: source(kind, true),
                range: { startOffset: 0, endOffset: original.dataStream.length, collapsed: false },
                textRanges: [],
                debounce: false,
              }),
            ).toBe(true);
          const localCopies = peers.map((peer) =>
            (peer.live.snapshot() as IDocumentData)
              .body!.customRanges!.filter((range) => range.rangeId !== 'source')
              .map((range) => range.rangeId),
          );
          expect(localCopies[0]).toHaveLength(1);
          if (scenario === 'same-copy') {
            expect(localCopies[1]).toHaveLength(1);
            expect(localCopies[1][0]).not.toBe(localCopies[0][0]);
          }
          const requests = [await f.request(peers[0]), await f.request(peers[1])];
          expect(
            requests[0].mutations.some(
              (mutation) => mutation.params.trigger === InnerPasteCommand.id,
            ),
          ).toBe(true);
          const second = 1 - first;
          const resultFirst = await f.submit(peers[first], requests[first]);
          peers[second].sync.receive({ type: 'edit', ...wire(resultFirst.edit) });
          // A lost acknowledgment must not repeat clipboard identity creation.
          peers[first].sync.setConnected(false);
          f.resume(peers[first]);
          expect(await f.request(peers[first])).toEqual(requests[first]);
          const duplicate = await f.submit(peers[first], requests[first]);
          expect(duplicate.duplicate).toBe(true);
          await f.acknowledge(peers[first], duplicate);
          const resultSecond = await f.submit(peers[second], requests[second]);
          await f.acknowledge(peers[second], resultSecond);
          peers[first].sync.receive({ type: 'edit', ...wire(resultSecond.edit) });
          await turns();
          const saved = f.reopen() as IDocumentData;
          const ranges = saved.body!.customRanges!;
          const copyIds = localCopies.flat();
          expect(ranges).toHaveLength(scenario === 'same-copy' ? 3 : 2);
          expect(new Set(ranges.map((range) => range.rangeId))).toEqual(
            new Set(['source', ...copyIds]),
          );
          for (const id of copyIds) {
            const range = ranges.find((item) => item.rangeId === id)!;
            expect(range.properties).toEqual(original.customRanges![0].properties);
            expect(saved.body!.dataStream.slice(range.startIndex, range.endIndex + 1)).toBe(
              original.dataStream,
            );
          }
          const retained = ranges.find((range) => range.rangeId === 'source')!;
          const wantedSource = source(kind, scenario === 'edit-source');
          expect(retained.properties).toEqual(wantedSource.customRanges![0].properties);
          expect(saved.body!.dataStream.slice(retained.startIndex, retained.endIndex + 1)).toBe(
            wantedSource.dataStream,
          );
          if (kind === 'formula') {
            const formulas = docFormulas(saved.body!);
            expect(formulas).toHaveLength(ranges.length);
            expect(formulas.find((formula) => formula.id === 'source')!.definition).toEqual(
              definition(scenario === 'edit-source' ? 'B2' : 'A1'),
            );
            for (const id of copyIds)
              expect(formulas.find((formula) => formula.id === id)!.definition).toEqual(
                definition('A1'),
              );
          }
          expect(JSON.stringify(saved)).not.toMatch(/"(?:result|evaluatedValue|customGlyphKey)"/);
          expect(f.storage.history).toHaveLength(2);
          for (const peer of peers) {
            expect(peer.failures).toEqual([]);
            expect(peer.sync.state).toMatchObject({
              revision: 3,
              pending: false,
              resyncing: false,
            });
            expect(comparable(peer.live.snapshot())).toEqual(comparable(saved));
          }
        } finally {
          f.close();
        }
      },
    );
  }
}
