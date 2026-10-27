import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { ItemKind, SpaceFile, WorkspaceItem } from '../src/shared/workspace.ts';
import type { OfflineBundle } from '../src/shared/offlineBundle.ts';
import type { ShellManifest } from '../src/shared/offlineShell.ts';
import { blankOfflineSnapshot } from '../src/shared/offlineCreation.ts';
import type { OfflineCreationRequest } from '../src/shared/offlineCreation.ts';
import { failure, pending } from '../.storybook/api.ts';
import { searchCatalog } from '../src/shared/search.ts';
import { Dashboard } from './Dashboard.tsx';
import type { LocalStart } from './offline/localStart.ts';
import { openOfflineStore, preparedAccount, setPreparedAccount } from './offline/offlineStore.ts';
import { currentRuntime, installRuntimeHost } from './offline/runtime.ts';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';

const day = 86_400_000;
const now = Date.now();
const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const entry = (
  n: number,
  name: string,
  kind: ItemKind,
  extra: Partial<WorkspaceItem> = {},
): WorkspaceItem => ({
  access: 'owner',
  id: id(n),
  parentId: null,
  kind,
  name,
  createdAt: now - 60 * day,
  updatedAt: now - n * day,
  tags: [],
  ...extra,
});

const household = entry(1, 'Household', 'folder');
const work = entry(2, 'Work', 'folder');
const finance = entry(3, 'Finance', 'folder', { parentId: household.id });
const mealPlan = entry(4, 'Meal plan', 'doc', { parentId: household.id });
const budget = entry(5, 'Quarterly budget', 'sheet', { tags: ['budget', 'q4'] });
const trip = entry(6, 'Trip plan', 'doc', { tags: ['travel'] });
const receipts = entry(10, 'Receipts 2026', 'sheet', { parentId: finance.id, tags: ['tax'] });
const items = [household, work, finance, mealPlan, receipts, budget, trip];

const roadmap = entry(8, 'Team roadmap', 'doc', {
  access: 'viewer',
  ownerName: 'Alex Kim',
  sharedAt: now - 3 * day,
  // Filed into My files, so it also appears in the root listing.
  placementParentId: null,
});
const forecast = entry(9, 'Shared forecast', 'sheet', {
  access: 'editor',
  ownerName: 'Alex Kim',
  tags: ['work'],
  sharedAt: now - 9 * day,
});
const shared = [roadmap, forecast];
// Shared, never opened online on this device: local mode has no saved view.
const photos = entry(11, 'Family photos', 'folder', {
  access: 'editor',
  ownerName: 'Alex Kim',
  sharedAt: now - 5 * day,
});

const empty = {
  'GET /api/items': { items: [] },
  'GET /api/items/shared': { items: [] },
};
const populated = {
  'GET /api/items': { items },
  'GET /api/items/shared': { items: shared },
  'GET /api/items/search': { items: searchCatalog([...items, ...shared]) },
  // Opening a folder lists what it holds, with its parents.
  [`GET /api/items/${household.id}`]: {
    item: household,
    children: [finance, mealPlan],
    ancestors: [],
  },
  [`GET /api/items/${work.id}`]: { item: work, children: [], ancestors: [] },
  [`GET /api/items/${finance.id}`]: {
    item: finance,
    children: [receipts],
    ancestors: [household],
  },
  'GET /api/items/trash': { items: [], version: 'v0' },
};

// Opening a folder pushes /?item=<id>, which would repoint the story iframe.
// Hold history still while the story is mounted.
function StillHistory({ children }: { children: ReactNode }) {
  useEffect(() => {
    const push = history.pushState,
      replace = history.replaceState;
    history.pushState = () => {};
    history.replaceState = () => {};
    return () => {
      history.pushState = push;
      history.replaceState = replace;
    };
  }, []);
  return <>{children}</>;
}
const inWorkspace: Decorator = (Story) => (
  <StillHistory>
    <Story />
  </StillHistory>
);

