/** Pure input rules for inserting images into a Sheet; no DOM or Univer imports. */

export type PasteClipboard = { html: string; text: string };

/**
 * A clipboard that carries files normally inserts a floating image. Office range
 * copies also carry a bitmap beside table HTML or tabular text; those paste as
 * cells. Word and PowerPoint mark a copied picture as Office HTML too, so only a
 * table counts, never the marker alone. A browser "Copy image" (single `<img>` HTML) and bare files still insert.
 */
export function pasteBelongsToCells({ html, text }: PasteClipboard): boolean {
  if (/<table[\s>]/i.test(html)) return true;
  return /[\t\n]/.test(text.trim());
}

export const imageSizeMessage = 'Choose an image no larger than 5 MiB.';
export const uploadFailedMessage = 'The image could not be uploaded. Try again.';

/** Keep the server's own explanation; proxies may answer with a non-JSON body. */
export function uploadFailureMessage(status: number, body: unknown): string {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  if (typeof error === 'string' && error) return error;
  return status === 413 ? imageSizeMessage : uploadFailedMessage;
}

/**
 * Latest request wins: starting a chooser replaces a stale one (a browser may
 * never fire `cancel`), and only the current holder may release the slot.
 */
export function latestChooser() {
  let current: AbortController | undefined;
  return {
    start() {
      current?.abort();
      const own = new AbortController();
      current = own;
      return {
        signal: own.signal,
        release() {
          if (current === own) current = undefined;
        },
      };
    },
    get open() {
      return current !== undefined;
    },
    abort() {
      current?.abort();
      current = undefined;
    },
  };
}

/** The canonical stored-image URL for an item, or undefined for any other response. */
export function storedImageUrl(itemId: string, body: unknown): string | undefined {
  const url = body && typeof body === 'object' ? (body as { url?: unknown }).url : undefined;
  const prefix = `/api/items/${itemId}/images/`;
  return typeof url === 'string' &&
    url.startsWith(prefix) &&
    /^[a-f\d]{64}$/.test(url.slice(prefix.length))
    ? url
    : undefined;
}
