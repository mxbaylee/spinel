import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { SpaceFile } from '../src/shared/workspace.ts';
import { OfflineSpace, OfflineSpaceView } from './OfflineSpace.tsx';
import type { LocalStart } from './offline/localStart.ts';
import type { OfflineDownload } from './offline/offlineStore.ts';
import { selectOfflineSpace } from './offline/spaceCopies.ts';
import { readSpaceLocation } from './spaceNavigation.ts';

const id = (value: number) => value.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000093';
const user = { id: 'storybook-offline-space', name: 'Baylee', icon: 'lucide:sparkles' };
const root: SpaceFile = {
  id: id(1),
  name: 'Project Atlas',
  kind: 'space',
  parentId: id(90),
  access: 'owner',
  tags: [],
  createdAt: 1,
  updatedAt: 2,
};
const copy = (value: number, name: string, spaceId = root.id): OfflineDownload => ({
  itemId: id(value),
  name,
  kind: 'doc',
  spaceId,
  readOnly: false,
  revision: 4,
  downloadedAt: Date.UTC(2026, 9, 22, 10),
});
const local: LocalStart = {
  user,
  catalog: {
    syncedAt: Date.UTC(2026, 9, 22, 10),
    items: [root],
    shared: [],
    views: { [root.id]: [root] },
  },
  downloads: [
    copy(2, 'Project notes'),
    copy(3, 'Research notes'),
    copy(4, 'Another Space’s private notes', id(10)),
  ],
};
const path = '/spaces/' + root.id;
const selection = (href: string, accountId = user.id) =>
  selectOfflineSpace(local, accountId, readSpaceLocation(new URL(href, 'https://spinel.test')));

/** Native loading and image verification have separate browser and service proofs. */
function NativeViewerFixture() {
  return (
    <section aria-label="Downloaded document fixture" style={{ padding: 24 }}>
      <p className="sp-muted">
        Doc body fixture · the application opens the verified native copy here.
      </p>
      <article
        style={{
          maxWidth: 680,
          marginTop: 24,
          padding: 24,
          border: '1px solid var(--sp-border)',
          borderRadius: 8,
          background: 'var(--sp-panel)',
          lineHeight: 1.7,
        }}
      >
        <h2>Project notes</h2>
        <p>Keep the research, planning and decisions for Project Atlas in one place.</p>
        <h3 style={{ marginTop: 24 }}>Before the workshop</h3>
        <p>Review the research notes and write down the questions we want to answer together.</p>
        <p style={{ marginTop: 24 }} className="sp-muted">
          Saved on this device — waiting to sync.
        </p>
      </article>
    </section>
  );
}

function RouteFixture({ href, children }: { href: string; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const previous = { href: location.href, state: history.state };
    history.replaceState({}, '', href);
    setReady(true);
    return () => history.replaceState(previous.state, '', previous.href);
  }, [href]);
  return ready ? children : null;
}

const meta = {
  id: 'space-offline-view',
  title: 'Current production/Spaces/Offline documents',
  component: OfflineSpaceView,
  parameters: { shell: 'none' },
  args: {
    user,
    selection: selection(path),
    onExit: fn(),
    onProfile: fn(),
    viewer: <NativeViewerFixture />,
  },
} satisfies Meta<typeof OfflineSpaceView>;
export default meta;
type Story = StoryObj<typeof meta>;

const checkCopies = async (canvasElement: HTMLElement, openPhone = false) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole('heading', { name: 'Project notes', level: 1 })).toBeVisible();
  await expect(canvas.queryByText('Another Space’s private notes')).not.toBeInTheDocument();
  let container = canvas;
  if (window.matchMedia('(max-width: 900px)').matches) {
    if (!openPhone) return;
    await userEvent.click(canvas.getByRole('button', { name: 'Open Space contents' }));
    container = within(
      await within(document.body).findByRole('dialog', { name: 'Space contents' }),
    );
  }
  const navigation = within(container.getByRole('navigation', { name: 'Prepared pages' }));
  await expect(navigation.getAllByRole('link')).toHaveLength(2);
  await expect(navigation.getByRole('link', { name: 'Research notes' })).toHaveAttribute(
    'href',
    path + '?item=' + id(3),
  );
};

export const Light: Story = {
  play: ({ canvasElement }) => checkCopies(canvasElement),
};
export const Dark: Story = { ...Light, globals: { theme: 'dark' } };
export const ProfileNavigation: Story = {
  args: { selection: selection('/spaces/' + id(20)) },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Your profile' }));
    await expect(args.onProfile).toHaveBeenCalled();
  },
};
export const EditorNavigation: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const workspace = within(await canvas.findByRole('region', { name: 'Document workspace' }));
    await expect(canvas.getAllByRole('button', { name: 'My files' })).toHaveLength(1);
    await expect(canvas.queryByRole('button', { name: 'Your profile' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Spinel home' })).not.toBeInTheDocument();
    await userEvent.click(workspace.getByRole('button', { name: 'My files' }));
    await expect(args.onExit).toHaveBeenCalled();
  },
};
export const Phone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: ({ canvasElement }) => checkCopies(canvasElement, true),
};
/** The production controller must not open its default copy for an unavailable explicit child. */
export const ExplicitPageNotPrepared: Story = {
  render: (args) => (
    <RouteFixture href={path + '?item=' + id(99)}>
      <OfflineSpace local={local} user={user} onExit={args.onExit} onProfile={args.onProfile} />
    </RouteFixture>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/This page needs a connection/)).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Project notes' })).not.toBeInTheDocument();
    await expect(canvas.queryByText('Opening offline copy…')).not.toBeInTheDocument();
  },
};
export const NoPreparedPages: Story = {
  args: { selection: selection('/spaces/' + id(20)) },
};
export const SpaceIndex: Story = { args: { selection: selection('/spaces') } };
export const AnotherAccount: Story = {
  args: { selection: selection(path, 'another-account') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/These offline copies belong to another account/)).toBeVisible();
    await expect(canvas.queryByText('Project Atlas')).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('navigation', { name: 'Prepared pages' }),
    ).not.toBeInTheDocument();
  },
};
