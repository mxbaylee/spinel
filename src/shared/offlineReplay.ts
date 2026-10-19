import type { IDocumentMeta, ISnapshot, IWorkbookMeta } from '@univerjs/protocol';
import type { UnitLoadDataWithBlocks } from '@univerjs-pro/collaboration-service';
import type { ItemAccess } from './workspace.ts';

/** A replay base, not a claim that an app, images or permissions are cached. */
export type OfflineReplay = {
  version: 1;
  sdkVersion: '1.1.0';
  accountId: string;
  itemId: string;
  unitId: string;
  access: ItemAccess;
  revisionOffset: number;
  data: UnitLoadDataWithBlocks;
  preservedResources: { name: string; data: string }[];
};
type WireWorkbook = Omit<IWorkbookMeta, 'originalMeta' | 'sheets'> & {
  originalMeta: string;
  sheets: Record<
    string,
    Omit<IWorkbookMeta['sheets'][string], 'originalMeta'> & { originalMeta: string }
  >;
};
type WireSnapshot = Omit<ISnapshot, 'workbook' | 'doc'> & {
  workbook: WireWorkbook | undefined;
  doc: (Omit<IDocumentMeta, 'originalMeta'> & { originalMeta: string }) | undefined;
};
export type OfflineReplayWire = Omit<OfflineReplay, 'data'> & {
  data: Omit<UnitLoadDataWithBlocks, 'snapshot' | 'sheetBlocks'> & {
    snapshot: WireSnapshot;
    sheetBlocks: (Omit<UnitLoadDataWithBlocks['sheetBlocks'][number], 'data'> & { data: string })[];
  };
};

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary);
}
function decode(text: string) {
  const binary = atob(text);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// Encode only declared binary fields. User strings/resources remain literal and
// cannot impersonate a generic tagged byte value during JSON round trips.
export function encodeOfflineReplay(bundle: OfflineReplay): OfflineReplayWire {
  const snapshot = bundle.data.snapshot;
  return {
    ...bundle,
    data: {
      ...bundle.data,
      snapshot: {
        ...snapshot,
        workbook: snapshot.workbook && {
          ...snapshot.workbook,
          originalMeta: encode(snapshot.workbook.originalMeta),
          sheets: Object.fromEntries(
            Object.entries(snapshot.workbook.sheets).map(([id, sheet]) => [
              id,
              { ...sheet, originalMeta: encode(sheet.originalMeta) },
            ]),
          ),
        },
        doc: snapshot.doc && { ...snapshot.doc, originalMeta: encode(snapshot.doc.originalMeta) },
      },
      sheetBlocks: bundle.data.sheetBlocks.map((block) => ({ ...block, data: encode(block.data) })),
    },
  };
}

/** The caller validates account, generation and schema before opening an editor. */
export function decodeOfflineReplay(bundle: OfflineReplayWire): OfflineReplay {
  if (bundle.version !== 1 || bundle.sdkVersion !== '1.1.0')
    throw new Error('This offline replay bundle needs a compatible Spinel version.');
  const snapshot = bundle.data.snapshot;
  if (snapshot.unitID !== bundle.unitId || ![1, 2].includes(snapshot.type))
    throw new Error('The offline replay bundle belongs to a different document.');
  return {
    ...bundle,
    data: {
      ...bundle.data,
      snapshot: {
        ...snapshot,
        workbook: snapshot.workbook && {
          ...snapshot.workbook,
          originalMeta: decode(snapshot.workbook.originalMeta),
          sheets: Object.fromEntries(
            Object.entries(snapshot.workbook.sheets).map(([id, sheet]) => [
              id,
              { ...sheet, originalMeta: decode(sheet.originalMeta) },
            ]),
          ),
        },
        doc: snapshot.doc && { ...snapshot.doc, originalMeta: decode(snapshot.doc.originalMeta) },
      },
      sheetBlocks: bundle.data.sheetBlocks.map((block) => ({ ...block, data: decode(block.data) })),
    },
  };
}
