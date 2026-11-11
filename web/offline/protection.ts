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
 * a dismissed, failed or newer message stays exactly as it is, and so does
 * every message once the preparation's scope is no longer current (`current`).
 * That scope check replaces the `verify(scope)()` that used to run after the
 * awaited storage answer, now that the download no longer waits for it.
 */
export function answeredMessage(
  shown: OfflineMessage | null,
  expected: OfflineMessage,
  protection: PersistenceState,
  current = true,
): OfflineMessage | null {
  return current && shown === expected && shown.detail === protectionDetail(null).detail
    ? { ...shown, ...protectionDetail(protection) }
    : shown;
}
