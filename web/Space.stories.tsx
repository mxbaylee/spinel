import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import type {
  SpaceDeletePreview,
  SpaceNode,
  SpaceTrashListing,
  SpaceTreeData,
} from '../src/shared/spaces.ts';
import type { ItemAccess } from '../src/shared/workspace.ts';
import { App } from './App.tsx';
import { EditorTools } from './EditorTools.tsx';
import { Space } from './Space.tsx';
import type { SpaceEditorProps } from './Space.tsx';
import { spaceHref } from './spaceNavigation.ts';

const root = '77777777-7777-4777-8777-777777777777';
const id = (value: number) => value.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000';
const user = {
  id: 'storybook-space-account',
  name: 'Baylee',
  icon: 'lucide:sparkles',
  color: 'primary-strong',
};
const timestamp = Date.UTC(2026, 9, 20, 14, 5);
const item = (
  value: number,
  name: string,
  kind: SpaceNode['kind'],
  parentId = root,
  position = 0,
): SpaceNode => ({
  id: id(value),
  spaceId: root,
  parentId,
  position,
  name,
  kind,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const items = [
  item(1, 'Welcome', 'doc'),
  item(2, 'Budget', 'sheet', id(1)),
  item(3, 'Notes', 'doc', id(1), 1),
  item(4, 'Research', 'folder', root, 1),
  item(5, 'Notes', 'doc', id(4)),
  item(6, 'Schedule', 'sheet', root, 2),
  item(7, 'Reference', 'folder', id(6)),
];
const tree = (access: ItemAccess = 'owner', members = items): SpaceTreeData => ({
  space: {
    id: root,
    name: 'Project Atlas',
    kind: 'space',
    parentId: null,
    spaceId: null,
    position: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  access,
  items: members,
});
const listing = (access: 'owner' | 'editor' = 'owner'): SpaceTrashListing => ({
  access,
  items: [
    {
      id: id(20),
      kind: 'folder',
      name: 'Earlier plan',
      trashedAt: timestamp,
      descendantCount: 2,
      originalLocation: { id: id(1), name: 'Welcome' },
    },
    {
      id: id(21),
      kind: 'doc',
      name: 'Rough notes',
      trashedAt: timestamp,
      descendantCount: 0,
      originalLocation: null,
    },
  ],
});
const preview: SpaceDeletePreview = {
  root: { id: id(20), kind: 'folder', name: 'Earlier plan' },
  counts: { total: 3, docs: 1, sheets: 1, folders: 1 },
  items: [
    { id: id(20), kind: 'folder', name: 'Earlier plan' },
    { id: id(22), kind: 'doc', name: 'Initial scope' },
    { id: id(23), kind: 'sheet', name: 'Old estimates' },
  ],
  version: 'storybook-exact-subtree',
};
const treeApi = (value = tree()) => ({ ['GET /api/spaces/' + root]: value });
const trashApi = (access: 'owner' | 'editor' = 'owner') => ({
  ...treeApi(tree(access)),
  ['GET /api/spaces/' + root + '/trash']: listing(access),
  ['GET /api/spaces/' + root + '/trash/' + id(20) + '/delete-preview']: preview,
});

/** The controller uses real URLs. Restore the preview's own URL after each story. */
function RouteFixture({
  href,
  failTrashOnce,
  appSession,
  children,
}: {
  href: string;
  failTrashOnce?: boolean;
  appSession?: 'mocked' | 'unreachable';
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const previous = { href: location.href, state: history.state };
    const previousFetch = globalThis.fetch;
    let failedTrash = false;
    const fixtureFetch: typeof fetch = async (input, init) => {
      // A network failure has no HTTP response; App distinguishes it from a denial.
      if (appSession === 'unreachable' && input === '/api/auth/session')
        throw new TypeError('Failed to fetch');
      if (failTrashOnce && !failedTrash && input === '/api/spaces/' + root + '/trash') {
        failedTrash = true;
        return Response.json(
          { error: 'Space Trash could not be loaded. Try again.' },
          { status: 503 },
        );
      }
      return previousFetch(input, init);
    };
    if (failTrashOnce || appSession === 'unreachable') globalThis.fetch = fixtureFetch;
    const memory = [
      'spinel:recent-space:' + encodeURIComponent(user.id),
      'spinel:space-selection:' + encodeURIComponent(user.id) + ':' + root,
      ...(appSession ? ['spinel.offline.account', 'spinel.offline.sign-out'] : []),
    ].map((key) => {
      let value: string | null = null;
      try {
        value = localStorage.getItem(key);
        localStorage.removeItem(key);
      } catch {
        /* Optional memory. */
      }
      return { key, value };
    });
    history.replaceState({}, '', href);
    setReady(true);
    return () => {
      history.replaceState(previous.state, '', previous.href);
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = previousFetch;
      for (const { key, value } of memory) {
        try {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        } catch {
          /* Optional memory. */
        }
      }
    };
  }, [href, failTrashOnce, appSession]);
  return ready ? children : null;
}

/** Native editor persistence is covered by real-browser proofs, not this text fixture. */
function EditorFixture({
  item: current,
  access,
  onDirty,
  onConnectionState,
  offline,
}: SpaceEditorProps & { offline: boolean }) {
  const [value, setValue] = useState(
    'Keep related work together. A page can contain other Docs, Sheets and folders.',
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onConnectionState(offline ? 'offline' : 'online');
    return () => {
      onDirty(false);
      onConnectionState(null);
    };
  }, [offline, onDirty, onConnectionState]);
  return (
    <section aria-label="Editor body fixture" style={{ padding: 24 }}>
      <EditorTools
        id={current.id}
        name={current.name}
        spaceId={current.spaceId}
        people={[]}
        saved={!dirty}
        print={async () => {
          throw new Error('Native printing is covered by browser tests.');
        }}
      />
      <p className="sp-muted" style={{ marginBottom: 16 }}>
        {current.kind === 'doc' ? 'Doc' : 'Sheet'} body fixture · the application uses its native
        editor here.
      </p>
      <textarea
        aria-label="Page content fixture"
        value={value}
        readOnly={access === 'viewer' || offline}
        style={{
          width: '100%',
          minHeight: 240,
          padding: 16,
          font: 'inherit',
          color: 'var(--sp-text)',
          background: 'var(--sp-panel)',
          border: '1px solid var(--sp-border)',
          borderRadius: 8,
        }}
        onChange={(event) => {
          setValue(event.target.value);
          setDirty(true);
          onDirty(true);
        }}
      />
      <p role="status" aria-label="Save status fixture">
        {dirty
          ? 'Changes not saved yet — keep this tab open.'
          : access === 'viewer' || offline
            ? 'Read only.'
            : 'No pending fixture edits.'}
      </p>
    </section>
  );
}

const meta = {
  id: 'space-review',
  title: 'Current production/Spaces/Space',
  component: Space,
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'The real account Space controller, tree, dialogs and recovery components. API responses and the editor body are fixtures; these examples do not establish native editing, authorization or persistence. App startup stories mount the actual App before Space content is available. The application review surface remains server-gated and default-off.',
      },
    },
  },
  args: {
    user,
    connection: 'online',
    navigation: { allow: () => true, dirty: fn() },
    onExit: fn(),
    onConnectionState: fn(),
    renderEditor: (props) => <EditorFixture {...props} offline={false} />,
  },
  render: (args, { parameters }) => (
    <RouteFixture
      key={parameters.spacePath ?? 'page'}
      href={parameters.spacePath ?? spaceHref(root, { kind: 'page', id: id(1) })}
      failTrashOnce={parameters.failTrashOnce}
    >
      <Space
        {...args}
        renderEditor={(props) => (
          <EditorFixture {...props} offline={args.connection === 'offline'} />
        )}
      />
    </RouteFixture>
  ),
} satisfies Meta<typeof Space>;
export default meta;
type Story = StoryObj<typeof meta>;

