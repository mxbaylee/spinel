import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test';
import type { SpaceFile, WorkspaceItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
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
    await within(canvasElement).findByRole('button', { name: 'Space actions for Research Space' }),
  );
  await userEvent.click(
    await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name }),
  );
}
async function themedTarget(control: HTMLElement, dialog: HTMLElement) {
  const touch = window.matchMedia('(pointer: coarse), (max-width: 640px)').matches;
  await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(touch ? 44 : 40);
  await expect(getComputedStyle(control).backgroundColor).toBe(
    getComputedStyle(dialog).backgroundColor,
  );
  await expect(getComputedStyle(control).color).toBe(getComputedStyle(dialog).color);
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
  play: async ({ canvasElement }) => {
    await choose(canvasElement, 'Move');
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Move Space',
    });
    await themedTarget(await within(dialog).findByLabelText('Destination'), dialog);
  },
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
      [`POST /api/items/${item.id}/sharing/review`]: {
        review: {
          version: 'a'.repeat(64),
          userId: 'collaborator',
          hostRole: 'editor',
          hostAccess: 'editor',
          targets: [],
          unavailable: false,
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    await choose(canvasElement, 'Share');
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Share Research Space',
    });
    const sharing = within(dialog);
    await expect(sharing.getByRole('tab', { name: 'People' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(await sharing.findByRole('button', { name: 'Edit access for Alex Kim' }));
    await themedTarget(sharing.getByLabelText('Access for Alex Kim'), dialog);
    await expect(sharing.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await themedTarget(sharing.getByRole('button', { name: 'Cancel' }), dialog);
    await assertDialogControls(dialog);
    await userEvent.click(sharing.getByRole('tab', { name: 'Link' }));
    await themedTarget(await sharing.findByLabelText('Link access'), dialog);
    await expect(sharing.getByRole('button', { name: 'Create link' })).toBeEnabled();
    await assertDialogControls(dialog);
    await userEvent.click(sharing.getByRole('tab', { name: 'People' }));
    await userEvent.click(sharing.getByRole('button', { name: 'Edit access for Alex Kim' }));
    await expect(sharing.getByLabelText('Access for Alex Kim')).toHaveValue('editor');
    await expect(sharing.queryByRole('alert')).not.toBeInTheDocument();
  },
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

const nextSpace: SpaceFile = {
  ...item,
  id: '00000000-0000-4000-8000-000000000304',
  name: 'Next Space',
};

/** Browser Back can replace or unmount the parent even while its modal is busy. */
function HeldRootResponse({
  unmount = false,
  fail = false,
  ...args
}: ComponentProps<typeof SpaceRootActions> & { unmount?: boolean; fail?: boolean }) {
  const [ready, setReady] = useState(false);
  const [moved, setMoved] = useState(false);
  const [phase, setPhase] = useState('Ready');
  const [draft, setDraft] = useState('Unsaved writing in the next Space.');
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    const previousFetch = globalThis.fetch;
    const fixtureFetch: typeof fetch = async (input, init) => {
      if (
        (input === `/api/items/${item.id}/trash` && init?.method === 'POST') ||
        (input === `/api/items/${item.id}` && init?.method === 'PATCH')
      ) {
        setPhase('Previous response held');
        return new Promise<Response>((resolve) => {
          release.current = () => {
            release.current = null;
            resolve(
              Response.json(
                fail
                  ? { error: 'The previous Space is no longer available.' }
                  : { item: { ...item, name: 'Earlier update' } },
                { status: fail ? 404 : 200 },
              ),
            );
            setPhase('Previous response released');
          };
        });
      }
      return previousFetch(input, init);
    };
    globalThis.fetch = fixtureFetch;
    setReady(true);
    return () => {
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = previousFetch;
      release.current = null;
    };
  }, [fail]);
  if (!ready) return null;
  return (
    <div className="sp-ui">
      <h2>{moved ? nextSpace.name : item.name}</h2>
      <p role="status">{phase}</p>
      <button data-testid="navigate-away" onClick={() => setMoved(true)}>
        Simulate browser navigation
      </button>
      <button
        data-testid="release-response"
        disabled={phase !== 'Previous response held'}
        onClick={() => release.current?.()}
      >
        Release previous response
      </button>
      {moved && (
        <label>
          Current editor draft
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
      )}
      {(!moved || !unmount) && (
        <SpaceRootActions
          {...args}
          item={moved ? nextSpace : item}
          onChanged={(updated) => {
            args.onChanged(updated);
            setDraft('');
          }}
          onTrashed={() => {
            args.onTrashed();
            setDraft('');
          }}
        />
      )}
    </div>
  );
}

async function leaveWhileSaving(canvasElement: HTMLElement, mode: 'Rename' | 'Move to Trash') {
  await choose(canvasElement, mode);
  await userEvent.click(
    within(canvasElement.ownerDocument.body).getByRole('button', {
      name: mode === 'Rename' ? /^Save$/ : /^Move Space to Trash$/,
    }),
  );
  const canvas = within(canvasElement);
  await canvas.findByText('Previous response held');
  // This models a route update from outside the busy modal, not a pointer click behind it.
  fireEvent.click(canvas.getByTestId('navigate-away'));
  await canvas.findByLabelText('Current editor draft');
}

async function releasePrevious(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  fireEvent.click(canvas.getByTestId('release-response'));
  await canvas.findByText('Previous response released');
  // Let the response body and the component's async continuation finish before checking.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export const TrashResponseAfterNavigation: Story = {
  render: (args) => <HeldRootResponse {...args} />,
  play: async ({ canvasElement, args }) => {
    await leaveWhileSaving(canvasElement, 'Move to Trash');
    await releasePrevious(canvasElement);
    await expect(args.onTrashed).not.toHaveBeenCalled();
    await expect(args.onChanged).not.toHaveBeenCalled();
    await expect(within(canvasElement).getByLabelText('Current editor draft')).toHaveValue(
      'Unsaved writing in the next Space.',
    );
    await expect(
      within(canvasElement).getByRole('button', { name: 'Space actions for Next Space' }),
    ).toBeEnabled();
  },
};

export const RenameResponseAfterUnmount: Story = {
  render: (args) => <HeldRootResponse {...args} unmount />,
  play: async ({ canvasElement, args }) => {
    await leaveWhileSaving(canvasElement, 'Rename');
    await releasePrevious(canvasElement);
    await expect(args.onChanged).not.toHaveBeenCalled();
    await expect(args.onTrashed).not.toHaveBeenCalled();
    await expect(within(canvasElement).getByLabelText('Current editor draft')).toHaveValue(
      'Unsaved writing in the next Space.',
    );
  },
};

export const FailedResponseAfterNavigation: Story = {
  render: (args) => <HeldRootResponse {...args} fail />,
  play: async ({ canvasElement, args }) => {
    await leaveWhileSaving(canvasElement, 'Rename');
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Space actions for Next Space' }),
    );
    await userEvent.click(await body.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await body.findByRole('dialog', { name: 'Rename Space' });
    await releasePrevious(canvasElement);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled());
    await expect(within(dialog).getByLabelText('Name')).toHaveValue(nextSpace.name);
    await expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await expect(args.onChanged).not.toHaveBeenCalled();
  },
};

export const FileAdminMove: Story = {
  args: { item: { ...item, access: 'admin', ownerName: 'Alex Kim' } },
  parameters: {
    api: {
      [`GET /api/items/${item.id}/destinations`]: { items: [{ ...folder, access: 'admin' }] },
    },
  },
  play: async ({ canvasElement }) => {
    await choose(canvasElement, 'Move');
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Move Space',
    });
    const destination = await within(dialog).findByLabelText('Destination');
    await expect(
      within(destination).queryByRole('option', { name: 'My files' }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(destination, folder.id);
    await themedTarget(destination, dialog);
  },
};
export const FileAdminNoDestinations: Story = {
  args: { item: { ...item, access: 'admin' } },
  parameters: { api: { [`GET /api/items/${item.id}/destinations`]: { items: [] } } },
  play: async ({ canvasElement }) => {
    await choose(canvasElement, 'Move');
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Move Space',
    });
    await expect(await within(dialog).findByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(
      await within(dialog).findByText(/No authorized folders are available/),
    ).toBeVisible();
    await expect(within(dialog).getByLabelText('Destination')).toBeDisabled();
  },
};