/** LocalStart is a verified snapshot; give refreshes the same real private records. */
function LocalDeviceFixture({ local, children }: { local: LocalStart; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const previousAccount = preparedAccount();
    const previousHost = currentRuntime();
    const previousWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const manifest: ShellManifest = {
      protocol: 1,
      version: '0123456789abcdef',
      compatibility: { format: 1, sdkVersion: '1.1.0' },
      entry: '/assets/story-runtime.js',
      css: [],
      files: ['/assets/story-runtime.js'],
    };
    installRuntimeHost({
      manifest,
      compatibility: manifest.compatibility,
      switchTo: async () => {
        throw new Error('The inventory fixture does not switch runtimes.');
      },
    });
    // Only the public worker boundary is a fixture; the hook rereads actual IDB.
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          active: {
            postMessage(_message: unknown, ports: MessagePort[]) {
              ports[0].postMessage({ ok: true, prepared: true, manifest });
            },
          },
        }),
      },
    });
    let cancelled = false;
    setPreparedAccount(null);
    setReady(false);
    void (async () => {
      const store = await openOfflineStore(local.user.id);
      try {
        await store.clearAccount(() => {});
        await store.saveCatalog(local.user, local.catalog);
        for (const copy of local.downloads) {
          const creation: OfflineCreationRequest | undefined = copy.creation
            ? {
                version: 1,
                itemId: copy.itemId,
                unitId: crypto.randomUUID(),
                name: copy.name,
                kind: copy.kind,
                parentId: copy.creation.parentId,
              }
            : undefined;
          const bundle = {
            version: 1,
            accountId: local.user.id,
            itemId: copy.itemId,
            spaceId: copy.spaceId,
            name: copy.name,
            kind: copy.kind,
            unitId: creation?.unitId ?? copy.itemId,
            revision: copy.revision,
            revisionOffset: 0,
            access: copy.readOnly ? 'viewer' : 'owner',
            readOnly: copy.readOnly,
            sdkVersion: '1.1.0',
            images: [],
            snapshot: creation
              ? blankOfflineSnapshot(creation)
              : copy.kind === 'sheet'
                ? { id: copy.itemId, sheets: {} }
                : { id: copy.itemId, documentStyle: {} },
          } as OfflineBundle;
          if (creation)
            await store.saveCreation(
              bundle,
              {
                request: creation,
                createdAt: copy.creation!.createdAt,
                problem: copy.creation!.problem,
                canRelocate: copy.creation!.canRelocate,
              },
              () => {},
            );
          else await store.saveDownload(bundle, new Map());
        }
      } finally {
        store.close();
      }
      if (!cancelled) {
        setPreparedAccount(local.user.id);
        setReady(true);
      }
    })().catch((error) => {
      if (!cancelled)
        setProblem(error instanceof Error ? error.message : 'Story preparation failed.');
    });
    return () => {
      cancelled = true;
      if (previousWorker) Object.defineProperty(navigator, 'serviceWorker', previousWorker);
      else Reflect.deleteProperty(navigator, 'serviceWorker');
      if (previousHost) installRuntimeHost(previousHost);
      else delete window.__spinelRuntimeHost;
      setPreparedAccount(previousAccount);
    };
  }, [local]);
  return problem ? (
    <p role="alert">{problem}</p>
  ) : ready ? (
    children
  ) : (
    <p role="status">Preparing story…</p>
  );
}

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  id: 'dashboard-dashboard',
  title: 'Current production/Dashboard/Dashboard',
  component: Dashboard,
  args: {
    navigation: { allow: () => true, dirty() {} },
    user: { id: 'story-owner', name: 'Sam Lee' },
    onOpen: fn(),
  },
  decorators: [
    inWorkspace,
    (Story, context) =>
      context.args.local ? (
        <LocalDeviceFixture local={context.args.local}>
          <Story />
        </LocalDeviceFixture>
      ) : (
        <Story />
      ),
  ],
} satisfies Meta<typeof Dashboard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FileViewTargets: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('heading', { name: 'My files' });
    for (const name of ['List', 'Grid']) {
      const control = canvas.getByRole('radio', { name });
      const bounds = control.getBoundingClientRect();
      await expect(bounds.width).toBeGreaterThanOrEqual(44);
      await expect(bounds.height).toBeGreaterThanOrEqual(44);
      await userEvent.click(control);
      await expect(control).toBeChecked();
    }
  },
};

/**
 * Folders, sheets and docs, plus two items shared by Alex Kim, one filed
 * into My files. Opening a sheet or doc would load the Univer editor, so don't.
 */