const renderApp: NonNullable<Story['render']> = (_args, { parameters }) => (
  <RouteFixture href={spaceHref(root)} appSession={parameters.appSession ?? 'mocked'}>
    <App />
  </RouteFixture>
);

/** Actual App bootstrap, before a verified account can enter the Space controller. */
export const AppLoading: Story = {
  render: renderApp,
  parameters: { api: { 'GET /api/auth/session': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('status')).toHaveTextContent('Loading…');
    await expect(canvas.queryByRole('region', { name: 'Space pages' })).not.toBeInTheDocument();
  },
};

/** Spaces require a live account session; a network failure cannot open local data. */
export const AppUnreachable: Story = {
  render: renderApp,
  parameters: { appSession: 'unreachable' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: "You're offline" })).toBeVisible();
    const retry = canvas.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeEnabled();
    const bounds = retry.getBoundingClientRect();
    await expect(bounds.left).toBeGreaterThanOrEqual(0);
    await expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(bounds.top).toBeGreaterThanOrEqual(0);
    await expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    // This is the actual App retry control, including its usable touch area.
    if (window.matchMedia('(pointer: coarse)').matches) {
      await expect(bounds.width).toBeGreaterThanOrEqual(44);
      await expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    await expect(canvas.queryByRole('region', { name: 'Space pages' })).not.toBeInTheDocument();
  },
};

