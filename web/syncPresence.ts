import type { Univer } from '@univerjs/core';

/** Identity is supplied by the authenticated room; cursor updates contain no profile data. */
export interface SyncPresenceMember {
  id: string;
  name: string;
  avatar: string;
  selection?: string;
}

export interface SyncPresenceState {
  selfId: string;
  members: SyncPresenceMember[];
  connected: boolean;
}

export interface SyncPresenceChannel {
  subscribe(callback: (state: SyncPresenceState) => void): () => void;
  setCursor(selection: string): void;
}

const channels = new WeakMap<Univer, Map<string, { channel: SyncPresenceChannel }>>();

/** The socket owner registers before mounting presence and unregisters on editor disposal. */
export function setSyncPresence(
  univer: Univer,
  unitId: string,
  channel: SyncPresenceChannel,
): () => void {
  let units = channels.get(univer);
  if (!units) {
    units = new Map();
    channels.set(univer, units);
  }
  const registration = { channel };
  units.set(unitId, registration);
  return () => {
    // A retiring editor cannot unregister the replacement connection for this unit.
    if (units.get(unitId) === registration) units.delete(unitId);
  };
}

export function getSyncPresence(univer: Univer, unitId: string): SyncPresenceChannel | undefined {
  return channels.get(univer)?.get(unitId)?.channel;
}