export const Populated: Story = { parameters: { api: populated } };
export const NewItem: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'New' }));
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Folder' }),
    );
    await assertDialogControls(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New folder' }),
    );
  },
};
export const NewDoc: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New' }));
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Doc' }),
    );
    await assertDialogControls(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New doc' }),
    );
  },
};
export const NewSheet: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New' }));
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Sheet' }),
    );
    await assertDialogControls(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New sheet' }),
    );
  },
};
export const EmptyWorkspace: Story = { parameters: { api: empty } };
/** The "Shared with me" place lists every share, filed or not, with its access level. */
export const SharedDrawer: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Shared with me' }),
    );
  },
};
/** The place opened before the shared items have arrived. */
export const SharedDrawerLoading: Story = {
  parameters: { api: { ...populated, 'GET /api/items/shared': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Shared with me' }));
    await canvas.findByText('Loading files…');
  },
};
/** A folder two levels down, with its breadcrumb. */
export const InsideFolder: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Household Folder' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Finance Folder' }));
  },
};
export const Loading: Story = { parameters: { api: { ...empty, 'GET /api/items': pending() } } };
export const LoadFailed: Story = {
  parameters: {
    api: { ...empty, 'GET /api/items': failure('Could not load your items. Try again.', 500) },
  },
};
/** A previously listed item can disappear before it is opened. */
export const MissingItem: Story = {
  parameters: {
    api: {
      ...populated,
      [`GET /api/items/${household.id}`]: failure('This item is not available.', 404),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const expectMissing = async () => {
      await expect(
        await canvas.findByRole('heading', { name: "This item isn't available" }),
      ).toBeVisible();
      await expect(canvas.getAllByRole('alert')).toHaveLength(1);
      await expect(canvas.queryByText('This item is not available.')).not.toBeInTheDocument();
      await expect(canvas.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
      await expect(canvas.queryByRole('button', { name: 'Back to files' })).toBeNull();
      const recovery = canvas.getByRole('button', { name: 'Go to My files' });
      await expect(recovery).toBeVisible();
      await expect(recovery).toBeEnabled();
    };
    await userEvent.click(await canvas.findByRole('button', { name: 'Household Folder' }));
    await expectMissing();
    await userEvent.click(canvas.getByRole('button', { name: 'Go to My files' }));
    await expect(await canvas.findByRole('heading', { name: 'My files' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: "This item isn't available" })).toBeNull();
    await userEvent.click(await canvas.findByRole('button', { name: 'Household Folder' }));
    await expectMissing();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
  },
};

/** Distinct per-item failures must remain visible beside the generic fallback. */
export const ItemLoadFailed: Story = {
  parameters: {
    api: {
      ...populated,
      [`GET /api/items/${household.id}`]: failure(
        'Could not open this item. Reload to try again.',
        500,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Household Folder' }));
    await expect(
      await canvas.findByRole('heading', { name: "This item isn't available" }),
    ).toBeVisible();
    await expect(
      await canvas.findByText('Could not open this item. Reload to try again.'),
    ).toBeVisible();
  },
};

// A fixed time, so the banner reads the same on any day.
const synced = Date.UTC(2026, 9, 19, 14, 5);
const local: LocalStart = {
  user: { id: 'story-owner', name: 'Sam Lee' },
  catalog: {
    syncedAt: synced,
    items,
    shared: [...shared, photos],
    views: { [household.id]: [household, finance, mealPlan] },
  },
  downloads: [budget, roadmap].map((item) => ({
    itemId: item.id,
    name: item.name,
    kind: item.kind as 'sheet' | 'doc',
    readOnly: item.access === 'viewer',
    revision: 1,
    downloadedAt: synced,
    available: true,
  })),
};
/**
 * Offline on a prepared device: the last-synced list. Downloaded
 * items say Available offline; other Sheets and Docs say Needs a connection.
 */
export const LocalMode: Story = {
  args: { local },
  parameters: { api: empty },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', { name: 'My files' }),
    ).toBeVisible();
  },
};

export const NewOfflineDoc: Story = {
  ...LocalMode,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'New' }));
    const menu = within(await body.findByRole('menu'));
    await expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Sheet',
      'Doc',
    ]);
    await userEvent.click(menu.getByRole('menuitem', { name: 'Doc' }));
    const dialog = within(await body.findByRole('dialog', { name: 'New doc' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Name' }), 'Notes for the journey');
    await expect(dialog.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Sheet',
      'Doc',
    ]);
    await expect(
      dialog.getByText('This document will save on this device and upload when connected.'),
    ).toBeVisible();
    await assertDialogControls(body.getByRole('dialog', { name: 'New doc' }));
  },
};