/** The real Operator-session branch refuses Space content without opening IndexedDB. */
export const AppUnavailable: Story = {
  render: renderApp,
  parameters: {
    api: {
      'GET /api/auth/session': {
        user: { id: 'storybook-space-operator', name: 'Operator', isAdmin: true },
      },
      'GET /api/health': { status: 'ok' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'This Space is not available.',
    );
    await expect(canvas.queryByRole('region', { name: 'Space pages' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'New Space' })).not.toBeInTheDocument();
  },
};

async function ready(canvasElement: HTMLElement, title = 'Welcome') {
  const canvas = within(canvasElement);
  const scope =
    title === 'Space Trash'
      ? canvas
      : within(await canvas.findByRole('region', { name: 'Document workspace' }));
  await expect(await scope.findByRole('heading', { name: title, level: 1 })).toBeVisible();
}
async function contents(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  if (!canvas.queryByRole('region', { name: 'Space pages' })) {
    await userEvent.click(canvas.getByRole('button', { name: 'Open Space contents' }));
    await page.findByRole('dialog', { name: 'Space contents' });
  }
  return within(page.getByRole('region', { name: 'Space pages' }));
}
async function deletionDialog(canvasElement: HTMLElement) {
  await ready(canvasElement, 'Space Trash');
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(
    await page.findByRole('button', { name: 'Actions for deleted Earlier plan' }),
  );
  await userEvent.click(await page.findByRole('menuitem', { name: 'Delete permanently' }));
  const dialog = await page.findByRole('dialog', { name: 'Delete Earlier plan permanently?' });
  await expect(within(dialog).getByRole('list', { name: 'Items to delete' }).children).toHaveLength(
    3,
  );
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled());
  return dialog;
}

export const Populated: Story = {
  parameters: { api: treeApi() },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    await expect(
      await within(canvasElement).findByRole('region', { name: 'Editor body fixture' }),
    ).toBeVisible();
    const frame = within(canvasElement).getByRole('region', { name: 'Document workspace' });
    const heading = within(frame).getByRole('heading', { name: 'Welcome', level: 1 });
    await expect(getComputedStyle(heading).fontSize).toBe('16px');
    const content = frame.querySelector('.editor-content')!;
    const shell = frame.querySelector('.space-shell')!;
    await expect(
      Math.abs(shell.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(1);
    const tree = frame.querySelector('.space-desktop-tree')!;
    if (getComputedStyle(tree).display !== 'none') {
      // Space contents follows the actual header, not the old fixed 64px allowance.
      await expect(
        Math.abs(tree.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom),
      ).toBeLessThanOrEqual(1);
      await expect(tree.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        content.getBoundingClientRect().top,
      );
    }
    await expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight + 1);
  },
};

