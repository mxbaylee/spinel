import { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, userEvent, expect, waitFor, fireEvent } from 'storybook/test';
import type { FileItem, SharePerson, SpaceFile, WorkspaceItem } from '../src/shared/workspace.ts';
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
const sharing = (item: FileItem) => `GET /api/items/${item.id}/sharing`;
// Sharing embeds guest links for Sheets, Docs and whole Spaces.
const link = (item: FileItem) => `GET /api/items/${item.id}/link`;
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

/** These existing report fixtures have no formulas. Keep their source review
 * explicit so they continue exercising the ordinary sharing states. */
function EmptySourceReview({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const previous = globalThis.fetch;
    const intercepted: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/sharing/review') && init?.method === 'POST') {
        const { userId, role } = JSON.parse(String(init.body));
        return Response.json({
          review: {
            version: 'empty-report',
            userId,
            hostRole: role,
            hostAccess: role,
            targets: [],
            unavailable: false,
          },
        });
      }
      return previous(input, init);
    };
    globalThis.fetch = intercepted;
    setReady(true);
    return () => {
      if (globalThis.fetch === intercepted) globalThis.fetch = previous;
    };
  }, []);
  return ready ? children : null;
}

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  id: 'sharing-sharing',
  title: 'Current production/Sharing/Sharing',
  component: Sharing,
  decorators: [
    (Story) => (
      <EmptySourceReview>
        <Story />
      </EmptySourceReview>
    ),
  ],
  args: { item: doc as FileItem, onClose: () => {} },
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
const space: SpaceFile = { ...doc, kind: 'space', name: 'Research Space' };
export const WholeSpace: Story = {
  args: { item: space },
  parameters: { api: { [sharing(space)]: { people }, [link(space)]: noLink } },
};

