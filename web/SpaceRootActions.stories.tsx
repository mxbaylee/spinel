import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
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

/** Hold the real request across leaving the view or receiving another root. */
function DelayedAction({
  replace,
  ...args
}: ComponentProps<typeof SpaceRootActions> & { replace: boolean }) {
  const [left, setLeft] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(false);
  const [finished, setFinished] = useState(false);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const previous = globalThis.fetch;
    const delayed: typeof fetch = async (input, init) => {
      if (input !== `/api/items/${item.id}` && input !== `/api/items/${item.id}/trash`)
        return previous(input, init);
      setPendingRequest(true);
      await new Promise<void>((resolve) => {
        release.current = resolve;
      });
      return Response.json({ item: { ...item, name: 'Updated research' } });
    };
    globalThis.fetch = delayed;
    return () => {
      release.current?.();
      if (globalThis.fetch === delayed) globalThis.fetch = previous;
    };
  }, []);
  return (
    <div className="sp-ui">
      {(!left || replace) && (
        <SpaceRootActions
          {...args}
          item={left ? { ...item, id: nested.id, name: 'Another Space' } : item}
        />
      )}
      <button type="button" onClick={() => setLeft(true)}>
        Leave current Space
      </button>
      <button
        type="button"
        disabled={!pendingRequest}
        onClick={() => {
          release.current?.();
          // Report completion after the response/json microtasks and React updates.
          requestAnimationFrame(() => requestAnimationFrame(() => setFinished(true)));
        }}
      >
        Complete delayed response
      </button>
      {finished && <p role="status">Delayed response completed</p>}
    </div>
  );
}

async function leaveDuringAction(
  canvasElement: HTMLElement,
  args: ComponentProps<typeof SpaceRootActions>,
  action: 'Rename' | 'Move to Trash',
) {
  await choose(canvasElement, action);
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(
    await body.findByRole('button', {
      name: action === 'Rename' ? 'Save' : 'Move Space to Trash',
    }),
  );
  const canvas = within(canvasElement);
  // Browser Back can leave even while the modal is saving. Use the fixture
  // control directly because the modal correctly makes background UI inert.
  canvas.getByRole('button', { name: 'Leave current Space', hidden: true }).click();
  await userEvent.click(await canvas.findByRole('button', { name: 'Complete delayed response' }));
  await canvas.findByText('Delayed response completed');
  await expect(args.onChanged).not.toHaveBeenCalled();
  await expect(args.onTrashed).not.toHaveBeenCalled();
}

export const LeaveDuringRename: Story = {
  render: (args) => <DelayedAction {...args} replace={false} />,
  play: ({ canvasElement, args }) => leaveDuringAction(canvasElement, args, 'Rename'),
};
export const ReplaceDuringRename: Story = {
  render: (args) => <DelayedAction {...args} replace />,
  play: async ({ canvasElement, args }) => {
    await leaveDuringAction(canvasElement, args, 'Rename');
    await expect(
      within(canvasElement).getByRole('button', {
        name: 'Space actions for Another Space',
      }),
    ).toBeEnabled();
  },
};
export const LeaveDuringTrash: Story = {
  render: (args) => <DelayedAction {...args} replace={false} />,
  play: ({ canvasElement, args }) => leaveDuringAction(canvasElement, args, 'Move to Trash'),
};
