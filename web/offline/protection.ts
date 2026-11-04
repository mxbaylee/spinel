import type { PersistenceState } from './deviceStorage.ts';
import type { OfflineMessage } from './useOfflineDownloads.ts';

/** What a prepared result says about storage protection; null while the browser is still asking. */
export function protectionDetail(protection: PersistenceState | null) {
  return {
    storageHelp: protection !== 'granted',
    detail:
      protection === null
        ? 'Your browser is still deciding on storage protection. Allow it if asked; otherwise your browser may clear offline documents.'
        : protection === 'granted'
          ? 'Your browser granted storage protection. Device copies are not a backup.'
          : protection === 'denied'
            ? 'Your browser did not grant storage protection. It may clear offline documents when space runs low.'
            : protection === 'unsupported'
              ? 'This browser does not offer storage protection. It may clear offline documents.'
              : 'Storage protection could not be requested. Offline documents may still be cleared.',
  };
}

/**
 * A late storage answer updates only the still-deciding result it belongs to:
 * a dismissed, failed or newer message stays exactly as it is.
 */
export function answeredMessage(
  shown: OfflineMessage | null,
  text: string,
  protection: PersistenceState,
): OfflineMessage | null {
  return shown?.text === text && shown.detail === protectionDetail(null).detail
    ? { ...shown, ...protectionDetail(protection) }
    : shown;
}