/** Opening a Doc does not expand its children; a Sheet can also have children. */
export const IndependentExpansion: Story = {
  parameters: { api: treeApi() },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const navigation = await contents(canvasElement);
    await userEvent.click(navigation.getByRole('button', { name: 'Expand Welcome' }));
    await expect(navigation.getByRole('link', { name: 'Welcome' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(navigation.getByRole('link', { name: 'Budget' })).toBeVisible();
    await userEvent.click(navigation.getByRole('button', { name: 'Expand Research' }));
    await expect(navigation.getAllByRole('link', { name: 'Notes' })).toHaveLength(2);
    await userEvent.click(navigation.getByRole('button', { name: 'Expand Schedule' }));
    await expect(navigation.getByRole('button', { name: 'Reference' })).toBeVisible();
  },
};

export const ViewOnly: Story = {
  parameters: { api: treeApi(tree('viewer')) },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    await contents(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.queryByRole('button', { name: 'Add page' })).not.toBeInTheDocument();
    await expect(page.queryByRole('link', { name: 'Space Trash' })).not.toBeInTheDocument();
    await expect(page.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  parameters: { spacePath: spaceHref(root), api: treeApi(tree('owner', [])) },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('heading', { name: 'This Space is empty' });
  },
};

export const SpacesIndex: Story = {
  parameters: {
    spacePath: spaceHref(),
    api: { 'GET /api/spaces': { spaces: [{ space: tree().space, access: 'owner' }], folders: [] } },
  },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('link', { name: /Project Atlas/ });
    await expect(within(canvasElement).getByRole('button', { name: 'New Space' })).toBeEnabled();
  },
};

export const NoSpaces: Story = {
  parameters: { spacePath: spaceHref(), api: { 'GET /api/spaces': { spaces: [], folders: [] } } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('heading', { name: 'Your first Space' });
  },
};

export const NewSpace: Story = {
  parameters: {
    spacePath: spaceHref(),
    api: {
      'GET /api/spaces': {
        spaces: [],
        folders: [{ id: id(30), name: 'Projects', parentId: null }],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New Space' }));
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New Space' }),
    );
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Name' }), 'Project Atlas');
    await expect(dialog.getByRole('combobox', { name: 'Folder' })).toHaveTextContent('My files');
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeEnabled();
  },
};

const createMember =
  (kind: 'Doc' | 'Sheet' | 'Folder'): NonNullable<Story['play']> =>
  async ({ canvasElement }) => {
    await ready(canvasElement);
    await contents(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole('button', { name: 'Add page' }));
    await userEvent.click(await page.findByRole('menuitem', { name: kind }));
    const dialog = within(
      await page.findByRole('dialog', { name: 'New ' + (kind === 'Folder' ? 'folder' : kind) }),
    );
    await userEvent.type(dialog.getByRole('textbox', { name: 'Name' }), 'Planning');
    await expect(dialog.getByRole('combobox', { name: 'Parent page or folder' })).toHaveTextContent(
      'Project Atlas',
    );
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeEnabled();
  };
export const NewDoc: Story = { parameters: { api: treeApi() }, play: createMember('Doc') };
export const NewSheet: Story = { parameters: { api: treeApi() }, play: createMember('Sheet') };
export const NewFolder: Story = { parameters: { api: treeApi() }, play: createMember('Folder') };

export const Loading: Story = {
  parameters: { api: { ['GET /api/spaces/' + root]: pending() } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText('Loading Space…');
  },
};

export const Unavailable: Story = {
  parameters: { api: { ['GET /api/spaces/' + root]: failure('Space unavailable', 404) } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('alert');
    await expect(
      within(canvasElement).queryByRole('region', { name: 'Editor body fixture' }),
    ).not.toBeInTheDocument();
  },
};

export const Unreachable: Story = {
  parameters: {
    api: {
      ['GET /api/spaces/' + root]: failure('Could not reach Spinel. Reconnect and try again.', 503),
    },
  },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('alert');
    await expect(within(canvasElement).getByRole('button', { name: 'Try again' })).toBeEnabled();
  },
};

const guestTreeApi = (access: 'viewer' | 'editor' = 'viewer', members = items) => ({
  ['GET /api/guest-spaces/' + root]: tree(access, members),
});
const guestArgs = { guest: true, user: undefined };
const guestPath = '/share/' + root + '?item=' + id(1);
const guestBoundaries: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole('region', { name: 'Editor body fixture' })).toBeVisible();
  for (const name of ['My files', 'Your profile', 'Document actions'])
    await expect(canvas.queryByRole('button', { name })).not.toBeInTheDocument();
};
export const GuestViewer: Story = {
  args: guestArgs,
  parameters: { spacePath: guestPath, api: guestTreeApi() },
  play: guestBoundaries,
};
export const GuestEditor: Story = {
  args: guestArgs,
  parameters: { spacePath: guestPath, api: guestTreeApi('editor') },
  play: guestBoundaries,
};
export const GuestEmpty: Story = {
  args: guestArgs,
  parameters: { spacePath: '/share/' + root, api: guestTreeApi('viewer', []) },
};
export const GuestLoading: Story = {
  args: guestArgs,
  parameters: { spacePath: guestPath, api: { ['GET /api/guest-spaces/' + root]: pending() } },
};
export const GuestRevoked: Story = {
  args: guestArgs,
  parameters: {
    spacePath: guestPath,
    api: { ['GET /api/guest-spaces/' + root]: failure('Private title must never appear', 404) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('This link no longer works.');
    await expect(canvas.queryByText('Project Atlas')).not.toBeInTheDocument();
    await expect(canvas.queryByText('Private title must never appear')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  },
};
export const GuestUnreachable: Story = {
  args: guestArgs,
  parameters: {
    spacePath: guestPath,
    api: { ['GET /api/guest-spaces/' + root]: failure('Unavailable', 503) },
  },
};
export const GuestMissingPage: Story = {
  args: guestArgs,
  parameters: { spacePath: '/share/' + root + '?item=' + id(999), api: guestTreeApi() },
};
export const GuestMalformedRoute: Story = {
  args: guestArgs,
  parameters: { spacePath: '/share/' + root + '?item=invalid', api: guestTreeApi() },
};

export const Offline: Story = {
  args: { connection: 'offline' },
  parameters: { api: treeApi() },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    await contents(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole('button', { name: 'Add page' }));
    // The portaled menu can commit after the click promise resolves.
    const menu = within(await page.findByRole('menu', { name: 'Add page' }));
    for (const name of ['Doc', 'Sheet', 'Folder'])
      await expect(menu.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(page.queryByRole('menu', { name: 'Add page' })).not.toBeInTheDocument(),
    );
  },
};

const deepItems = Array.from({ length: 14 }, (_, index) =>
  item(
    100 + index,
    'Level ' + (index + 1),
    index === 13 ? 'doc' : index % 3 === 0 ? 'folder' : index % 3 === 1 ? 'sheet' : 'doc',
    index === 0 ? root : id(99 + index),
  ),
);
export const DeepTree: Story = {
  parameters: {
    spacePath: spaceHref(root, { kind: 'page', id: id(113) }),
    api: treeApi(tree('owner', deepItems)),
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement, 'Level 14');
    const navigation = await contents(canvasElement);
    // The page heading can precede the asynchronously loaded navigation tree.
    const selected = await navigation.findByRole('link', { name: 'Level 14' });
    const action = navigation.getByRole('button', { name: 'More actions for Level 14' });
    const page = within(canvasElement.ownerDocument.body);
    const region = page.getByRole('region', { name: 'Space pages' });
    await expect(selected).toHaveAttribute('aria-current', 'page');
    // Check before any focus/click: browser-assisted scrolling must not hide a
    // missing action from the initial selected-page reveal.
    await waitFor(() => {
      const bounds = region.getBoundingClientRect();
      for (const target of [selected, action]) {
        const rect = target.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
        expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
        expect(rect.top).toBeGreaterThanOrEqual(bounds.top - 1);
        expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
      }
    });
    const rect = action.getBoundingClientRect();
    await expect(
      action.contains(
        canvasElement.ownerDocument.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        ),
      ),
    ).toBe(true);
    const scrollLeft = region.scrollLeft;
    await userEvent.click(action);
    const menu = within(await page.findByRole('menu', { name: 'More actions for Level 14' }));
    for (const name of ['Rename', 'Move or reorder', 'Trash'])
      await expect(menu.getByRole('menuitem', { name })).toBeVisible();
    await expect(region.scrollLeft).toBe(scrollLeft);
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        page.queryByRole('menu', { name: 'More actions for Level 14' }),
      ).not.toBeInTheDocument(),
    );
    await expect(action).toHaveFocus();
    await expect(selected).toHaveAttribute('aria-current', 'page');
  },
};

