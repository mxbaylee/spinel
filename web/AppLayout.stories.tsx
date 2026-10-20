import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ItemKind, WorkspaceItem } from '../src/shared/workspace.ts';
import { Dashboard } from './Dashboard.tsx';
import { PinnedSidebar, PinsProvider } from './Pins.tsx';
import { Rail } from './Rail.tsx';

// The signed-in member's shell as App.tsx composes the dashboard route: the
// rail, the pinned sidebar and the dashboard. Nothing here opens a sheet or doc,
// which would load the Univer editor.
const day = 86_400_000;
const now = Date.now();
const id = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
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
const mealPlan = entry(3, 'Meal plan', 'doc', { parentId: household.id });
const budget = entry(4, 'Quarterly budget', 'sheet', { tags: ['budget', 'q4'] });
const trip = entry(5, 'Trip plan', 'doc', { tags: ['travel'] });
const deck = entry(6, 'Offsite deck', 'slides');
const roadmap = entry(7, 'Team roadmap', 'doc', {
  access: 'viewer',
  ownerName: 'Alex Kim',
  sharedAt: now - 3 * day,
  placementParentId: null,
});

// Each story sets `parameters.api` in full: Storybook deep-merges parameters.
const workspace = {
  'GET /api/items': { items: [household, work, mealPlan, budget, trip, deck] },
  'GET /api/items/shared': { items: [roadmap] },
  'GET /api/items/pins': { items: [budget, trip] },
  [`GET /api/items/${household.id}`]: { item: household, children: [mealPlan], ancestors: [] },
  [`GET /api/items/${work.id}`]: { item: work, children: [], ancestors: [] },
  'GET /api/items/trash': { items: [], version: 'v0' },
};

// Opening a folder pushes /?item=<id>, which would repoint the story iframe.
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

// The guard declines rail links so they don't load the app's routes in the canvas;
// the dashboard's own navigation stays in place through StillHistory.
const railNavigation = { allow: () => false };
const navigation = { allow: () => true, dirty() {} };

function AppLayout() {
  return (
    <StillHistory>
      <PinsProvider enabled>
        <div className="workspace">
          <Rail user={{ isAdmin: false }} navigation={railNavigation} onSignOut={() => {}} />
          <div className="workspace-body">
            <PinnedSidebar navigation={navigation} />
            <main>
              <Dashboard navigation={navigation} user={{ id: 'story-user', name: 'Ada' }} />
            </main>
          </div>
        </div>
      </PinsProvider>
    </StillHistory>
  );
}

const meta = {
  title: 'Shell/AppLayout',
  component: AppLayout,
  // This story is the shell, so the preview must not wrap it in another one.
  parameters: { shell: 'none' },
} satisfies Meta<typeof AppLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The rail down the left, pins beside the dashboard's folders and files. */
export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: { api: workspace },
};
/** Below 900px the pins move above the dashboard in a wrapping row; the rail stays at the side. */
export const Tablet: Story = {
  globals: { viewport: { value: 'tablet', isRotated: false } },
  parameters: { api: workspace },
};
/**
 * Below 640px the rail is a bar across the top; below 600px the folder list
 * stacks above the files, under the pins.
 */
export const Phone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  parameters: { api: workspace },
};
