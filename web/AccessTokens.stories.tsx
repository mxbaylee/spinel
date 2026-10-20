import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { AccessTokens } from './AccessTokens.tsx';

const token = {
  id: 'desktop',
  name: 'Desktop assistant',
  createdAt: Date.now() - 86_400_000,
  lastUsedAt: null,
  revoked: false,
};
const loaded = { 'GET /api/auth/tokens': { tokens: [token] } };
const created = {
  ...loaded,
  'POST /api/auth/tokens': { id: token.id, token: 'spinel_example_token_only_for_storybook' },
};

const meta = {
  title: 'Settings/AccessTokens',
  component: AccessTokens,
} satisfies Meta<typeof AccessTokens>;
export default meta;
type Story = StoryObj<typeof meta>;

async function create(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByRole('list', { name: 'Access tokens' });
  await userEvent.type(canvas.getByRole('textbox', { name: 'Token name' }), token.name);
  await userEvent.click(canvas.getByRole('button', { name: 'Create access token' }));
}

async function revoke(canvasElement: HTMLElement) {
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: 'Revoke Desktop assistant' }),
  );
}

// Keep each API map on its story: Storybook deep-merges meta parameters.
export const Loaded: Story = { parameters: { api: loaded } };
export const Empty: Story = {
  parameters: { api: { 'GET /api/auth/tokens': { tokens: [] } } },
};
export const Loading: Story = {
  parameters: { api: { 'GET /api/auth/tokens': pending() } },
};
export const LoadFailed: Story = {
  parameters: {
    api: { 'GET /api/auth/tokens': failure('Could not load access tokens. Try again.', 500) },
  },
};
export const Creating: Story = {
  parameters: { api: { ...loaded, 'POST /api/auth/tokens': pending() } },
  play: async ({ canvasElement }) => create(canvasElement),
};
export const Created: Story = {
  parameters: { api: created },
  play: async ({ canvasElement }) => create(canvasElement),
};
export const CreateFailed: Story = {
  parameters: {
    api: {
      ...loaded,
      'POST /api/auth/tokens': failure('Could not create the token. Try again.', 500),
    },
  },
  play: async ({ canvasElement }) => create(canvasElement),
};
export const Revoking: Story = {
  parameters: { api: { ...loaded, 'POST /api/auth/tokens/desktop/revoke': pending() } },
  play: async ({ canvasElement }) => revoke(canvasElement),
};
export const Revoked: Story = {
  parameters: { api: { ...loaded, 'POST /api/auth/tokens/desktop/revoke': {} } },
  play: async ({ canvasElement }) => revoke(canvasElement),
};
export const RevokeFailed: Story = {
  parameters: {
    api: {
      ...loaded,
      'POST /api/auth/tokens/desktop/revoke': failure(
        'Could not revoke the token. Try again.',
        500,
      ),
    },
  },
  play: async ({ canvasElement }) => revoke(canvasElement),
};
export const ActiveLimit: Story = {
  parameters: {
    api: {
      'GET /api/auth/tokens': {
        tokens: Array.from({ length: 10 }, (_, index) => ({
          ...token,
          id: `token-${index}`,
          name: `Assistant ${index + 1}`,
        })),
      },
    },
  },
};
export const PreviouslyUsed: Story = {
  parameters: {
    api: { 'GET /api/auth/tokens': { tokens: [{ ...token, lastUsedAt: Date.now() - 3_600_000 }] } },
  },
};
export const Copied: Story = {
  parameters: { api: created },
  play: async ({ canvasElement }) => {
    await create(canvasElement);
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => {} },
    });
    try {
      await userEvent.click(
        await within(canvasElement).findByRole('button', { name: 'Copy access token' }),
      );
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  },
};
export const ManualCopy: Story = {
  parameters: { api: created },
  play: async ({ canvasElement }) => {
    await create(canvasElement);
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard unavailable');
        },
      },
    });
    try {
      await userEvent.click(
        await within(canvasElement).findByRole('button', { name: 'Copy access token' }),
      );
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  },
};
