import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import type { ItemKind, WorkspaceItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { Dashboard } from './Dashboard.tsx';
import type { LocalStart } from './offline/localStart.ts';
import { PinsProvider } from './Pins.tsx';

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
  'GET /api/items/pins': { items: [] },
};
const populated = {
  'GET /api/items': { items },
  'GET /api/items/shared': { items: shared },
  'GET /api/items/pins': { items: [budget] },
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
    <PinsProvider enabled>
      <Story />
    </PinsProvider>
  </StillHistory>
);

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  title: 'Dashboard/Dashboard',
  component: Dashboard,
  args: {
    navigation: { allow: () => true, dirty() {} },
    user: { id: 'story-owner', name: 'Sam Lee' },
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
    pins: [budget],
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
// Local mode reads the saved pins, not the API.
const localPins: Decorator = (Story) => (
  <PinsProvider enabled={false} offline={local.catalog.pins}>
    <Story />
  </PinsProvider>
);
export const LocalMode: Story = {
  args: { local },
  parameters: { api: empty },
  decorators: [localPins],
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
