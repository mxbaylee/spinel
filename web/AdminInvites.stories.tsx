import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
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
export const Loading: Story = {
  parameters: {
    api: { 'GET /api/auth/invites': pending(), 'GET /api/auth/invites/recipients': pending() },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Loading invites…')).toBeVisible();
    await expect(canvas.queryByText('No invites yet.')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Create invite' })).toBeDisabled();
  },
};
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
    const button = within(canvasElement).getByRole('button', { name: 'Create invite' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const select = await within(document.body).findByRole('option', { name: 'Recover Alex Kim' });
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
    const button = within(canvasElement).getByRole('button', { name: 'Create invite' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const dialog = await within(document.body).findByRole('dialog', { name: 'Create invite' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create invite' }));
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
    const button = within(canvasElement).getByRole('button', { name: 'Create invite' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const dialog = await within(document.body).findByRole('dialog', { name: 'Create invite' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create invite' }));
  },
};

function InvitationReadbackFixture({ operation }: { operation: 'create' | 'revoke' }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = globalThis.fetch;
    let mutated = false;
    let failedReadback = false;
    const fixtureFetch: typeof fetch = async (input, init) => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      ).pathname;
      if (path === '/api/auth/invites' && init?.method === 'POST') {
        mutated = true;
        return Response.json({ url: 'https://spinel.example.com/invite#new-once-only-address' });
      }
      if (path === '/api/auth/invites/retained/revoke') {
        mutated = true;
        return new Response(null, { status: 204 });
      }
      if (path === '/api/auth/invites') {
        if (mutated && !failedReadback) {
          failedReadback = true;
          return Response.json({ error: 'Could not refresh invitations.' }, { status: 503 });
        }
        return Response.json({
          invites:
            !mutated && operation === 'create'
              ? []
              : [
                  {
                    id: 'retained',
                    expiresAt: now + 100 * hour,
                    recoveryName: null,
                    usedBy: null,
                    status: mutated && operation === 'revoke' ? 'Revoked' : 'Available',
                  },
                ],
        });
      }
      if (path === '/api/auth/invites/recipients') return Response.json(recipients);
      return original(input, init);
    };
    globalThis.fetch = fixtureFetch;
    setReady(true);
    return () => {
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = original;
    };
  }, [operation]);
  return ready ? <AdminInvites /> : null;
}

const failedReadback =
  (operation: 'create' | 'revoke'): NonNullable<Story['play']> =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    if (operation === 'create') {
      const action = await canvas.findByRole('button', { name: 'Create invite' });
      await waitFor(() => expect(action).toBeEnabled());
      await userEvent.click(action);
      const dialog = await within(document.body).findByRole('dialog', { name: 'Create invite' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create invite' }));
    } else {
      await userEvent.click(await canvas.findByRole('button', { name: 'Actions for invite 1' }));
      await userEvent.click(
        await within(document.body).findByRole('menuitem', { name: 'Revoke invite' }),
      );
    }
    await expect(await canvas.findByRole('button', { name: 'Refresh invites' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Create invite' })).toBeDisabled();
    await expect(canvas.queryByText('No invites yet.')).toBeNull();
    await expect(canvas.queryByRole('list', { name: 'Invites' })).toBeNull();
    await expect(canvas.getByRole('status')).toHaveTextContent(
      operation === 'create' ? 'Invite created.' : 'Invite revoked.',
    );
    if (operation === 'create') {
      await expect(canvas.getByRole('textbox', { name: 'New invite link' })).toHaveValue(
        'https://spinel.example.com/invite#new-once-only-address',
      );
      await waitFor(() =>
        expect(canvas.getByRole('textbox', { name: 'New invite link' })).toBeFocused(),
      );
    }
  };
export const CreatedButReadbackFailed: Story = {
  render: () => <InvitationReadbackFixture operation="create" />,
  play: failedReadback('create'),
};
export const CreatedWhileReadbackPending: Story = {
  parameters: { api: loaded },
  play: async ({ canvasElement }) => {
    const original = globalThis.fetch;
    let created = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixtureFetch: typeof fetch = async (input, init) => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      ).pathname;
      if (path === '/api/auth/invites' && init?.method === 'POST') {
        created = true;
        return Response.json({ url: 'https://spinel.example.com/invite#new-once-only-address' });
      }
      if (path === '/api/auth/invites' && created) {
        await gate;
        return Response.json({ error: 'Could not refresh invitations.' }, { status: 503 });
      }
      return original(input, init);
    };
    globalThis.fetch = fixtureFetch;
    try {
      const canvas = within(canvasElement);
      const create = canvas.getByRole('button', { name: 'Create invite' });
      await waitFor(() => expect(create).toBeEnabled());
      await userEvent.click(create);
      const dialog = await within(document.body).findByRole('dialog', { name: 'Create invite' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create invite' }));
      const address = await canvas.findByRole('textbox', { name: 'New invite link' });
      await waitFor(() => expect(address).toBeFocused());
      await expect(address).toHaveValue('https://spinel.example.com/invite#new-once-only-address');
      await expect(create).toBeDisabled();
      await expect(canvas.getByText('Loading invites…')).toBeVisible();
      release();
      await waitFor(() =>
        expect(canvas.getByRole('button', { name: 'Refresh invites' })).toBeEnabled(),
      );
      await expect(canvas.getByRole('alert')).toHaveTextContent(
        'The current invitation list is unavailable.',
      );
      await expect(address).toBeFocused();
      await expect(create).toBeDisabled();
    } finally {
      release();
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = original;
    }
  },
};
export const RevokedButReadbackFailed: Story = {
  render: () => <InvitationReadbackFixture operation="revoke" />,
  play: failedReadback('revoke'),
};
export const RefreshAfterCreated: Story = {
  render: () => <InvitationReadbackFixture operation="create" />,
  play: async (context) => {
    await failedReadback('create')(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Refresh invites' }));
    await expect(await canvas.findByRole('list', { name: 'Invites' })).toHaveTextContent(
      'Available',
    );
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getByRole('textbox', { name: 'New invite link' })).toHaveValue(
      'https://spinel.example.com/invite#new-once-only-address',
    );
  },
};
export const RefreshAfterRevoked: Story = {
  render: () => <InvitationReadbackFixture operation="revoke" />,
  play: async (context) => {
    await failedReadback('revoke')(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Refresh invites' }));
    await expect(await canvas.findByRole('list', { name: 'Invites' })).toHaveTextContent('Revoked');
    await expect(canvas.queryByRole('button', { name: /^Actions for invite/ })).toBeNull();
    await expect(canvas.queryByRole('alert')).toBeNull();
  },
};
