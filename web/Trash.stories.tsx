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
  id: 'dashboard-trash',
  title: 'Current production/Dashboard/Trash',
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
const retained: TrashedItem[] = [
  { ...trashed(5, 'Archived projects', 'folder', 95), expiresAt: null },
  { ...trashed(6, 'Research Space', 'doc', 95), kind: 'space', expiresAt: null },
];
const retainedListing = {
  items: [...retained, items[0]],
  version: 'retained-group',
  deletion: {
    count: 6,
    items: [
      ...retained.map(({ id, name, kind }) => ({ id, name, kind })),
      { id: 'page-1', name: 'Research notes', kind: 'doc' },
      { id: 'page-2', name: 'Old draft already in Space Trash', kind: 'doc' },
      { id: 'page-3', name: 'Sources', kind: 'sheet' },
      { id: items[0].id, name: items[0].name, kind: items[0].kind },
    ],
  },
};
export const RetainedSpaceGroup: Story = {
  parameters: { api: { 'GET /api/items/trash': retainedListing } },
};
export const ConfirmCompleteSpaceGraph: Story = {
  ...RetainedSpaceGroup,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Empty trash' }),
    );
  },
};
export const SpaceGraphChanged: Story = {
  parameters: {
    api: {
      'GET /api/items/trash': retainedListing,
      'POST /api/items/trash/empty': failure(
        'Your trash changed. Review the complete contents before deleting.',
        409,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Empty trash' }),
    );
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('button', {
        name: 'Permanently delete 6 items',
      }),
    );
  },
};
