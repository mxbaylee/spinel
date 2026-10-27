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
async function openPerson(body: ReturnType<typeof within>, name: string) {
  await userEvent.click(await body.findByRole('button', { name: `Edit access for ${name}` }));
  return body.findByRole('combobox', { name: `Access for ${name}` });
}
const saveAccess = (body: ReturnType<typeof within>) =>
  body.getByRole('button', { name: /^(Share|Save changes)$/ });

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
    await userEvent.selectOptions(await openPerson(canvas, 'Alex Kim'), 'admin');
    await userEvent.click(saveAccess(canvas));
    await expect(
      await canvas.findByText('Access updated for Alex Kim.', { exact: true }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Edit access for Alex Kim' }),
    ).toHaveTextContent('File admin');
    await userEvent.click(canvas.getByRole('tab', { name: 'Link' }));
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
    await userEvent.selectOptions(await openPerson(canvas, 'Alex Kim'), 'admin');
    await userEvent.click(saveAccess(canvas));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Could not confirm the update.',
    );
    await expect(canvas.getByLabelText('Access for Alex Kim')).toHaveValue('admin');
    await expect(
      canvas.getByRole('button', { name: 'Edit access for Alex Kim' }),
    ).toHaveTextContent('Can edit');
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
    await expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toBeEnabled();
    await openPerson(body, 'Alex Kim');
    await expect(await within(dialog).findByText('File admin through a folder.')).toBeVisible();
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
    await userEvent.selectOptions(await openPerson(body, 'Alex Kim'), 'viewer');
    await userEvent.click(saveAccess(body));
    await expect(body.getByRole('button', { name: 'Edit access for Alex Kim' })).toHaveTextContent(
      'Can edit',
    );
    await expect(body.getByLabelText('Access for Alex Kim')).toBeDisabled();
    await expect(body.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
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
    const select = await openPerson(body, 'Taylor Brooks');
    await expect(within(select).getByRole('option', { name: 'Can edit' })).toBeDisabled();
    await expect(within(select).getByRole('option', { name: 'File admin' })).toBeDisabled();
    await userEvent.selectOptions(select, '');
    await userEvent.click(saveAccess(body));
    await expect(await body.findByText('Access updated for Taylor Brooks.')).toBeVisible();
    await expect(body.queryByLabelText('Access for Taylor Brooks')).not.toBeInTheDocument();
  },
};
export const DisabledAccountBeforeRemoval: Story = {
  parameters: DisabledAccount.parameters,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const select = await openPerson(body, 'Taylor Brooks');
    await expect(select).toHaveValue('viewer');
    for (const name of ['Can view', 'Can edit', 'File admin']) {
      await expect(within(select).getByRole('option', { name })).toBeDisabled();
    }
    await expect(within(select).getByRole('option', { name: 'No direct access' })).toBeEnabled();
    await expect(
      body.getByRole('button', { name: 'Edit access for Taylor Brooks' }),
    ).toHaveTextContent('Taylor Brooks · Disabled account');
    await expect(
      body.getByRole('button', { name: 'Edit access for Taylor Brooks' }),
    ).toHaveAccessibleDescription('Not shared · Disabled account');
  },
};
export const OneRecipientDraft: Story = {
  parameters: { api: { [sharing(doc)]: { people: people.slice(0, 2) }, [link(doc)]: noLink } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await openPerson(body, 'Alex Kim'), 'viewer');
    await expect(body.getByRole('button', { name: 'Edit access for Alex Kim' })).toHaveTextContent(
      'Can edit',
    );
    await userEvent.selectOptions(await openPerson(body, 'Jordan Lee'), 'admin');
    await expect(
      body.queryByRole('combobox', { name: 'Access for Alex Kim' }),
    ).not.toBeInTheDocument();
    await expect(await openPerson(body, 'Alex Kim')).toHaveValue('editor');
    await expect(
      body.queryByRole('combobox', { name: 'Access for Jordan Lee' }),
    ).not.toBeInTheDocument();
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(body.getByRole('button', { name: 'Edit access for Alex Kim' })).toHaveFocus(),
    );
    await expect(await openPerson(body, 'Jordan Lee')).toHaveValue('viewer');
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
  await userEvent.selectOptions(await openPerson(body, 'Alex Kim'), 'admin');
  await userEvent.click(saveAccess(body));
  await body.findByText('Access response held');
  // Navigation is external to the modal; fireEvent simulates the route unmount directly.
  fireEvent.click(body.getByTestId('leave-access'));
  if (replace) await openPerson(body, 'Jordan Lee');
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
    await userEvent.selectOptions(await openPerson(body, 'Alex Kim'), 'viewer');
    await userEvent.click(saveAccess(body));
    await expect(await body.findByRole('alert')).toHaveTextContent('Could not confirm the update.');
    await expect(body.getByRole('button', { name: 'Edit access for Alex Kim' })).toHaveTextContent(
      'Can edit',
    );
    await expect(body.getByLabelText('Access for Alex Kim')).toHaveValue('viewer');
    await userEvent.click(saveAccess(body));
    await waitFor(() => expect(body.queryByRole('alert')).not.toBeInTheDocument());
    await expect(body.getByRole('button', { name: 'Edit access for Alex Kim' })).toHaveTextContent(
      'View only',
    );
    await expect(body.queryByRole('combobox')).not.toBeInTheDocument();
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
    await userEvent.click(await body.findByRole('tab', { name: 'Link' }));
    await userEvent.click(await body.findByRole('button', { name: 'Create link' }));
    await expect(await body.findByLabelText('Guest link address')).toHaveValue(
      'https://spinel.example/share/trip#only-shown-now',
    );
  },
};
export const ExistingGuestLink: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('tab', {
        name: 'Link',
      }),
    );
  },
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
    await userEvent.click(await body.findByRole('tab', { name: 'Link' }));
    await userEvent.click(await body.findByRole('button', { name: 'Replace link…' }));
    await expect(await body.findByRole('dialog', { name: 'Replace the link?' })).toBeVisible();
  },
};

/** The direct role masks a private folder's retained access until the draft removes it. */
export const InheritedAccessAfterRemoval: Story = {
  args: { item: { ...folder, access: 'admin', ownerName: 'Owner' } },
  parameters: {
    api: { [sharing(folder)]: { people: [{ ...people[0], inheritedRole: 'viewer' }] } },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const select = await openPerson(body, 'Alex Kim');
    await expect(body.queryByText('View only through a folder.')).not.toBeInTheDocument();
    await userEvent.selectOptions(select, '');
    await expect(body.getByText('View only through a folder.')).toBeVisible();
    await expect(
      body.getByRole('button', { name: 'Edit access for Alex Kim' }),
    ).toHaveAccessibleDescription('Can edit');
    await expect(saveAccess(body)).toBeEnabled();
  },
};
export const EqualInheritedAccessAfterDowngrade: Story = {
  args: { item: folder },
  parameters: {
    api: { [sharing(folder)]: { people: [{ ...people[0], inheritedRole: 'editor' }] } },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await openPerson(body, 'Alex Kim'), 'viewer');
    await expect(body.getByText('Can edit through a folder.')).toBeVisible();
    await expect(
      body.getByRole('button', { name: 'Edit access for Alex Kim' }),
    ).toHaveAccessibleDescription('Can edit');
  },
};