const pendingCreation = {
  itemId: id(31),
  name: 'Notes for the journey',
  kind: 'doc' as const,
  readOnly: false,
  revision: 1,
  downloadedAt: synced,
  pending: true,
  available: true,
  creation: { parentId: null, createdAt: synced },
};
const blockedCreation = {
  ...pendingCreation,
  itemId: id(32),
  name: 'Planning for next week',
  kind: 'sheet' as const,
  creation: {
    parentId: household.id,
    createdAt: synced,
    problem:
      'The chosen folder is no longer available. Choose another folder for this device copy.',
    canRelocate: true,
  },
};
export const CreatedOffline: Story = {
  args: { local: { ...local, downloads: [...local.downloads, pendingCreation, blockedCreation] } },
  parameters: { api: empty },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Not synced yet')).toBeVisible();
    await expect(await canvas.findByText('Needs attention')).toBeVisible();
    await expect(
      canvas.queryByRole('link', { name: `Recover ${pendingCreation.name}` }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('link', { name: `Recover ${blockedCreation.name}` }),
    ).not.toBeInTheDocument();
  },
};
export const ChooseCreationFolder: Story = {
  ...CreatedOffline,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole('button', { name: `More actions for ${blockedCreation.name}` }),
    );
    await userEvent.click(await body.findByRole('menuitem', { name: 'Choose another folder…' }));
    const dialog = within(await body.findByRole('dialog', { name: 'Choose another folder' }));
    await expect(dialog.getByRole('combobox', { name: 'Destination' })).toHaveValue('');
    await expect(dialog.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'My files',
      'Household',
      'Household / Finance',
      'Work',
    ]);
    await assertDialogControls(body.getByRole('dialog', { name: 'Choose another folder' }));
  },
};
/** A cached destination later shared back to us cannot hide an unuploaded draft. */
export const CreationParentNowShared: Story = {
  args: {
    local: {
      ...local,
      catalog: {
        ...local.catalog,
        items: local.catalog.items.filter((item) => item.id !== household.id),
        shared: [
          ...local.catalog.shared,
          { ...household, access: 'editor', ownerName: 'Alex Kim', placementParentId: null },
        ],
      },
      downloads: [
        ...local.downloads,
        {
          ...pendingCreation,
          creation: { ...pendingCreation.creation, parentId: household.id },
        },
      ],
    },
  },
  parameters: { api: empty },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      await canvas.findByRole('button', { name: `${pendingCreation.name} Doc` }),
    ).toBeVisible();
    await expect(canvas.getByText('Not synced yet')).toBeVisible();
    await expect(
      canvas.getByText('Saved on this device. Open to upload when connected.'),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: `More actions for ${pendingCreation.name}` }),
    );
    const menu = within(await body.findByRole('menu'));
    await expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open']);
    await userEvent.keyboard('{Escape}');
  },
};
/** An old folder view supplies context, not a reachable destination in My files. */
export const CreationParentNoLongerListed: Story = {
  args: {
    local: {
      ...local,
      catalog: {
        ...local.catalog,
        items: local.catalog.items.filter((item) => item.id !== household.id),
        // Keep the old owned view to reproduce deletion after the last visit.
        views: local.catalog.views,
      },
      downloads: [
        ...local.downloads,
        {
          ...pendingCreation,
          creation: { ...pendingCreation.creation, parentId: household.id },
        },
      ],
    },
  },
  parameters: { api: empty },
  play: CreationParentNowShared.play,
};
/** Offline, a Doc that wasn't downloaded stays listed but can't open. */
export const LocalNeedsConnection: Story = {
  ...LocalMode,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: new RegExp(`^${trip.name}`) }),
    );
  },
};
/** Offline, a folder this device never listed online has nothing saved to show. */
export const LocalFolderNotOpened: Story = {
  ...LocalMode,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Shared with me' }));
    await userEvent.click(await canvas.findByRole('button', { name: `${photos.name} Folder` }));
    await expect(await canvas.findByText(/This folder wasn’t opened online/)).toBeVisible();
    await expect(canvas.queryByText('This folder is empty.')).not.toBeInTheDocument();
  },
};

