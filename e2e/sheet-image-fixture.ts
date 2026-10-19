import sharp from 'sharp';

// All three supported native image locations; keep edited A1/A2 free in offline probes.
export async function sheetImageFixture(imageCellRow = 1) {
  const colors = ['#ff9900', '#2255ee', '#22bb66'];
  const sources = await Promise.all(
    colors.map(
      async (background) =>
        `data:image/png;base64,${(
          await sharp({ create: { width: 80, height: 60, channels: 3, background } })
            .png()
            .toBuffer()
        ).toString('base64')}`,
    ),
  );
  const drawing = {
    unitId: 'image-sheet',
    subUnitId: 'tab',
    drawingId: 'floating',
    drawingType: 0,
    imageSourceType: 'BASE64',
    source: sources[0],
    transform: { left: 150, top: 100, width: 80, height: 60 },
    sheetTransform: {
      from: { row: 5, rowOffset: 0, column: 2, columnOffset: 0 },
      to: { row: 8, rowOffset: 0, column: 3, columnOffset: 0 },
    },
  };
  const cellDrawing = {
    unitId: 'cell-doc',
    subUnitId: 'cell-doc',
    drawingId: 'cell',
    drawingType: 0,
    imageSourceType: 'BASE64',
    source: sources[1],
    layoutType: 0,
    transform: { left: 0, top: 0, width: 80, height: 60 },
    docTransform: {
      size: { width: 80, height: 60 },
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 0, posOffset: 0 },
      angle: 0,
    },
  };
  return {
    id: 'image-sheet',
    name: 'Sheet images',
    appVersion: '1.1.0',
    locale: 'enUS',
    sheetOrder: ['tab'],
    styles: {},
    sheets: {
      tab: {
        id: 'tab',
        name: 'Images',
        rowCount: 30,
        columnCount: 10,
        defaultColumnWidth: 100,
        backgroundImage: { source: sources[2], imageSourceType: 'BASE64' },
        rowData: { [imageCellRow]: { h: 80 } },
        cellData: {
          [imageCellRow]: {
            0: {
              p: {
                id: 'cell-doc',
                body: {
                  dataStream: '\b\r\n',
                  paragraphs: [{ startIndex: 1 }],
                  customBlocks: [{ startIndex: 0, blockId: 'cell' }],
                },
                drawingsOrder: ['cell'],
                drawings: { cell: cellDrawing },
                documentStyle: {
                  pageSize: { width: 100, height: 80 },
                  marginTop: 0,
                  marginBottom: 0,
                  marginLeft: 0,
                  marginRight: 0,
                },
              },
            },
          },
        },
      },
    },
    resources: [
      {
        name: 'SHEET_DRAWING_PLUGIN',
        data: JSON.stringify({
          tab: {
            unitId: 'image-sheet',
            subUnitId: 'tab',
            order: ['floating'],
            data: {
              floating: { ...drawing, axisAlignSheetTransform: drawing.sheetTransform },
            },
          },
        }),
      },
    ],
  };
}
