import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SharePerson, WorkspaceItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { Sharing } from './Sharing.tsx';

const doc: WorkspaceItem = {
  access: 'owner',
  id: '00000000-0000-4000-8000-000000000081',
  parentId: null,
  kind: 'doc',
  name: 'Trip plan',
  createdAt: Date.UTC(2026, 8, 1),
  updatedAt: Date.UTC(2026, 9, 12),
  tags: [],
};
const folder: WorkspaceItem = {
  ...doc,
  id: '00000000-0000-4000-8000-000000000082',
  kind: 'folder',
  name: 'Household',
};
const sharing = (item: WorkspaceItem) => `GET /api/items/${item.id}/sharing`;
// Sharing also embeds the guest link control for sheets and docs.
const link = (item: WorkspaceItem) => `GET /api/items/${item.id}/link`;
const noLink = { enabled: false, role: 'viewer' };

const people: SharePerson[] = [
  { id: 'u-alex', name: 'Alex Kim', disabled: 0, directRole: 'editor', effectiveRole: 'editor' },
  {
    id: 'u-jordan',
    name: 'Jordan Lee',
    disabled: 0,
    directRole: 'viewer',
    effectiveRole: 'viewer',
  },
  // Access arrives through a shared parent folder, so there is no direct grant to change.
  { id: 'u-priya', name: 'Priya Patel', disabled: 0, directRole: null, effectiveRole: 'viewer' },
  { id: 'u-morgan', name: 'Morgan Ellis', disabled: 0, directRole: null, effectiveRole: null },
  {
    id: 'u-taylor',
    name: 'Taylor Brooks',
    disabled: 1,
    directRole: 'viewer',
    effectiveRole: 'viewer',
  },
];

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  id: 'sharing-sharing',
  title: 'Current production/Sharing/Sharing',
  component: Sharing,
  args: { item: doc, onClose: () => {} },
} satisfies Meta<typeof Sharing>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  parameters: { api: { [sharing(doc)]: pending(), [link(doc)]: noLink } },
};
/** The owner is the only account, so there is nobody to share with. */
export const OwnerOnly: Story = {
  parameters: { api: { [sharing(doc)]: { people: [] }, [link(doc)]: noLink } },
};
/** Viewer and editor grants, access inherited from a folder, no access, and a disabled account. */
export const WithPeople: Story = {
  parameters: { api: { [sharing(doc)]: { people }, [link(doc)]: noLink } },
};
/** Folders have no guest link section. */
export const Folder: Story = {
  args: { item: folder },
  parameters: { api: { [sharing(folder)]: { people } } },
};
export const Failed: Story = {
  parameters: {
    api: {
      [sharing(doc)]: failure('You can no longer change sharing for this item.', 403),
      [link(doc)]: noLink,
    },
  },
};