const space: SpaceFile = {
  ...entry(12, 'Research Space', 'folder'),
  kind: 'space',
  tags: ['research'],
};
const filedSpace: SpaceFile = {
  ...space,
  id: id(13),
  name: 'Team Space',
  access: 'editor',
  ownerName: 'Alex Kim',
  sharedAt: now - day,
  placementParentId: null,
};
const viewerSpace: SpaceFile = {
  ...filedSpace,
  id: id(14),
  name: 'Reference Space',
  access: 'viewer',
  placementParentId: undefined,
};
const withSpaces = {
  ...populated,
  'GET /api/items': { items: [...items, space], spacesEnabled: true },
  'GET /api/items/shared': { items: [...shared, filedSpace, viewerSpace] },
  'GET /api/items/search': {
    items: searchCatalog([...items, ...shared, space, filedSpace, viewerSpace]),
  },
};
export const SpaceFiles: Story = { parameters: { api: withSpaces } };
export const NewSpace: Story = {
  parameters: { api: withSpaces },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New' }));
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Space' }),
    );
  },
};
export const OpenSpaceKeepsMyFiles: Story = {
  parameters: { api: withSpaces },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^Research Space Space$/ }));
    await expect(args.onOpen).toHaveBeenCalledWith(space);
    await expect(canvas.getByRole('heading', { name: 'My files' })).toBeVisible();
  },
};
export const SharedSpaces: Story = {
  parameters: { api: withSpaces },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Shared with me' }));
    const files = within(canvas.getByRole('list', { name: 'Shared with me files' }));
    await expect(await files.findByRole('button', { name: 'Team Space Space' })).toBeVisible();
    await userEvent.click(files.getByRole('button', { name: 'More actions for Team Space' }));
    const menu = within(await within(canvasElement.ownerDocument.body).findByRole('menu'));
    await expect(menu.queryByRole('menuitem', { name: 'Share…' })).not.toBeInTheDocument();
    await expect(menu.queryByRole('menuitem', { name: 'Move…' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  },
};
export const SpaceInsideFolder: Story = {
  parameters: {
    api: {
      ...withSpaces,
      'GET /api/items': {
        items: [...items, { ...space, parentId: household.id }],
        spacesEnabled: true,
      },
      [`GET /api/items/${household.id}`]: {
        item: household,
        ancestors: [],
        children: [finance, mealPlan, { ...space, parentId: household.id }],
      },
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Household Folder' }),
    );
  },
};
export const LocalSpaceNeedsConnection: Story = {
  args: { local: { ...local, catalog: { ...local.catalog, items: [...items, space] } } },
  parameters: { api: empty },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^Research Space Space$/ }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('Connect to open this Space');
  },
};

const unpreparedSpace: SpaceFile = { ...space, id: id(16), name: 'Unprepared Space' };
export const LocalPreparedSpaceOpens: Story = {
  args: {
    onOpen: fn(),
    local: {
      ...local,
      catalog: { ...local.catalog, items: [...items, space, unpreparedSpace] },
      downloads: [
        ...local.downloads,
        {
          itemId: id(15),
          spaceId: space.id,
          name: 'Prepared notes',
          kind: 'doc',
          readOnly: false,
          revision: 4,
          downloadedAt: synced,
          available: true,
        },
      ],
    },
  },
  parameters: { api: empty },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const prepared = await canvas.findByRole('button', { name: /^Research Space Space$/ });
    await expect(
      within(prepared.closest('[role=listitem]')!).getByText('Pages available offline'),
    ).toBeVisible();
    const unavailable = canvas.getByRole('button', { name: /^Unprepared Space Space$/ });
    await expect(
      within(unavailable.closest('[role=listitem]')!).getByText('Needs a connection'),
    ).toBeVisible();
    await userEvent.click(unavailable);
    await expect(args.onOpen).not.toHaveBeenCalled();
    await expect(canvas.getByRole('alert')).toHaveTextContent('Connect to open this Space');
    await userEvent.click(prepared);
    await expect(args.onOpen).toHaveBeenCalledTimes(1);
    await expect(args.onOpen).toHaveBeenCalledWith(space);
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
    await expect(canvas.getByRole('heading', { name: 'My files' })).toBeVisible();
  },
};

