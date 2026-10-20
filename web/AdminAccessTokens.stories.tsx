import type { Meta, StoryObj } from '@storybook/react-vite';
import { failure, pending } from '../.storybook/api.ts';
import { AccessTokens } from './AccessTokens.tsx';

const meta = {
  title: 'Admin/AccessTokens',
  component: AccessTokens,
  args: { admin: true },
} satisfies Meta<typeof AccessTokens>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  parameters: {
    api: {
      'GET /api/auth/admin/tokens': {
        tokens: [
          {
            id: 'desktop',
            name: 'Desktop assistant',
            userId: 'alex',
            userName: 'Alex Kim',
            createdAt: Date.now() - 86_400_000,
            lastUsedAt: Date.now() - 3_600_000,
            revoked: false,
          },
          {
            id: 'old',
            name: 'Previous assistant',
            userId: 'sam',
            userName: 'Sam Rivera',
            createdAt: Date.now() - 86_400_000,
            lastUsedAt: null,
            revoked: true,
          },
        ],
      },
    },
  },
};
export const Empty: Story = {
  parameters: { api: { 'GET /api/auth/admin/tokens': { tokens: [] } } },
};
export const Loading: Story = {
  parameters: { api: { 'GET /api/auth/admin/tokens': pending() } },
};
export const LoadFailed: Story = {
  parameters: {
    api: { 'GET /api/auth/admin/tokens': failure('Could not load access tokens. Try again.', 500) },
  },
};
