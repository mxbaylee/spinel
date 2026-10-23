import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { ConnectAssistant } from './ConnectAssistant.tsx';

const request = '12345678-1234-4234-8234-123456789abc';
const path = `/api/auth/oauth/pending/${request}`;
const details = {
  request,
  name: 'Desktop assistant',
  redirectOrigin: 'https://assistant.example',
  scopes: ['documents:read', 'documents:write'],
  expiresAt: Date.now() + 600_000,
};
const meta = {
  id: 'settings-connectassistant',
  title: 'Current production/Settings/ConnectAssistant',
  component: ConnectAssistant,
  parameters: { shell: 'none' },
  args: { request, user: { name: 'Alex Kim', isAdmin: false }, onSignOut: fn() },
} satisfies Meta<typeof ConnectAssistant>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Consent: Story = { parameters: { api: { [`GET ${path}`]: details } } };
export const ReadOnly: Story = {
  parameters: { api: { [`GET ${path}`]: { ...details, scopes: ['documents:read'] } } },
};
export const Loading: Story = { parameters: { api: { [`GET ${path}`]: pending() } } };
export const LoadFailed: Story = {
  parameters: { api: { [`GET ${path}`]: failure('Unavailable', 500) } },
};
export const Expired: Story = { parameters: { api: { [`GET ${path}`]: failure('Expired', 410) } } };
export const Unavailable: Story = {
  parameters: { api: { [`GET ${path}`]: failure('Unavailable', 403) } },
};
export const MissingRequest: Story = { args: { request: null } };
export const AdminAccount: Story = {
  args: { user: { name: 'Workspace operator', isAdmin: true } },
};
export const Allowing: Story = {
  parameters: { api: { [`GET ${path}`]: details, [`POST ${path}`]: pending() } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Allow' }));
  },
};
export const Cancelling: Story = {
  parameters: { api: { [`GET ${path}`]: details, [`POST ${path}`]: pending() } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Cancel' }));
  },
};
export const SubmitFailed: Story = {
  parameters: { api: { [`GET ${path}`]: details, [`POST ${path}`]: failure('Unavailable', 500) } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Allow' }));
  },
};
export const ExpiredBeforeAllow: Story = {
  parameters: { api: { [`GET ${path}`]: details, [`POST ${path}`]: failure('Expired', 410) } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Allow' }));
  },
};

export const ConnectionLimit: Story = {
  parameters: {
    api: {
      [`GET ${path}`]: details,
      [`POST ${path}`]: failure('Disconnect an old assistant in settings first (limit 10).', 409),
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Allow' }));
  },
};

export const LongIdentity: Story = {
  args: { user: { name: 'A very long everyday account name that remains readable on a phone', isAdmin: false } },
  parameters: { api: { [`GET ${path}`]: { ...details, name: 'ClientSuppliedName'.repeat(12), redirectOrigin: `https://${'long-origin-'.repeat(8)}example.test` } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Allow' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await expect(canvas.getByText('This name is provided by the assistant and has not been verified by Spinel.')).toBeVisible();
  },
};

export const SignOutFailed: Story = {
  ...Consent,
  args: { signOutError: 'Could not sign out. Check your connection and try again.' },
};
