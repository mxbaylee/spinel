import { guestItemId } from './documentAccess.ts';

export const guestRevokedEvent = 'spinel-guest-revoked';

/** An authoritative access response, never a network failure or missing image. */
export function revokeGuestView() {
  if (guestItemId()) window.dispatchEvent(new Event(guestRevokedEvent));
}

/** Private transient data, with deliberately no recovery, export or storage API. */
export type GuestPendingBuffer = {
  snapshots: unknown[];
  focusedInput: string | null;
};
export type GuestEditorStop = (retain: boolean) => GuestPendingBuffer | null;
export type RegisterGuestEditor = (stop: GuestEditorStop | null) => void;
