import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import type { ItemKind, WorkspaceItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { PinnedSidebar, PinsProvider } from './Pins.tsx';

const pinned = (
  n: number,
  name: string,
  kind: ItemKind,
  extra: Partial<WorkspaceItem> = {},
): WorkspaceItem => ({
  access: 'owner',
  id: `00000000-0000-4000-8000-0000000000${30 + n}`,
  parentId: null,
  kind,
  name,
  createdAt: Date.UTC(2026, 8, 1),
  updatedAt: Date.UTC(2026, 9, 12),
  tags: [],
  ...extra,
});
const items = [
  pinned(1, 'Quarterly budget', 'sheet', { tags: ['budget', 'q4'] }),
  pinned(2, 'Trip plan', 'doc'),
  pinned(3, 'Household', 'folder'),
  pinned(4, 'Shared roadmap', 'doc', { access: 'editor', ownerName: 'Alex Kim', tags: ['work'] }),
];
// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.
const withPins: Decorator = (Story) => (
  <PinsProvider enabled>
    <Story />
  </PinsProvider>
);

const meta = {
  id: 'dashboard-pinnedsidebar',
  title: 'Current production/Dashboard/PinnedSidebar',
  component: PinnedSidebar,
  args: { navigation: { allow: () => true, dirty() {} } },
  decorators: [withPins],
} satisfies Meta<typeof PinnedSidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Pins in order, including one shared with me; each can be reordered or unpinned. */
export const Pinned: Story = { parameters: { api: { 'GET /api/items/pins': { items } } } };
export const Empty: Story = { parameters: { api: { 'GET /api/items/pins': { items: [] } } } };
export const Loading: Story = { parameters: { api: { 'GET /api/items/pins': pending() } } };
export const LoadFailed: Story = {
  parameters: { api: { 'GET /api/items/pins': failure('Could not load pins. Try again.', 500) } },
};
