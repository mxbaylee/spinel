import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { ItemAccess } from './workspace.ts';

/** One image the bundle's snapshot references, fetched through the item's image route. */
export type OfflineBundleImage = {
  source: string;
  sha256: string;
  mime: string;
  byteLength: number;
};

/**
 * Everything a device needs to keep one document offline (docs/offline.md).
 * The snapshot and revision come from the same read of one generation. A bundle
 * alone does not mean downloaded, durable or synced.
 */
export type OfflineBundle = {
  version: 1;
  accountId: string;
  itemId: string;
  kind: 'sheet' | 'doc';
  name: string;
  unitId: string;
  revision: number;
  revisionOffset: number;
  access: ItemAccess;
  readOnly: boolean;
  sdkVersion: string;
  snapshot: IWorkbookData | IDocumentData;
  images: OfflineBundleImage[];
};
