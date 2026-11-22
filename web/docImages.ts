import type { IImageIoService } from '@univerjs/core';
import type { IDocClipboardService } from '@univerjs/docs-ui';
import { mapNativeImageSources } from '../src/shared/nativeImageSources.ts';
import type { OfflineSession } from './offline/OfflineSession.ts';

export class DocImageError extends Error {}

export const imageUploadFailed = 'Image upload failed. Check your connection and retry.';

export function docImageErrorMessage(error: unknown) {
  return error instanceof DocImageError ? error.message : imageUploadFailed;
}

/** Each new clipboard or toolbar action owns its feedback; older work cannot replace it. */
export function createDocImageFeedback(write: (message: string) => void, current: () => boolean) {
  let latest = 0;
  return () => {
    const attempt = ++latest;
    if (current()) write('');
    return (message: string) => {
      if (attempt === latest && current()) write(message);
    };
  };
}

const imageLimits = new Map([
  ['Choose an image no larger than 5 MiB.', 'Choose an image no larger than 5 MiB.'],
  ['Choose a PNG, JPEG or WebP image.', 'Choose a PNG, JPEG or WebP image.'],
  [
    'Choose a valid static PNG, JPEG or WebP image up to 16 megapixels.',
    'Use a static PNG, JPEG or WebP up to 16 megapixels.',
  ],
  [
    'The processed image exceeds 5 MiB. Choose a smaller image.',
    'Image exceeds 5 MiB. Choose a smaller image.',
  ],
  [
    'This document has reached its 50 MiB image limit.',
    'Doc image limit reached. Try a smaller image.',
  ],
  [
    'Images are still uploading. Try again shortly.',
    'Images are still uploading. Try again shortly.',
  ],
]);

/** Keep server limits actionable without displaying transport/parser or arbitrary server errors. */
export async function uploadedImageSource(response: Response, itemId: string) {
  if (response.status === 401)
    throw new DocImageError('Your sign-in ended. Sign in again to add an image.');
  if (response.status === 403 || response.status === 404)
    throw new DocImageError('Image not added. Check your edit access.');
  let image: unknown;
  try {
    image = await response.json();
  } catch {
    throw new DocImageError(imageUploadFailed);
  }
  if (!image || typeof image !== 'object') throw new DocImageError(imageUploadFailed);
  if (!response.ok) {
    const message = 'error' in image ? image.error : undefined;
    throw new DocImageError(
      typeof message === 'string'
        ? (imageLimits.get(message) ?? imageUploadFailed)
        : imageUploadFailed,
    );
  }
  if (
    response.status !== 201 ||
    !('id' in image) ||
    typeof image.id !== 'string' ||
    !/^[a-f\d]{64}$/.test(image.id) ||
    !('url' in image) ||
    image.url !== `/api/items/${itemId}/images/${image.id}`
  )
    throw new DocImageError(imageUploadFailed);
  return image.url;
}

/** The toolbar and clipboard share this document-scoped upload and offline admission. */
export async function uploadDocImage(
  file: File,
  options: {
    itemId: string;
    path: string;
    request: (path: string, init: RequestInit) => Promise<Response>;
    signal: AbortSignal;
    canEdit: () => boolean;
    offline?: Pick<
      OfflineSession,
      'enabled' | 'online' | 'verifyRemote' | 'prepareImages' | 'toVisible'
    >;
  },
) {
  const verify = () => {
    options.signal.throwIfAborted();
    if (!options.canEdit()) throw new Error('Image preparation cancelled.');
    options.offline?.verifyRemote();
  };
  verify();
  if (options.offline?.enabled && !options.offline.online)
    throw new DocImageError('Connect before inserting a new image.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new DocImageError('Choose a PNG, JPEG or WebP image.');
  if (!file.size || file.size > 5 * 1024 * 1024)
    throw new DocImageError('Choose an image no larger than 5 MiB.');
  const response = await options.request(`${options.path}/images`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
    signal: options.signal,
  });
  verify();
  const url = await uploadedImageSource(response, options.itemId);
  verify();
  await options.offline?.prepareImages(url, options.signal);
  verify();
  return options.offline?.toVisible(url) ?? url;
}

