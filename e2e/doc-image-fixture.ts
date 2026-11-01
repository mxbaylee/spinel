import { getDocsEmptySnapshot } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import sharp from 'sharp';

/** Shared native body/header/footer image seed; importing it never runs a test. */
export async function docImageSnapshot() {
  const id = 'offline-image-doc';
  const drawing = async (color: string, subUnitId = id) => ({
    unitId: id,
    subUnitId,
    drawingId: 'picture',
    drawingType: 0,
    imageSourceType: 'BASE64',
    source: `data:image/png;base64,${(
      await sharp({ create: { width: 80, height: 60, channels: 3, background: color } })
        .png()
        .toBuffer()
    ).toString('base64')}`,
    layoutType: 0,
    transform: { left: 0, top: 0, width: 80, height: 60, angle: 0, flipX: false, flipY: false },
    docTransform: {
      size: { width: 80, height: 60 },
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 0, posOffset: 0 },
      angle: 0,
    },
  });
  const body = await drawing('#7700cc');
  const header = await drawing('#00aacc', 'header');
  const footer = await drawing('#cc0077', 'footer');
  return {
    ...getDocsEmptySnapshot(id),
    title: 'Recovery images',
    body: {
      dataStream: '\bRecovery base notes\r\n',
      paragraphs: [{ startIndex: 20 }],
      customBlocks: [{ startIndex: 0, blockId: 'picture' }],
    },
    drawingsOrder: ['picture'],
    drawings: { picture: body },
    headers: {
      header: {
        headerId: 'header',
        body: { dataStream: '\r\n', paragraphs: [{ startIndex: 0 }] },
        drawings: { picture: header },
      },
    },
    footers: {
      footer: {
        footerId: 'footer',
        body: { dataStream: '\r\n', paragraphs: [{ startIndex: 0 }] },
        drawings: { picture: footer },
      },
    },
    resources: [
      {
        name: 'DOC_DRAWING_PLUGIN',
        data: JSON.stringify({ data: { picture: body }, order: ['picture'] }),
      },
    ],
  } as unknown as IDocumentData;
}
