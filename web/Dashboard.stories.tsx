import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { ItemKind, SpaceFile, WorkspaceItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { Dashboard } from './Dashboard.tsx';
import type { LocalStart } from './offline/localStart.ts';

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
    const push = history.pushState;
    history.pushState = () => {};
    return () => {
      history.pushState = push;
    };
  }, []);
  return <>{children}</>;
}
const inWorkspace: Decorator = (Story) => (
  <StillHistory>
    <Story />
  </StillHistory>
);

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
  decorators: [inWorkspace],
} satisfies Meta<typeof Dashboard>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Folders, sheets and docs, plus two items shared by Alex Kim, one filed
 * into My files. Opening a sheet or doc would load the Univer editor, so don't.
 */
export const Populated: Story = { parameters: { api: populated } };
export const NewItem: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'New' }));
  },
};
export const NewDoc: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New' }));
    await userEvent.selectOptions(canvas.getByLabelText('Type'), 'doc');
  },
};
export const NewSheet: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New' }));
    await userEvent.selectOptions(canvas.getByLabelText('Type'), 'sheet');
  },
};
export const EmptyWorkspace: Story = { parameters: { api: empty } };
/** The "Shared with me" drawer lists every share, filed or not, with its access level. */
export const SharedDrawer: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Shared with me' }),
    );
  },
};
/** The drawer opened before the shared items have arrived. */
export const SharedDrawerLoading: Story = {
  parameters: { api: { ...populated, 'GET /api/items/shared': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Shared with me' }));
    await canvas.findByText('Loading shared items…');
  },
};
/** A folder two levels down, with its breadcrumb. */
export const InsideFolder: Story = {
  parameters: { api: populated },
  play: async ({ canvasElement }) => {
    const sidebar = await within(canvasElement).findByRole('complementary', { name: 'Folders' });
    await userEvent.click(await within(sidebar).findByRole('button', { name: 'Finance' }));
  },
};
export const Loading: Story = { parameters: { api: { ...empty, 'GET /api/items': pending() } } };
export const LoadFailed: Story = {
  parameters: {
    api: { ...empty, 'GET /api/items': failure('Could not load your items. Try again.', 500) },
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
  })),
};
/**
 * Offline on a prepared device: the last-synced list, read-only. Downloaded
 * items say Available offline; other Sheets and Docs say Needs a connection.
 */
export const LocalMode: Story = {
  args: { local },
  parameters: { api: empty },
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
    await userEvent.click(await canvas.findByRole('button', { name: `Open ${photos.name}` }));
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
};
export const SpaceFiles: Story = { parameters: { api: withSpaces } };
export const NewSpace: Story = {
  parameters: { api: withSpaces },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'New' }));
    await userEvent.selectOptions(canvas.getByLabelText('Type'), 'space');
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
    const drawer = within(canvas.getByRole('region', { name: 'Shared with me' }));
    await expect(await drawer.findByRole('button', { name: 'Open Team Space' })).toBeVisible();
    await expect(
      drawer.queryByRole('button', { name: 'Share Team Space' }),
    ).not.toBeInTheDocument();
    await expect(
      drawer.queryByRole('button', { name: 'Move Reference Space' }),
    ).not.toBeInTheDocument();
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
    const sidebar = await within(canvasElement).findByRole('complementary', { name: 'Folders' });
    await userEvent.click(await within(sidebar).findByRole('button', { name: 'Household' }));
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
        },
      ],
    },
  },
  parameters: { api: empty },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const prepared = await canvas.findByRole('button', { name: /^Research Space Space$/ });
    await expect(
      within(prepared.closest('li')!).getByText('Pages available offline'),
    ).toBeVisible();
    const unavailable = canvas.getByRole('button', { name: /^Unprepared Space Space$/ });
    await expect(within(unavailable.closest('li')!).getByText('Needs a connection')).toBeVisible();
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
    await expect(await canvas.findByRole('button', { name: 'Share Team roadmap' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Move Shared forecast' })).toBeVisible();
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
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Move Team roadmap' }));
    const move = await canvas.findByRole('form', { name: 'Move item' });
    await expect(within(move).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(within(move).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Rename Team roadmap' }));
    const rename = await canvas.findByRole('form', { name: 'Rename item' });
    await expect(within(rename).getByRole('button', { name: 'Save' })).toBeEnabled();
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
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Move Team roadmap' }));
    const move = await canvas.findByRole('form', { name: 'Move item' });
    await expect(
      await within(move).findByText(/No authorized folders are available/),
    ).toBeVisible();
    await expect(within(move).getByLabelText('Destination')).toBeDisabled();
    await expect(within(move).getByRole('button', { name: 'Save' })).toBeDisabled();
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
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Remove Team roadmap from my folder' }),
    );
    await expect(
      canvas.queryByRole('button', { name: 'Remove Team roadmap from my folder' }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Shared with me' }));
    await expect(await canvas.findByRole('button', { name: 'Share Team roadmap' })).toBeVisible();
  },
};