/** The same Pages control and Escape/focus contract work on tablet and phone. */
export const PagesDrawer: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  parameters: { api: treeApi() },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    if (window.matchMedia('(max-width: 900px)').matches) {
      const trigger = canvas.getByRole('button', { name: 'Open Space contents' });
      await userEvent.click(trigger);
      await expect(await page.findByRole('dialog', { name: 'Space contents' })).toBeVisible();
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(page.queryByRole('dialog', { name: 'Space contents' })).not.toBeInTheDocument(),
      );
      await expect(trigger).toHaveFocus();
      await userEvent.click(trigger);
      await page.findByRole('dialog', { name: 'Space contents' });
    } else {
      await userEvent.click(canvas.getByRole('button', { name: 'Collapse navigation' }));
      const trigger = canvas.getByRole('button', { name: 'Open Space contents' });
      await waitFor(() => expect(trigger).toHaveFocus());
      await userEvent.click(trigger);
      await expect(canvas.getByRole('region', { name: 'Space pages' })).toBeVisible();
    }
  },
};

/** Reordering is a labelled destination/position form, with no drag dependency. */
export const MoveOrReorder: Story = {
  parameters: { api: treeApi() },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const navigation = await contents(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(navigation.getByRole('button', { name: 'More actions for Welcome' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Move or reorder' }));
    const dialog = within(await page.findByRole('dialog', { name: 'Move or reorder Welcome' }));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Parent page or folder' }));
    await expect(page.queryByRole('option', { name: /Welcome · Doc/ })).not.toBeInTheDocument();
    await expect(page.queryByRole('option', { name: /Budget · Sheet/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{End}{Enter}');
    await expect(dialog.getByRole('spinbutton', { name: 'Position' })).toHaveValue(1);
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
  },
};

export const MetadataDialogFocus: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  parameters: { api: treeApi() },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    for (const mode of ['Rename', 'Move or reorder']) {
      const navigation = await contents(canvasElement);
      await userEvent.click(navigation.getByRole('button', { name: 'More actions for Welcome' }));
      await userEvent.click(await page.findByRole('menuitem', { name: mode }));
      const dialog = await page.findByRole('dialog', { name: mode + ' Welcome' });
      await expect(page.getAllByRole('dialog')).toHaveLength(1);
      await expect(page.queryByRole('dialog', { name: 'Space contents' })).not.toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
        expect(page.queryByRole('dialog', { name: mode + ' Welcome' })).not.toBeInTheDocument(),
      );
      if (window.matchMedia('(max-width: 900px)').matches)
        await waitFor(() =>
          expect(canvas.getByRole('button', { name: 'Open Space contents' })).toHaveFocus(),
        );
    }
  },
};

export const MutationFailure: Story = {
  parameters: {
    api: {
      ...treeApi(),
      ['PATCH /api/spaces/' + root + '/items/' + id(1)]: failure(
        'This page changed. Refresh and try again.',
        409,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const navigation = await contents(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(navigation.getByRole('button', { name: 'More actions for Welcome' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Rename' }));
    const dialog = within(await page.findByRole('dialog', { name: 'Rename Welcome' }));
    const name = dialog.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Project overview');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'This page changed. Refresh and try again.',
    );
    await expect(name).toHaveValue('Project overview');
  },
};

export const TrashSubtreeConfirmation: Story = {
  parameters: { api: treeApi() },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const navigation = await contents(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(navigation.getByRole('button', { name: 'More actions for Welcome' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Trash' }));
    const dialog = within(await page.findByRole('dialog', { name: 'Trash Welcome' }));
    await expect(
      dialog.getByText(/Move Welcome and its 2 descendants to Space Trash/),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Move to Trash' })).toBeEnabled();
  },
};

export const TrashOwner: Story = {
  parameters: { spacePath: spaceHref(root, { kind: 'trash' }), api: trashApi() },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('button', { name: 'Restore Earlier plan' });
    await expect(
      within(canvasElement).getByText(
        'Restores to Project Atlas because its original location is unavailable.',
      ),
    ).toBeVisible();
  },
};

export const TrashEditor: Story = {
  parameters: { spacePath: spaceHref(root, { kind: 'trash' }), api: trashApi('editor') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: 'Restore Earlier plan' });
    await expect(
      canvas.queryByRole('button', { name: /^Actions for deleted/ }),
    ).not.toBeInTheDocument();
  },
};

/** Sequential role reads may disagree during a downgrade; either Edit result wins. */
export const TrashRoleChange: Story = {
  parameters: {
    spacePath: spaceHref(root, { kind: 'trash' }),
    api: { ...treeApi(tree('editor')), ['GET /api/spaces/' + root + '/trash']: listing('owner') },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Restore Earlier plan' })).toBeEnabled();
    await expect(
      canvas.queryByRole('button', { name: /^Actions for deleted/ }),
    ).not.toBeInTheDocument();
  },
};

export const TrashViewerDenied: Story = {
  parameters: { spacePath: spaceHref(root, { kind: 'trash' }), api: treeApi(tree('viewer')) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Space Trash is available to account editors.',
    );
    await expect(
      canvas.queryByRole('region', { name: 'Deleted Space contents' }),
    ).not.toBeInTheDocument();
  },
};

export const TrashEmpty: Story = {
  parameters: {
    spacePath: spaceHref(root, { kind: 'trash' }),
    api: {
      ...treeApi(),
      ['GET /api/spaces/' + root + '/trash']: { access: 'owner', items: [] },
    },
  },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('heading', { name: 'Space Trash is empty' });
  },
};

/** A stale collection disables mutations, while its explicit read retry still works. */
export const TrashRetry: Story = {
  parameters: {
    spacePath: spaceHref(root, { kind: 'trash' }),
    api: trashApi(),
    failTrashOnce: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Space Trash could not be loaded. Try again.',
    );
    const retry = canvas.getByRole('button', { name: 'Refresh Trash' });
    await expect(retry).toBeEnabled();
    await userEvent.click(retry);
    await expect(await canvas.findByRole('button', { name: 'Restore Earlier plan' })).toBeEnabled();
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
  },
};

export const TrashOffline: Story = {
  args: { connection: 'offline' },
  parameters: { spacePath: spaceHref(root, { kind: 'trash' }), api: trashApi() },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('button', { name: 'Restore Earlier plan' }),
    ).toBeDisabled();
  },
};

export const DeleteConfirmation: Story = {
  parameters: { spacePath: spaceHref(root, { kind: 'trash' }), api: trashApi() },
  play: async ({ canvasElement }) => {
    const dialog = await deletionDialog(canvasElement);
    await expect(
      within(dialog).getByText('3 items: 1 Docs, 1 Sheets and 1 folders.'),
    ).toBeVisible();
  },
};

export const CancelDeletion: Story = {
  parameters: { spacePath: spaceHref(root, { kind: 'trash' }), api: trashApi() },
  play: async ({ canvasElement }) => {
    const dialog = await deletionDialog(canvasElement);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).queryByRole('dialog', {
          name: 'Delete Earlier plan permanently?',
        }),
      ).not.toBeInTheDocument(),
    );
    await expect(
      within(canvasElement).getByRole('button', { name: 'Restore Earlier plan' }),
    ).toBeEnabled();
  },
};

export const StaleDeletePreview: Story = {
  parameters: {
    spacePath: spaceHref(root, { kind: 'trash' }),
    api: {
      ...trashApi(),
      ['DELETE /api/spaces/' + root + '/trash/' + id(20)]: failure('The subtree changed.', 409),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await deletionDialog(canvasElement);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Review the current subtree again before deleting.',
    );
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Restore Earlier plan' })).toBeEnabled(),
    );
    await expect(
      within(canvasElement.ownerDocument.body).queryByRole('dialog', {
        name: 'Delete Earlier plan permanently?',
      }),
    ).not.toBeInTheDocument();
  },
};

export const FileAdmin: Story = {
  parameters: { api: treeApi(tree('admin')) },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const workspace = within(canvasElement).getByRole('region', { name: 'Document workspace' });
    const header = within(workspace.querySelector<HTMLElement>('.editor-header')!);
    await expect(header.getByText('File admin', { exact: true })).toBeVisible();
    await userEvent.click(await header.findByRole('button', { name: 'Document actions' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Rename Space…' }));
    const dialog = await page.findByRole('dialog', { name: 'Rename Space' });
    await expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Project Atlas',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await contents(canvasElement);
    await expect(page.getByRole('button', { name: 'Add page' })).toBeVisible();
  },
};