export const FileAdmins: Story = {
  parameters: {
    api: {
      ...populated,
      'GET /api/items/shared': {
        items: [
          { ...roadmap, access: 'admin' },
          { ...forecast, access: 'admin', placementParentId: null },
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'More actions for Team roadmap' }),
    );
    const menu = within(await within(canvasElement.ownerDocument.body).findByRole('menu'));
    await expect(menu.getByRole('menuitem', { name: 'Share…' })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: 'Move…' })).toBeEnabled();
  },
};

export const CancelAdminMoveWhileLoading: Story = {
  parameters: {
    api: {
      ...populated,
      'GET /api/items/shared': { items: [{ ...roadmap, access: 'admin' }] },
      [`GET /api/items/${roadmap.id}/destinations`]: pending(),
    },
  },
  play: async ({ canvasElement }) => {
    await rowAction(canvasElement, 'Team roadmap', 'Move…');
    const move = await within(canvasElement.ownerDocument.body).findByRole('form', {
      name: 'Move item',
    });
    await expect(within(move).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(within(move).getByRole('button', { name: 'Cancel' }));
    await rowAction(canvasElement, 'Team roadmap', 'Rename…');
    const rename = await within(canvasElement.ownerDocument.body).findByRole('form', {
      name: 'Rename item',
    });
    await expect(within(rename).getByRole('button', { name: 'Save' })).toBeEnabled();
    await assertDialogControls(rename);
  },
};

export const FileAdminNoDestinations: Story = {
  parameters: {
    api: {
      ...populated,
      'GET /api/items/shared': { items: [{ ...roadmap, access: 'admin' }] },
      [`GET /api/items/${roadmap.id}/destinations`]: { items: [] },
    },
  },
  play: async ({ canvasElement }) => {
    await rowAction(canvasElement, 'Team roadmap', 'Move…');
    const move = await within(canvasElement.ownerDocument.body).findByRole('form', {
      name: 'Move item',
    });
    await expect(
      await within(move).findByText(/No authorized folders are available/),
    ).toBeVisible();
    await expect(within(move).getByLabelText('Destination')).toBeDisabled();
    await expect(within(move).getByRole('button', { name: 'Save' })).toBeDisabled();
    await assertDialogControls(move);
  },
};

export const FileAdminPersonalFiling: Story = {
  parameters: {
    api: {
      ...populated,
      'GET /api/items/shared': { items: [{ ...roadmap, access: 'admin' }] },
      [`DELETE /api/items/${roadmap.id}/placement`]: {
        items: [{ ...roadmap, access: 'admin', placementParentId: undefined }],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowAction(canvasElement, 'Team roadmap', 'Remove from my folder');
    await expect(
      canvas.queryByRole('button', { name: 'Team roadmap Doc' }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Shared with me' }));
    await userEvent.click(
      await canvas.findByRole('button', { name: 'More actions for Team roadmap' }),
    );
    const menu = within(await within(canvasElement.ownerDocument.body).findByRole('menu'));
    await expect(menu.getByRole('menuitem', { name: 'Share…' })).toBeEnabled();
    await expect(
      menu.queryByRole('menuitem', { name: 'Remove from my folder' }),
    ).not.toBeInTheDocument();
  },
};

async function rowAction(element: HTMLElement, name: string, action: string) {
  await userEvent.click(
    await within(element).findByRole('button', { name: `More actions for ${name}` }),
  );
  await userEvent.click(
    await within(element.ownerDocument.body).findByRole('menuitem', { name: action }),
  );
}
export const Grid: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('radio', { name: 'Grid' }));
  },
};
export const FolderScopedSearch: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Household Folder' }));
    await userEvent.type(
      await canvas.findByRole('searchbox', { name: 'Search files' }),
      'type:sheet',
    );
    await expect(
      await canvas.findByRole('button', { name: 'Open result Receipts 2026' }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole('button', { name: 'Open result Quarterly budget' }),
    ).not.toBeInTheDocument();
  },
};
export const ImportDialog: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'New' }));
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', {
        name: 'Import file…',
      }),
    );
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Import file' }),
    ).toBeVisible();
    await assertDialogControls(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Import file' }),
    );
  },
};

