import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { mapNativeImageSources, NativeImageError } from '../../shared/nativeImageSources.ts';
import { AuthError } from '../auth/store.ts';

/** Visit only image-bearing native locations, never URL-looking ordinary text. */
export function imageSources(
  snapshot: IDocumentData | IWorkbookData,
  map: (source: string) => string,
) {
  try {
    mapNativeImageSources(snapshot, map, { updateSourceType: true });
  } catch (error) {
    if (error instanceof NativeImageError) throw new AuthError(400, error.message);
    throw error;
  }
}
