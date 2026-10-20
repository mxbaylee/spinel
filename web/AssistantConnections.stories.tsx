import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { AssistantConnections } from './AssistantConnections.tsx';

const connection = {
  id: 'desktop',
  name: 'Desktop assistant',
  redirectOrigin: 'https://assistant.example',
  createdAt: Date.now() - 86_400_000,
  lastUsedAt: null,
  revoked: false,
  scopes: ['documents:read', 'documents:write'],
};
const loaded = { 'GET /api/auth/connections': { connections: [connection] } };
const meta = {
  title: 'Settings/AssistantConnections',
  component: AssistantConnections,
} satisfies Meta<typeof AssistantConnections>;
export default meta;
type Story = StoryObj<typeof meta>;

const disconnect = async (canvasElement: HTMLElement) => {
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: 'Disconnect Desktop assistant' }),
  );
};
export const Loaded: Story = { parameters: { api: loaded } };
export const Empty: Story = {
  parameters: { api: { 'GET /api/auth/connections': { connections: [] } } },
};
export const Loading: Story = { parameters: { api: { 'GET /api/auth/connections': pending() } } };
export const LoadFailed: Story = {
  parameters: { api: { 'GET /api/auth/connections': failure('Unavailable', 500) } },
};
export const Disconnecting: Story = {
  parameters: { api: { ...loaded, 'POST /api/auth/connections/desktop/revoke': pending() } },
  play: async ({ canvasElement }) => disconnect(canvasElement),
};
export const Disconnected: Story = {
  parameters: { api: { ...loaded, 'POST /api/auth/connections/desktop/revoke': {} } },
  play: async ({ canvasElement }) => disconnect(canvasElement),
};
export const DisconnectFailed: Story = {
  parameters: {
    api: { ...loaded, 'POST /api/auth/connections/desktop/revoke': failure('Unavailable', 500) },
  },
  play: async ({ canvasElement }) => disconnect(canvasElement),
};
export const MatchingNames: Story = {
  parameters: {
    api: {
      'GET /api/auth/connections': {
        connections: [
          connection,
          { ...connection, id: 'other', redirectOrigin: 'https://another-assistant.example' },
        ],
      },
    },
  },
};
export const PreviouslyUsed: Story = {
  parameters: {
    api: {
      'GET /api/auth/connections': {
        connections: [{ ...connection, lastUsedAt: Date.now() - 3_600_000 }],
      },
    },
  },
};
export const AdminMetadata: Story = {
  args: { admin: true },
  parameters: {
    api: {
      'GET /api/auth/admin/connections': {
        connections: [
          { ...connection, userName: 'Alex Kim', lastUsedAt: Date.now() - 3_600_000 },
          {
            ...connection,
            id: 'old',
            name: 'Previous assistant',
            userName: 'Sam Rivera',
            revoked: true,
          },
        ],
      },
    },
  },
};
export const AdminEmpty: Story = {
  args: { admin: true },
  parameters: { api: { 'GET /api/auth/admin/connections': { connections: [] } } },
};
export const AdminLoading: Story = {
  args: { admin: true },
  parameters: { api: { 'GET /api/auth/admin/connections': pending() } },
};
export const AdminLoadFailed: Story = {
  args: { admin: true },
  parameters: { api: { 'GET /api/auth/admin/connections': failure('Unavailable', 500) } },
};
