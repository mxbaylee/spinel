import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { OfflineBundle } from '../src/shared/offlineBundle.ts';
import type { SpaceNode } from '../src/shared/spaces.ts';
import type { SpaceFile } from '../src/shared/workspace.ts';
import { SpaceOfflineActions } from './SpaceOfflineActions.tsx';
import { OFFLINE_SDK_VERSION } from './offline/OfflineAccess.ts';
import {
  openOfflineStore,
  preparedAccount,
  setPreparedAccount,
  spaceOfflineCatalog,
} from './offline/offlineStore.ts';
import './space.css';

const id = (value: number) => value.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000092';
const user = { id: 'storybook-space-offline-actions', name: 'Baylee' };
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
const item: SpaceNode = {
  id: id(2),
  name: 'Project notes',
  kind: 'doc',
  parentId: root.id,
  spaceId: root.id,
  position: 0,
  createdAt: 1,
  updatedAt: 2,
};

/** Only metadata is rendered here; the production viewer verifies the full native copy. */
function bundle(itemId: string, name: string, spaceId: string): OfflineBundle {
  return {
    version: 1,
    accountId: user.id,
    itemId,
    spaceId,
    name,
    kind: 'doc',
    unitId: itemId,
    revision: 1,
    revisionOffset: 0,
    access: 'owner',
    readOnly: false,
    sdkVersion: OFFLINE_SDK_VERSION,
    images: [],
    snapshot: { id: itemId, documentStyle: {} },
  } as OfflineBundle;
}

function DeviceFixture({ prepared, children }: { prepared: boolean; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const previous = preparedAccount();
    let cancelled = false;
    setPreparedAccount(null);
    void (async () => {
      if (prepared) {
        const store = await openOfflineStore(user.id);
        try {
          for (const download of await store.downloads()) await store.remove(download.itemId);
          await store.saveCatalog(user, spaceOfflineCatalog(root));
          for (const value of [
            bundle(item.id, item.name, root.id),
            bundle(id(3), 'Research notes', root.id),
            bundle(id(4), 'Another Space’s private notes', id(10)),
          ])
            await store.saveDownload(value, new Map());
        } finally {
          store.close();
        }
      }
      if (cancelled) return;
      if (prepared) setPreparedAccount(user.id);
      setReady(true);
    })().catch((error) => {
      if (!cancelled)
        setProblem(error instanceof Error ? error.message : 'Could not prepare story data.');
    });
    return () => {
      cancelled = true;
      setPreparedAccount(previous);
    };
  }, [prepared]);
  return problem ? (
    <p role="alert">{problem}</p>
  ) : ready ? (
    children
  ) : (
    <p role="status">Preparing story…</p>
  );
}

const meta = {
  id: 'space-offline-actions',
  title: 'Current production/Spaces/Offline availability',
  component: SpaceOfflineActions,
  parameters: { shell: 'none' },
  args: { user, root, item, saved: true, onOpen: fn() },
  decorators: [
    (Story, context) => (
      <DeviceFixture prepared={Boolean(context.parameters.prepared)}>
        <div className="sp-ui">
          <header className="space-page-header">
            <div className="space-page-identity">
              <p>Space · {root.name}</p>
              <h1>{item.name}</h1>
            </div>
          </header>
          <Story />
        </div>
      </DeviceFixture>
    ),
  ],
} satisfies Meta<typeof SpaceOfflineActions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToPrepare: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('button', {
        name: 'Make Project notes available offline on this device',
      }),
    ).toBeEnabled();
  },
};
export const WaitingForSave: Story = {
  args: { saved: false },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('button', {
        name: 'Make Project notes available offline on this device',
      }),
    ).toBeDisabled();
    await expect(
      within(canvasElement).getByText(/Wait until this page is connected and saved/),
    ).toBeVisible();
  },
};
export const PreparedPages: Story = {
  parameters: { prepared: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: 'Remove Project notes from this device' });
    await userEvent.click(await canvas.findByText('On this device (2)'));
    const pages = canvas.getByRole('list', { name: 'Prepared pages in this Space' });
    await expect(within(pages).getAllByRole('button')).toHaveLength(2);
    await expect(canvas.queryByText('Another Space’s private notes')).not.toBeInTheDocument();
    await userEvent.click(within(pages).getByRole('button', { name: 'Research notes' }));
    await expect(args.onOpen).toHaveBeenCalledWith(id(3));
  },
};
export const PreparedDark: Story = { ...PreparedPages, globals: { theme: 'dark' } };
export const PreparedPhone: Story = {
  ...PreparedPages,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
