import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { ItemAccess } from './workspace.ts';

/** One image the bundle's snapshot references, fetched through the item's image route. */
export type OfflineBundleImage = {
  source: string;
  sha256: string;
  mime: string;
  byteLength: number;
};

type OfflineBundleFields = {
  version: 1;
  accountId: string;
  itemId: string;
  name: string;
  unitId: string;
  revision: number;
  revisionOffset: number;
  access: ItemAccess;
  readOnly: boolean;
  sdkVersion: string;
  images: OfflineBundleImage[];
};

/**
 * Everything a device needs to keep one document offline (docs/offline.md).
 * The snapshot and revision come from the same read of one generation. A bundle
 * alone does not mean downloaded, durable or synced. `kind` says which snapshot
 * shape follows.
 */
export type OfflineBundle =
  | (OfflineBundleFields & { kind: 'sheet'; snapshot: IWorkbookData })
  | (OfflineBundleFields & { kind: 'doc'; snapshot: IDocumentData });
