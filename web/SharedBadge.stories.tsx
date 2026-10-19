import type { Meta, StoryObj } from '@storybook/react-vite';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { SharedBadge } from './SharedItems.tsx';

const base: WorkspaceItem = {
  access: 'owner',
  id: '00000000-0000-4000-8000-000000000001',
  parentId: null,
  kind: 'doc',
  name: 'Trip plan',
  createdAt: Date.UTC(2026, 8, 1),
  updatedAt: Date.UTC(2026, 9, 12),
  tags: [],
};

const meta = {
  title: 'Dashboard/SharedBadge',
  component: SharedBadge,
} satisfies Meta<typeof SharedBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Renders nothing: items you own carry no badge, so this canvas is empty. */
export const Owned: Story = { args: { item: base } };
/** Shown beside items another person shared with you, with the owner's name. */
export const SharedWithMe: Story = {
  args: {
    item: { ...base, access: 'viewer', ownerName: 'Alex Kim', sharedAt: Date.UTC(2026, 9, 10) },
  },
};
export const SharedEditor: Story = {
  args: {
    item: { ...base, access: 'editor', ownerName: 'Alex Kim', sharedAt: Date.UTC(2026, 9, 10) },
  },
};
/** Falls back to the word "Owner" when the owner's name is unknown. */
export const UnknownOwner: Story = { args: { item: { ...base, access: 'viewer' } } };
