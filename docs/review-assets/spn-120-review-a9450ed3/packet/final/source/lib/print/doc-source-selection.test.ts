import { expect, test, vi } from 'vitest';
import type { IDocumentData } from '@univerjs/core';
import { PrintError } from './contract.ts';
import { selectDocImageSources } from './selection.ts';

function fixture(): IDocumentData {
  return {
    id: 'source-selection',
    documentStyle: {
      defaultHeaderId: 'header',
      defaultFooterId: 'footer',
      firstPageHeaderId: 'unused',
      useFirstPageHeaderFooter: 0,
    },
    body: {
      dataStream: '\b\b\r\n',
      customBlocks: [
        { startIndex: 0, blockId: 'group' },
        { startIndex: 1, blockId: 'hidden' },
      ],
    },
    headers: {
      header: {
        headerId: 'header',
        body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: 'header-image' }] },
      },
      unused: {
        headerId: 'unused',
        body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: 'unused-group' }] },
      },
    },
    footers: {
      footer: {
        footerId: 'footer',
        body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: 'footer-image' }] },
      },
    },
    drawings: {
      group: { drawingId: 'group', drawingType: 6 },
      first: { drawingId: 'first', drawingType: 0, groupId: 'group', source: 'authorized-body' },
      second: { drawingId: 'second', drawingType: 0, groupId: 'group', source: 'authorized-body' },
      hidden: { drawingId: 'hidden', drawingType: 6, hidden: true },
      nested: { drawingId: 'nested', drawingType: 6, groupId: 'hidden' },
      'hidden-child': {
        drawingId: 'hidden-child',
        drawingType: 0,
        groupId: 'nested',
        source: 'hidden-source',
      },
      'hidden-leaf': {
        drawingId: 'hidden-leaf',
        drawingType: 0,
        hidden: true,
        source: 'hidden-leaf-source',
      },
      'unused-group': { drawingId: 'unused-group', drawingType: 6 },
      // This is plain bounded metadata, but cannot be an admitted image source.
      // An inactive story must disappear before the source-bearing payload walk.
      'unused-child': {
        drawingId: 'unused-child',
        drawingType: 0,
        groupId: 'unused-group',
        source: 17,
      },
      'header-image': { drawingId: 'header-image', drawingType: 0, source: 'authorized-header' },
      'footer-image': { drawingId: 'footer-image', drawingType: 0, source: 'authorized-footer' },
    } as unknown as IDocumentData['drawings'],
  };
}

test('Doc metadata selection shares native story eligibility and hidden ancestry without mutating its source', () => {
  const source = fixture();
  const original = structuredClone(source);
  expect(selectDocImageSources(source)).toEqual([
    'authorized-body',
    'authorized-header',
    'authorized-footer',
  ]);
  expect(source).toEqual(original);
  // A section can activate the saved first-page story; the selected malformed
  // source now fails before the host receives any references to prepare.
  source.body!.sectionBreaks = [{ startIndex: 3, sectionId: 'first', useFirstPageHeaderFooter: 1 }];
  expect(() => selectDocImageSources(source)).toThrow(PrintError);
});

test('active orphan/cyclic groups, malformed visibility and unknown source payloads fail explicitly', () => {
  const edits = [
    (source: IDocumentData) => {
      source.drawings!.first.groupId = 'missing';
    },
    (source: IDocumentData) => {
      source.drawings!.group.groupId = 'group';
    },
    (source: IDocumentData) => {
      Object.assign(source.drawings!.first, { hidden: 'yes' });
    },
    (source: IDocumentData) => {
      Object.assign(source.drawings!.first, { source: 17 });
    },
    (source: IDocumentData) => {
      Object.assign(source.drawings!.first, { payload: { source: [] } });
    },
    (source: IDocumentData) => {
      Object.assign(source.drawings!.first, { drawingType: 2 });
    },
  ];
  for (const edit of edits) {
    const source = fixture();
    edit(source);
    expect(() => selectDocImageSources(source)).toThrow(PrintError);
  }
});

test('Doc source inspection bounds cloning, source/work/depth limits and cancellation without evaluating getters', () => {
  const source = fixture();
  const getter = vi.fn(() => 'private');
  Object.defineProperty(source, 'title', { get: getter, enumerable: true });
  expect(() => selectDocImageSources(source)).toThrow(PrintError);
  expect(getter).not.toHaveBeenCalled();
  expect(() => selectDocImageSources(fixture(), { limits: { images: 2 } })).toThrow(
    'source budget',
  );
  expect(() => selectDocImageSources(fixture(), { limits: { snapshotNodes: 2 } })).toThrow(
    PrintError,
  );
  const controller = new AbortController();
  controller.abort();
  expect(() => selectDocImageSources(fixture(), { signal: controller.signal })).toThrow(
    'cancelled',
  );
  const deep = fixture();
  for (let index = 0; index < 34; index++)
    deep.drawings![`depth-${index}`] = {
      drawingId: `depth-${index}`,
      drawingType: 6,
      ...(index ? { groupId: `depth-${index - 1}` } : {}),
    } as NonNullable<IDocumentData['drawings']>[string];
  // Parent-first insertion must not let cached ancestor visibility hide depth.
  expect(() => selectDocImageSources(deep)).toThrow('nesting budget');
});