export const ExportAllFiles: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const menu = await within(canvasElement).findByRole('button', {
      name: 'More actions for My files',
    });
    await userEvent.click(menu);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export all my files' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export all my files' });
    await expect(within(dialog).getByRole('button', { name: 'Export files' })).toBeEnabled();
    await assertDialogControls(dialog);
  },
};

export const CancelExportConfirmation: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const menu = await within(canvasElement).findByRole('button', {
      name: 'More actions for My files',
    });
    await userEvent.click(menu);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export all my files' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(
      screen.queryByRole('dialog', { name: 'Export all my files' }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(menu).toHaveFocus());
  },
};

export const PersonalFilingDialog: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Shared with me' }),
    );
    await rowAction(canvasElement, forecast.name, 'File into folder…');
    const form = await within(canvasElement.ownerDocument.body).findByRole('form', {
      name: 'File shared item',
    });
    await expect(within(form).getByRole('button', { name: 'Save' })).toBeEnabled();
    await assertDialogControls(form);
  },
};

export const SharingDialog: Story = {
  parameters: {
    api: {
      ...populated,
      [`GET /api/items/${budget.id}/sharing`]: {
        people: [
          {
            id: 'morgan',
            name: 'Morgan Lee',
            disabled: 0,
            directRole: 'editor',
            effectiveRole: 'editor',
          },
        ],
      },
      [`GET /api/items/${budget.id}/link`]: { enabled: false, role: 'viewer' },
    },
  },
  play: async ({ canvasElement }) => {
    await rowAction(canvasElement, budget.name, 'Share…');
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: `Share ${budget.name}`,
    });
    await expect(await within(dialog).findByLabelText('Access for Morgan Lee')).toBeEnabled();
    await expect(
      within(dialog).getByRole('button', { name: 'Apply access for Morgan Lee' }),
    ).toBeDisabled();
    await assertDialogControls(dialog);
  },
};

export const SharedGrantOrdering: Story = {
  parameters: {
    api: {
      ...populated,
      'GET /api/items/shared': {
        items: [
          { ...roadmap, name: 'Z newest share', sharedAt: now },
          { ...forecast, name: 'A older share', sharedAt: now - day },
          { ...photos, name: 'Unknown legacy share', sharedAt: 0 },
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Shared with me' }));
    const files = within(await canvas.findByRole('list', { name: 'Shared with me files' }));
    const rows = files.getAllByRole('listitem');
    await expect(rows[0]).toHaveTextContent('Z newest share');
    await expect(rows[1]).toHaveTextContent('A older share');
    await expect(rows[2]).toHaveTextContent('Older share');
    await expect(rows[2]).not.toHaveTextContent('1970');
  },
};

export const CancelSpaceActionThenRetry: Story = {
  parameters: { api: withSpaces },
  args: { navigation: { allow: fn(), dirty() {} } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Cancelling a discard prompt must not consume the next explicit activation.
    const allow = args.navigation.allow as ReturnType<typeof fn>;
    allow.mockReset().mockReturnValueOnce(false).mockReturnValue(true);
    await userEvent.type(
      await canvas.findByRole('searchbox', { name: 'Search files' }),
      'Research type:space',
    );
    await rowAction(canvasElement, 'Research Space', 'Rename…');
    await expect(allow).toHaveBeenCalledTimes(1);
    await expect(
      within(canvasElement.ownerDocument.body).queryByRole('dialog', { name: 'Rename Space' }),
    ).not.toBeInTheDocument();
    await rowAction(canvasElement, 'Research Space', 'Rename…');
    await expect(allow).toHaveBeenCalledTimes(2);
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Rename Space' }),
    ).toBeVisible();
  },
};

export const ClearEmptyGlobalScope: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Household Folder' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Search all files' }));
    await expect(canvas.getByText('All accessible files')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search and filters' }));
    await expect(canvas.getByRole('searchbox', { name: 'Search files' })).toHaveValue('');
    await expect(canvas.getByRole('button', { name: 'Search all files' })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Household' })).toBeVisible();
    await expect(canvas.queryByText('All accessible files')).not.toBeInTheDocument();
  },
};