export const FileAdmin: Story = {
  args: { item: { ...doc, access: 'admin', ownerName: 'Morgan Ellis' } },
  parameters: {
    api: {
      [sharing(doc)]: {
        people: [
          {
            id: 'u-alex',
            name: 'Alex Kim',
            disabled: 0,
            directRole: 'viewer',
            effectiveRole: 'admin',
          },
          {
            id: 'u-jordan',
            name: 'Jordan Lee',
            disabled: 0,
            directRole: 'admin',
            effectiveRole: 'admin',
          },
        ],
      },
      [link(doc)]: noLink,
    },
  },
};
export const GrantFileAdmin: Story = {
  parameters: {
    api: {
      [sharing(doc)]: { people: [people[0]] },
      [link(doc)]: noLink,
      [`PUT /api/items/${doc.id}/sharing`]: {
        people: [{ ...people[0], directRole: 'admin', effectiveRole: 'admin' }],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await canvas.findByLabelText('Access for Alex Kim'), 'admin');
    await userEvent.click(canvas.getByRole('button', { name: 'Apply access for Alex Kim' }));
    await expect(
      await canvas.findByText('Access updated for Alex Kim.', { exact: true }),
    ).toBeVisible();
    await expect(canvas.getByLabelText('Access for Alex Kim')).toHaveValue('admin');
    await expect(
      canvas.getByLabelText('Link access').querySelector('option[value="admin"]'),
    ).toBeNull();
  },
};
export const AdminRevokedWhileApplying: Story = {
  args: { item: { ...doc, access: 'admin' } },
  parameters: {
    api: {
      [sharing(doc)]: { people: [people[0]] },
      [link(doc)]: noLink,
      [`PUT /api/items/${doc.id}/sharing`]: failure(
        'Only the owner or a file admin can manage this item.',
        403,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await canvas.findByLabelText('Access for Alex Kim'), 'admin');
    await userEvent.click(canvas.getByRole('button', { name: 'Apply access for Alex Kim' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Only the owner or a file admin',
    );
    await expect(canvas.getByLabelText('Access for Alex Kim')).toHaveValue('admin');
    await expect(canvas.getByText('Effective access: Can edit.')).toBeVisible();
  },
};

/** The approved composed hierarchy, with current File admin capability. */
export const Composed: Story = {
  parameters: {
    api: {
      [sharing(doc)]: { people: [{ ...people[0], directRole: 'viewer', effectiveRole: 'admin' }] },
      [link(doc)]: noLink,
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole('dialog', { name: 'Share Trip plan' });
    await expect(within(dialog).getByRole('button', { name: 'Copy account link' })).toBeVisible();
    await expect(within(dialog).getByRole('button', { name: 'Done' })).toBeEnabled();
    await expect(
      await within(dialog).findByText('Effective access: File admin (from a folder).'),
    ).toBeVisible();
    await expect(body.getAllByRole('dialog')).toHaveLength(1);
  },
};
export const AccessSaving: Story = {
  parameters: {
    api: {
      [sharing(doc)]: { people: [people[0]] },
      [link(doc)]: noLink,
      [`PUT /api/items/${doc.id}/sharing`]: pending(),
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await body.findByLabelText('Access for Alex Kim'), 'viewer');
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Alex Kim' }));
    await expect(body.getByText('Effective access: Can edit.')).toBeVisible();
    await expect(body.getByLabelText('Access for Alex Kim')).toBeDisabled();
    await expect(body.getByRole('button', { name: 'Done' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(body.getByRole('dialog', { name: 'Share Trip plan' })).toBeVisible();
  },
};
export const DisabledAccount: Story = {
  parameters: {
    api: {
      [sharing(doc)]: { people: [{ ...people[4], effectiveRole: null }] },
      [link(doc)]: noLink,
      [`PUT /api/items/${doc.id}/sharing`]: { people: [] },
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const select = await body.findByLabelText('Access for Taylor Brooks');
    await expect(within(select).getByRole('option', { name: 'Can edit' })).toBeDisabled();
    await expect(within(select).getByRole('option', { name: 'File admin' })).toBeDisabled();
    await userEvent.selectOptions(select, '');
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Taylor Brooks' }));
    await expect(await body.findByText('Access updated for Taylor Brooks.')).toBeVisible();
    await expect(body.queryByLabelText('Access for Taylor Brooks')).not.toBeInTheDocument();
  },
};
export const DisabledAccountBeforeRemoval: Story = {
  parameters: DisabledAccount.parameters,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const select = await body.findByLabelText('Access for Taylor Brooks');
    await expect(select).toHaveValue('viewer');
    for (const name of ['Can view', 'Can edit', 'File admin']) {
      await expect(within(select).getByRole('option', { name })).toBeDisabled();
    }
    await expect(within(select).getByRole('option', { name: 'No direct access' })).toBeEnabled();
    await expect(body.getByText('Taylor Brooks · Disabled account')).toBeVisible();
  },
};
export const KeepsOtherDrafts: Story = {
  parameters: {
    api: {
      [sharing(doc)]: { people: people.slice(0, 2) },
      [link(doc)]: noLink,
      [`PUT /api/items/${doc.id}/sharing`]: {
        people: [{ ...people[0], directRole: 'viewer', effectiveRole: 'viewer' }, people[1]],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await body.findByLabelText('Access for Alex Kim'), 'viewer');
    await userEvent.selectOptions(body.getByLabelText('Access for Jordan Lee'), 'admin');
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Alex Kim' }));
    await body.findByText('Access updated for Alex Kim.');
    await expect(body.getByLabelText('Access for Jordan Lee')).toHaveValue('admin');
    await expect(body.getByRole('button', { name: 'Apply access for Jordan Lee' })).toBeEnabled();
  },
};

function DeferredAccess({ replace = false }: { replace?: boolean }) {
  const [ready, setReady] = useState(false);
  const [left, setLeft] = useState(false);
  const [phase, setPhase] = useState('Ready');
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    const previous = globalThis.fetch;
    const intercepted: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/sharing')) {
        if ((init?.method ?? 'GET') === 'PUT') {
          setPhase('Access response held');
          return new Promise<Response>((resolve) => {
            release.current = () => {
              resolve(Response.json({ error: 'Sign in to continue.' }, { status: 401 }));
              setPhase('Access response released');
            };
          });
        }
        return Response.json({
          people: String(input).includes('next-item') ? [people[1]] : [people[0]],
        });
      }
      return previous(input, init);
    };
    globalThis.fetch = intercepted;
    setReady(true);
    return () => {
      if (globalThis.fetch === intercepted) globalThis.fetch = previous;
      release.current = null;
    };
  }, []);
  return (
    <>
      <p>{phase}</p>
      <button data-testid="leave-access" onClick={() => setLeft(true)}>
        Simulate navigation
      </button>
      <button data-testid="release-access" onClick={() => release.current?.()}>
        Release response
      </button>
      {ready && (!left || replace) && (
        <Sharing
          item={left ? { ...folder, id: 'next-item', name: 'Next folder' } : folder}
          onClose={() => setLeft(true)}
        />
      )}
    </>
  );
}
async function staleAccess(canvasElement: HTMLElement, replace: boolean) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.selectOptions(await body.findByLabelText('Access for Alex Kim'), 'admin');
  await userEvent.click(body.getByRole('button', { name: 'Apply access for Alex Kim' }));
  await body.findByText('Access response held');
  // Navigation is external to the modal; fireEvent simulates the route unmount directly.
  fireEvent.click(body.getByTestId('leave-access'));
  if (replace) await body.findByLabelText('Access for Jordan Lee');
  const href = location.href;
  fireEvent.click(body.getByTestId('release-access'));
  await body.findByText('Access response released');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await expect(location.href).toBe(href);
  await expect(body.queryByRole('alert')).not.toBeInTheDocument();
  if (replace) await expect(body.getByLabelText('Access for Jordan Lee')).toHaveValue('viewer');
  else await expect(body.queryByRole('dialog')).not.toBeInTheDocument();
}
export const WriteAfterLeaving: Story = {
  render: () => <DeferredAccess />,
  play: ({ canvasElement }) => staleAccess(canvasElement, false),
};
export const WriteAfterReplacing: Story = {
  render: () => <DeferredAccess replace />,
  play: ({ canvasElement }) => staleAccess(canvasElement, true),
};

function RetryAccess() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const previous = globalThis.fetch;
    let writes = 0;
    const intercepted: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/sharing')) {
        if (init?.method === 'PUT' && ++writes === 1)
          return Response.json({ error: 'Temporary write failure.' }, { status: 503 });
        return Response.json({
          people: [
            {
              ...people[0],
              directRole: writes > 1 ? 'viewer' : 'editor',
              effectiveRole: writes > 1 ? 'viewer' : 'editor',
            },
          ],
        });
      }
      return previous(input, init);
    };
    globalThis.fetch = intercepted;
    setReady(true);
    return () => {
      if (globalThis.fetch === intercepted) globalThis.fetch = previous;
    };
  }, []);
  return ready && <Sharing item={folder} onClose={() => {}} />;
}
export const FailedWriteRetry: Story = {
  render: () => <RetryAccess />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await body.findByLabelText('Access for Alex Kim'), 'viewer');
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Alex Kim' }));
    await expect(await body.findByRole('alert')).toHaveTextContent('Temporary write failure.');
    await expect(body.getByText('Effective access: Can edit.')).toBeVisible();
    await expect(body.getByLabelText('Access for Alex Kim')).toHaveValue('viewer');
    await userEvent.click(body.getByRole('button', { name: 'Retry access update for Alex Kim' }));
    await waitFor(() => expect(body.queryByRole('alert')).not.toBeInTheDocument());
    await expect(body.getByText('Effective access: View only.')).toBeVisible();
  },
};

export const GuestLinkCreated: Story = {
  parameters: {
    api: {
      [sharing(doc)]: { people: [people[0]] },
      [link(doc)]: noLink,
      [`PUT /api/items/${doc.id}/link`]: {
        enabled: true,
        role: 'viewer',
        url: 'https://spinel.example/share/trip#only-shown-now',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('button', { name: 'Create link' }));
    await expect(await body.findByLabelText('Guest link address')).toHaveValue(
      'https://spinel.example/share/trip#only-shown-now',
    );
  },
};
export const ExistingGuestLink: Story = {
  parameters: {
    api: {
      [sharing(doc)]: { people: [people[0]] },
      [link(doc)]: { enabled: true, role: 'viewer' },
    },
  },
};
export const ReplaceGuestLink: Story = {
  parameters: ExistingGuestLink.parameters,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('button', { name: 'Guest link actions' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Replace link…' }));
    await expect(await body.findByRole('dialog', { name: 'Replace the link?' })).toBeVisible();
  },
};
