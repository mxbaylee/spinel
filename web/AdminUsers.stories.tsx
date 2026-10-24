import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { AdminUsers } from './AdminUsers.tsx';

const day = 86_400_000;
const now = Date.now();
const users = [
  {
    id: 'u-sam',
    name: 'Sam Rivera',
    isAdmin: true,
    disabled: false,
    passkeys: [
      {
        id: 'pk-1',
        name: 'MacBook',
        provider: 'iCloud Keychain',
        createdAt: now - 90 * day,
        lastUsedAt: now - 2 * day,
      },
      {
        id: 'pk-2',
        name: 'Security key',
        provider: 'YubiKey',
        createdAt: now - 60 * day,
        lastUsedAt: null,
      },
    ],
  },
  {
    id: 'u-alex',
    name: 'Alex Kim',
    isAdmin: false,
    disabled: false,
    passkeys: [
      {
        id: 'pk-3',
        name: 'Phone',
        provider: '1Password',
        createdAt: now - 40 * day,
        lastUsedAt: now - 1 * day,
      },
    ],
  },
  // An active account with no passkeys is recovered with an invite.
  { id: 'u-jordan', name: 'Jordan Lee', isAdmin: false, disabled: false, passkeys: [] },
  {
    id: 'u-priya',
    name: 'Priya Patel',
    isAdmin: false,
    disabled: true,
    passkeys: [],
  },
];
const loaded = {
  'GET /api/auth/admin/users': { users },
  'GET /api/auth/invites': { invites: [] },
  'GET /api/auth/invites/recipients': { users: [{ id: 'u-alex', name: 'Alex Kim', isAdmin: 0 }] },
};

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  id: 'admin-adminusers',
  title: 'Current production/Admin/AdminUsers',
  component: AdminUsers,
  args: { currentId: 'u-sam' },
} satisfies Meta<typeof AdminUsers>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The signed-in admin cannot disable themselves. Recovery invitations are reached from the composed administration screen. */
export const Loaded: Story = { parameters: { api: loaded } };
export const Loading: Story = {
  parameters: { api: { ...loaded, 'GET /api/auth/admin/users': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Loading users…')).toBeVisible();
    await expect(canvas.queryByText('No accounts are available.')).toBeNull();
  },
};
export const Empty: Story = {
  parameters: { api: { ...loaded, 'GET /api/auth/admin/users': { users: [] } } },
};
/** A lone admin with a single passkey cannot remove it. */
export const LastAdminPasskey: Story = {
  parameters: {
    api: {
      ...loaded,
      'GET /api/auth/admin/users': {
        users: users.slice(0, 1).map((user) => ({ ...user, passkeys: user.passkeys.slice(0, 1) })),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(document.body);
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Actions for Sam Rivera' }),
    );
    await userEvent.click(await body.findByRole('menuitem', { name: 'Manage passkeys' }));
    await expect(
      await body.findByText(
        'This admin’s last passkey cannot be removed. Add another passkey first.',
      ),
    ).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Actions for passkey MacBook' }));
    await expect(await body.findByRole('menuitem', { name: 'Remove passkey…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};
export const LoadFailed: Story = {
  parameters: {
    api: { ...loaded, 'GET /api/auth/admin/users': failure('Admin access is required.', 403) },
  },
};
export const ConfirmDisable: Story = {
  parameters: { api: loaded },
  play: async ({ canvasElement }) => {
    const account = await within(canvasElement).findByRole('region', { name: 'Alex Kim account' });
    await userEvent.click(within(account).getByRole('button', { name: 'Actions for Alex Kim' }));
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Disable account…' }),
    );
  },
};
export const ConfirmPasskeyRemoval: Story = {
  parameters: { api: loaded },
  play: async ({ canvasElement }) => {
    const body = within(document.body);
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Actions for Alex Kim' }),
    );
    await userEvent.click(await body.findByRole('menuitem', { name: 'Manage passkeys' }));
    await userEvent.click(await body.findByRole('button', { name: 'Actions for passkey Phone' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Remove passkey…' }));
  },
};
/** The confirmation stays open and shows the server's reason. */
export const RemovalFailed: Story = {
  parameters: {
    api: {
      ...loaded,
      'POST /api/auth/admin/users/u-alex/disable': failure(
        'That account was already removed.',
        404,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const account = await within(canvasElement).findByRole('region', { name: 'Alex Kim account' });
    await userEvent.click(within(account).getByRole('button', { name: 'Actions for Alex Kim' }));
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Disable account…' }),
    );
    const dialog = await within(document.body).findByRole('dialog', { name: 'Disable Alex Kim?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm removal' }));
  },
};
