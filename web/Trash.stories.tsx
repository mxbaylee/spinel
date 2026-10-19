import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import type { ItemKind, TrashedItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { Trash } from './Trash.tsx';

const day = 86_400_000;
const now = Date.now();
const trashed = (
  n: number,
  name: string,
  kind: ItemKind,
  deletedDaysAgo: number,
  tags: string[] = [],
): TrashedItem => ({
  access: 'owner',
  id: `00000000-0000-4000-8000-0000000000${50 + n}`,
  parentId: null,
  kind,
  name,
  createdAt: now - 90 * day,
  updatedAt: now - (deletedDaysAgo + 1) * day,
  tags,
  trashedAt: now - deletedDaysAgo * day,
  expiresAt: now + (30 - deletedDaysAgo) * day,
});
const items = [
  trashed(1, 'Old budget', 'sheet', 2, ['budget']),
  trashed(2, 'Trip draft', 'doc', 11),
  trashed(3, 'Receipts 2025', 'folder', 29),
  // Past its recovery window, so Restore is disabled until the daily cleanup removes it.
  trashed(4, 'Scratch notes', 'doc', 31),
];

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.
const loaded = { 'GET /api/items/trash': { items, version: 'v1' } };

const meta = {
  title: 'Dashboard/Trash',
  component: Trash,
  args: { onChanged: async () => {} },
} satisfies Meta<typeof Trash>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithItems: Story = { parameters: { api: loaded } };
/** Empty trash is disabled when there is nothing to delete. */
export const Empty: Story = {
  parameters: { api: { 'GET /api/items/trash': { items: [], version: 'v0' } } },
};
export const Loading: Story = { parameters: { api: { 'GET /api/items/trash': pending() } } };
export const LoadFailed: Story = {
  parameters: {
    api: { 'GET /api/items/trash': failure('Could not load your trash. Try again.', 500) },
  },
};
/** Emptying asks first, and the confirmation counts the items it will remove. */
export const ConfirmEmpty: Story = {
  parameters: { api: loaded },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Empty trash' }),
    );
  },
};