/**
 * Keep the public native paste implementation, including selection, permission and
 * history cancellation. Its image hook finishes before decoding and insertion;
 * the delegated public calls own the complete busy interval instead.
 */
export function installDocImagePaste(
  clipboard: Pick<
    IDocClipboardService,
    'legacyPaste' | 'changePasteMode' | 'addClipboardHook' | 'dismissPasteOptions'
  >,
  options: {
    unitId: string;
    itemId: string;
    origin: string;
    canEdit: () => boolean;
    saveImage: IImageIoService['saveImage'];
    toCanonical?: (source: string) => string;
    busy: (value: boolean) => void;
    beginFeedback: () => (message: string) => void;
  },
) {
  let disposed = false;
  let generation = 0;
  let pending = 0;
  let imageBusy = false;
  const legacyPaste = clipboard.legacyPaste;
  const changePasteMode = clipboard.changePasteMode;
  const current = () => !disposed && options.canEdit();
  const finishBusy = () => {
    if (!imageBusy) return;
    imageBusy = false;
    options.busy(false);
  };
  const run = async (action: () => Promise<boolean>) => {
    if (!current()) return false;
    const admitted = generation;
    const failed = options.beginFeedback();
    pending++;
    try {
      return await action();
    } catch (error) {
      if (current() && admitted === generation)
        failed(
          error instanceof DocImageError
            ? error.message
            : 'Could not paste. Copy the content and try again.',
        );
      throw error;
    } finally {
      // Concurrent native calls may cancel each other. Do not infer an image
      // failure from a false result, or release an earlier image's protection.
      if (--pending === 0) finishBusy();
    }
  };
  const paste: typeof legacyPaste = (payload) => run(() => legacyPaste.call(clipboard, payload));
  const change: typeof changePasteMode = (mode) => run(() => changePasteMode.call(clipboard, mode));
  clipboard.legacyPaste = paste;
  clipboard.changePasteMode = change;
  const hook = clipboard.addClipboardHook({
    onBeforePasteImage: async (file) => {
      const admitted = generation;
      if (!current()) throw new Error('Image preparation cancelled.');
      if (!imageBusy) {
        imageBusy = true;
        options.busy(true);
      }
      const image = await options.saveImage(file);
      if (!current() || admitted !== generation) throw new Error('Image preparation cancelled.');
      // Returning null would retain the original base64 source in pasted HTML.
      if (!image) throw new Error('Image preparation failed.');
      return { source: image.source, imageSourceType: image.imageSourceType };
    },
    onBeforePaste: (body, context) => {
      if (context.targetUnitId !== options.unitId) return body;
      if (!current()) throw new Error('Image preparation cancelled.');
      const prefix = `/api/items/${options.itemId}/images/`;
      mapNativeImageSources(context.documentData, (source) => {
        // HTML img.src expands our relative URL. Normalize only this document's
        // exact same-origin stored source; leave blob mappings to OfflineSession.
        const visible = source.startsWith(options.origin + prefix)
          ? source.slice(options.origin.length)
          : source;
        let canonical: string;
        try {
          canonical = options.toCanonical?.(visible) ?? visible;
        } catch {
          throw new DocImageError('This image cannot be pasted. Insert it from a file instead.');
        }
        if (!canonical.startsWith(prefix) || !/^[a-f\d]{64}$/.test(canonical.slice(prefix.length)))
          throw new DocImageError('This image cannot be pasted. Insert it from a file instead.');
        return visible;
      });
      return body;
    },
  });
  const cancel = () => {
    generation++;
    clipboard.dismissPasteOptions();
  };
  return {
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      hook.dispose();
      if (clipboard.legacyPaste === paste) clipboard.legacyPaste = legacyPaste;
      if (clipboard.changePasteMode === change) clipboard.changePasteMode = changePasteMode;
      finishBusy();
    },
  };
}
