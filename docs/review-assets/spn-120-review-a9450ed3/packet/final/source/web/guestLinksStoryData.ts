import type { GuestLinkEntry } from '../src/shared/guestLinks.ts';

const day = 86_400_000;
const now = Date.now();
export const guestLinkExamples: GuestLinkEntry[] = [
  {
    id: '06600000-0000-4000-8000-000000000001',
    name: 'Autumn plans',
    kind: 'doc',
    role: 'viewer',
    epoch: 1,
    enabledAt: now - 2 * day,
    expiresAt: now + 7 * day,
    status: 'active',
  },
  {
    id: '06600000-0000-4000-8000-000000000002',
    name: 'Household budget',
    kind: 'sheet',
    role: 'editor',
    epoch: 2,
    enabledAt: null,
    expiresAt: null,
    status: 'active',
  },
  {
    id: '06600000-0000-4000-8000-000000000003',
    name: 'Winter trip',
    kind: 'space',
    role: 'viewer',
    epoch: 3,
    enabledAt: now - 4 * day,
    expiresAt: now + day,
    status: 'active',
  },
  {
    id: '06600000-0000-4000-8000-000000000004',
    name: 'Summer recipes',
    kind: 'doc',
    role: 'editor',
    epoch: 4,
    enabledAt: now - 9 * day,
    expiresAt: now - 2 * day,
    status: 'expired',
  },
];
