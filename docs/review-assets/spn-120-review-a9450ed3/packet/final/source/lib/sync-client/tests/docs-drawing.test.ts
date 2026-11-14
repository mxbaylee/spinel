import {
  DrawingTypeEnum,
  ICommandService,
  ILogService,
  ImageSourceType,
  LocaleType,
  LogLevel,
  PositionedObjectLayoutType,
  Univer,
  UniverInstanceType,
} from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { UniverDocsPlugin } from '@univerjs/docs';
import {
  DOCS_DRAWING_PLUGIN,
  InsertDocDrawingCommand,
  RemoveDocDrawingCommand,
  UniverDocsDrawingPlugin,
  UpdateDrawingDocTransformCommand,
} from '@univerjs/docs-drawing';
import type { IDocImage } from '@univerjs/docs-drawing';
import { UniverDocsHyperLinkPlugin } from '@univerjs/docs-hyper-link';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { materialize } from '@spinel/sync-server';
import type { Mutation } from '@spinel/sync-transform';
import { expect, test } from 'vitest';
import { captureNative, nativeSnapshot, NativeReplica } from '../index.ts';
import type { ClientFailure } from '../index.ts';
import { comparable, doc, fixture } from './fixture.ts';

function image(drawingId = 'image'): IDocImage {
  return {
    unitId: 'doc',
    subUnitId: 'doc',
    drawingId,
    drawingType: DrawingTypeEnum.DRAWING_IMAGE,
    imageSourceType: ImageSourceType.URL,
    source: '/images/kept.png',
    title: 'Kept title',
    description: 'Kept description',
    transform: { left: 306, top: 125, width: 20, height: 10 },
    docTransform: {
      size: { width: 20, height: 10 },
      positionH: { relativeFrom: 0, posOffset: 306 },
      positionV: { relativeFrom: 1, posOffset: 125 },
      angle: 0,
    },
    layoutType: PositionedObjectLayoutType.INLINE,
  };
}

/** The browser's public model plugins, without a canvas or drawing UI. */
function visibleDoc(snapshot: IDocumentData) {
  const univer = new Univer({ locale: LocaleType.EN_US });
  univer.__getInjector().get(ILogService).setLogLevel(LogLevel.SILENT);
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverDocsHyperLinkPlugin);
  univer.registerPlugin(UniverDrawingPlugin);
  univer.registerPlugin(UniverDocsDrawingPlugin);
  univer.createUnit(UniverInstanceType.UNIVER_DOC, structuredClone(snapshot));
  return univer;
}

function expectDrawingResource(snapshot: IDocumentData) {
  const resources = snapshot.resources?.filter((resource) => resource.name === DOCS_DRAWING_PLUGIN);
  expect(resources).toHaveLength(1);
  expect(JSON.parse(resources![0].data)).toEqual({
    data: snapshot.drawings,
    order: snapshot.drawingsOrder,
  });
}

