import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { SpaceFile, WorkspaceItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { SpaceRootActions } from './SpaceRootActions.tsx';

const item: SpaceFile = {
  id: '00000000-0000-4000-8000-000000000301',
  parentId: null,
  kind: 'space',
  name: 'Research Space',
  access: 'owner',
  tags: ['research'],
  createdAt: Date.UTC(2026, 8, 1),
  updatedAt: Date.UTC(2026, 9, 22),
};
const folder: WorkspaceItem = {
  ...item,
  id: '00000000-0000-4000-8000-000000000302',
  kind: 'folder',
  name: 'Projects',
};
const nested: WorkspaceItem = {
  ...folder,
  id: '00000000-0000-4000-8000-000000000303',
  name: 'Research',
  parentId: folder.id,
};
const loaded = { 'GET /api/items': { items: [folder, nested, item] } };
const meta = {
  id: 'spaces-root-actions',
  title: 'Current production/Spaces/Root actions',
  component: SpaceRootActions,
  args: { item, onChanged: fn(), onTrashed: fn(), beforeChange: () => true },
  render: (args) => (
    <div className="sp-ui">
      <h2>{args.item.name}</h2>
      <SpaceRootActions {...args} />
    </div>
  ),
} satisfies Meta<typeof SpaceRootActions>;
export default meta;
type Story = StoryObj<typeof meta>;
async function choose(canvasElement: HTMLElement, name: string) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Space actions for Research Space' }),
  );
  await userEvent.click(
    await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name }),
  );
}
export const Owner: Story = {};
export const Viewer: Story = {
  args: { item: { ...item, access: 'viewer', ownerName: 'Alex Kim' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Space actions for Research Space' }),
    ).not.toBeInTheDocument();
  },
};
export const Rename: Story = { play: ({ canvasElement }) => choose(canvasElement, 'Rename') };
export const Move: Story = {
  parameters: { api: loaded },
  play: ({ canvasElement }) => choose(canvasElement, 'Move'),
};
export const LoadingDestinations: Story = {
  parameters: { api: { 'GET /api/items': pending() } },
  play: ({ canvasElement }) => choose(canvasElement, 'Move'),
};
export const DestinationFailure: Story = {
  parameters: {
    api: { 'GET /api/items': failure('Could not load your folders. Try again.', 503) },
  },
  play: ({ canvasElement }) => choose(canvasElement, 'Move'),
};
export const WholeSpaceTrash: Story = {
  play: ({ canvasElement }) => choose(canvasElement, 'Move to Trash'),
};
export const ShareWholeSpace: Story = {
  parameters: {
    api: {
      [`GET /api/items/${item.id}/sharing`]: {
        people: [
          {
            id: 'collaborator',
            name: 'Alex Kim',
            disabled: 0,
            directRole: 'editor',
            effectiveRole: 'editor',
          },
        ],
      },
      [`GET /api/items/${item.id}/link`]: { enabled: false, role: 'viewer' },
    },
  },
  play: ({ canvasElement }) => choose(canvasElement, 'Share'),
};
export const SaveFailure: Story = {
  parameters: {
    api: {
      [`PATCH /api/items/${item.id}`]: failure(
        'The Space is not available. Refresh and try again.',
        404,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    await choose(canvasElement, 'Rename');
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('button', { name: 'Save' }),
    );
  },
};
