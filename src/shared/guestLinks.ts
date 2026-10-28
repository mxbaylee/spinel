import type { GuestRole } from './workspace.ts';

export type GuestLinkExpiryDays = 1 | 7 | 30 | null;

/** Owner inventory deliberately carries no guest or social-preview capability. */
export interface GuestLinkEntry {
  id: string;
  name: string;
  kind: 'doc' | 'sheet' | 'space';
  role: GuestRole;
  epoch: number;
  enabledAt: number | null;
  expiresAt: number | null;
  status: 'active' | 'expired';
}