test('real Doc drawing commands keep the browser, server and confirmed replica resources equal across reload', async () => {
  const f = fixture(doc(), 'doc');
  const visible = visibleDoc(f.storage.unit.snapshot as IDocumentData);
  const peer = new NativeReplica(f.storage.unit.snapshot, 'doc');
  const outgoing: Mutation[] = [];
  const failures: ClientFailure[] = [];
  const capture = captureNative({
    univer: visible,
    unitId: 'doc',
    onMutation: (mutation) => outgoing.push(mutation),
    onFailure: (failure) => failures.push(failure),
  });
  const commands = visible.__getInjector().get(ICommandService);
  let offset = 0;
  async function commit() {
    const mutations = outgoing.slice(offset);
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((mutation) => mutation.id === 'doc.mutation.rich-text-editing')).toBe(
      true,
    );
    const accepted = await f.accept({
      type: 'submit',
      mutationId: `00000000-0000-4000-8000-${String(f.storage.unit.revision).padStart(12, '0')}`,
      baseRevision: f.storage.unit.revision,
      mutations,
    });
    offset = outgoing.length;
    peer.apply(accepted.edit.mutations);
    const browserSnapshot = nativeSnapshot(visible, 'doc') as IDocumentData;
    const serverSnapshot = f.server.load('doc', undefined).snapshot as IDocumentData;
    const replicaSnapshot = peer.snapshot() as IDocumentData;
    for (const snapshot of [browserSnapshot, serverSnapshot, replicaSnapshot])
      expectDrawingResource(snapshot);
    expect(comparable(serverSnapshot)).toEqual(comparable(browserSnapshot));
    expect(comparable(replicaSnapshot)).toEqual(comparable(browserSnapshot));
    // Loading the duplicated resource must preserve the current image, including
    // deletion. A stale opaque copy would otherwise replace the canonical map.
    f.server.invalidate('doc');
    expect(comparable(f.server.load('doc', undefined).snapshot)).toEqual(
      comparable(serverSnapshot),
    );
    const reopenedPeer = new NativeReplica(serverSnapshot, 'doc');
    const reopenedBrowser = visibleDoc(serverSnapshot);
    try {
      expect(comparable(reopenedPeer.snapshot())).toEqual(comparable(serverSnapshot));
      expect(comparable(nativeSnapshot(reopenedBrowser, 'doc'))).toEqual(
        comparable(serverSnapshot),
      );
    } finally {
      reopenedPeer.dispose();
      reopenedBrowser.dispose();
    }
    expect(failures).toEqual([]);
    return serverSnapshot;
  }
  try {
    expect(
      await commands.executeCommand(InsertDocDrawingCommand.id, {
        unitId: 'doc',
        drawings: [image()],
        textRange: { startOffset: 0, endOffset: 0, collapsed: true },
      }),
    ).toBe(true);
    const inserted = await commit();
    expect(inserted.drawings?.image).toMatchObject(image());
    expect(inserted.drawingsOrder).toEqual(['image']);

    expect(
      await commands.executeCommand(UpdateDrawingDocTransformCommand.id, {
        unitId: 'doc',
        subUnitId: 'doc',
        drawings: [{ drawingId: 'image', key: 'size', value: { width: 37, height: 19 } }],
      }),
    ).toBe(true);
    const updated = await commit();
    expect(updated.drawings?.image.docTransform.size).toEqual({ width: 37, height: 19 });
    expect(updated.drawings?.image).toMatchObject({
      source: image().source,
      title: image().title,
      description: image().description,
      transform: image().transform,
    });

    expect(
      await commands.executeCommand(RemoveDocDrawingCommand.id, {
        unitId: 'doc',
        drawings: [
          {
            unitId: 'doc',
            subUnitId: 'doc',
            drawingId: 'image',
            drawingType: DrawingTypeEnum.DRAWING_IMAGE,
          },
        ],
      }),
    ).toBe(true);
    const removed = await commit();
    expect(removed.drawings).toEqual({});
    expect(removed.drawingsOrder).toEqual([]);
    expect(removed.body?.dataStream).toBe('Hello\r\n');
  } finally {
    capture.dispose();
    visible.dispose();
    peer.dispose();
    f.close();
  }
});

test('a persisted Doc drawing resource materializes its image and preserves unrelated opaque resource bytes', () => {
  const snapshot = doc();
  snapshot.body = {
    dataStream: '\bHello\r\n',
    customBlocks: [{ startIndex: 0, blockId: 'image' }],
    paragraphs: [{ startIndex: 6, paragraphId: 'paragraph-1' }],
    sectionBreaks: [{ startIndex: 7, sectionId: 'section-1' }],
  };
  const persisted = { data: { image: image() }, order: ['image'] };
  const opaque = { name: 'UNRECOGNIZED_PLUGIN', data: ' { "kept" : [ 3, 2, 1 ] }\n' };
  snapshot.resources = [{ name: DOCS_DRAWING_PLUGIN, data: JSON.stringify(persisted) }, opaque];
  const prepared = materialize(snapshot, 'doc') as IDocumentData;
  expect(prepared.drawings).toEqual(persisted.data);
  expect(prepared.drawingsOrder).toEqual(persisted.order);
  expectDrawingResource(prepared);
  expect(prepared.resources).toContainEqual(opaque);
  const replica = new NativeReplica(snapshot, 'doc');
  try {
    expect(comparable(replica.snapshot())).toEqual(comparable(prepared));
    expect(comparable(materialize(prepared, 'doc'))).toEqual(comparable(prepared));
  } finally {
    replica.dispose();
  }
});

test('malformed known Doc drawing resource JSON is refused by both headless hosts', () => {
  const snapshot = doc();
  snapshot.resources = [{ name: DOCS_DRAWING_PLUGIN, data: '{broken' }];
  expect(() => materialize(snapshot, 'doc')).toThrow();
  expect(() => new NativeReplica(snapshot, 'doc')).toThrow();
});
