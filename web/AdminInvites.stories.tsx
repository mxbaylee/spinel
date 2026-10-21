import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { failure } from '../.storybook/api.ts';
import { AdminInvites } from './AdminInvites.tsx';

const hour = 3_600_000;
const now = Date.now();
const recipients = {
  users: [
    { id: 'u-sam', name: 'Sam Rivera', isAdmin: 1 },
    { id: 'u-alex', name: 'Alex Kim', isAdmin: 0 },
  ],
};
const invites = {
  invites: [
    {
      id: 'i1',
      expiresAt: now + 100 * hour,
      recoveryName: null,
      usedBy: null,
      status: 'Available',
    },
    {
      id: 'i2',
      expiresAt: now + 20 * hour,
      recoveryName: 'Alex Kim',
      usedBy: null,
      status: 'Available',
    },
    {
      id: 'i3',
      expiresAt: now - 30 * hour,
      recoveryName: null,
      usedBy: 'Jordan Lee',
      status: 'Used',
    },
    { id: 'i4', expiresAt: now - 200 * hour, recoveryName: null, usedBy: null, status: 'Expired' },
    { id: 'i5', expiresAt: now + 10 * hour, recoveryName: null, usedBy: null, status: 'Revoked' },
  ],
};
const loaded = {
  'GET /api/auth/invites': invites,
  'GET /api/auth/invites/recipients': recipients,
};

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  id: 'admin-admininvites',
  title: 'Current production/Admin/AdminInvites',
  component: AdminInvites,
} satisfies Meta<typeof AdminInvites>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One of each invite status. Only available invites can be revoked. */
export const Loaded: Story = { parameters: { api: loaded } };
export const Empty: Story = {
  parameters: {
    api: {
      'GET /api/auth/invites': { invites: [] },
      'GET /api/auth/invites/recipients': recipients,
    },
  },
};
/** Choosing an account switches the invite to recovery and shows what that replaces. */
export const RecoveryInvite: Story = {
  parameters: { api: loaded },
  play: async ({ canvasElement }) => {
    const select = await within(canvasElement).findByRole('option', { name: 'Recover Alex Kim' });
    await userEvent.selectOptions(select.parentElement as HTMLSelectElement, 'u-alex');
  },
};
/** The link is shown once, right after creating it. */
export const InviteCreated: Story = {
  parameters: {
    api: {
      ...loaded,
      'POST /api/auth/invites': {
        url: 'https://spinel.example.com/invite/8mHq2vXk4TnZ7rLc',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Create invite' }));
  },
};
export const LoadFailed: Story = {
  parameters: {
    api: {
      'GET /api/auth/invites': failure('Could not load invites. Try again.', 500),
      'GET /api/auth/invites/recipients': failure('Could not load invites. Try again.', 500),
    },
  },
};
export const CreateFailed: Story = {
  parameters: {
    api: { ...loaded, 'POST /api/auth/invites': failure('Could not create the invite.', 500) },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Create invite' }));
  },
};
