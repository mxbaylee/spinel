import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { OfflineBundle } from '../src/shared/offlineBundle.ts';
import type { ShellManifest } from '../src/shared/offlineShell.ts';
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
import { useOfflineDownloads } from './offline/useOfflineDownloads.ts';
import { currentRuntime, installRuntimeHost } from './offline/runtime.ts';
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
export const StorageUnavailable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prepare = await canvas.findByRole('button', {
      name: 'Make Project notes available offline on this device',
    });
    const previous = Object.getOwnPropertyDescriptor(window, 'localStorage');
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Storage blocked', 'SecurityError');
        },
      });
      await userEvent.click(prepare);
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
        'Offline downloads need browser storage. Allow storage or free up space, then try again.',
      );
      await expect(prepare).toBeEnabled();
    } finally {
      if (previous) Object.defineProperty(window, 'localStorage', previous);
      else Reflect.deleteProperty(window, 'localStorage');
    }
  },
};
export const StorageUnavailableDark: Story = { ...StorageUnavailable, globals: { theme: 'dark' } };
export const StorageUnavailablePhone: Story = {
  ...StorageUnavailable,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
export const PreparedPages: Story = {
  parameters: { prepared: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: 'Remove Project notes from this device' });
    // These records deliberately have no complete public app shell. Their
    // presence alone must not become an availability claim.
    await expect(await canvas.findByText('Device copy needs attention')).toBeVisible();
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

function DelayedDownloadControls({
  accountId,
  onSettled,
}: {
  accountId: string;
  onSettled(): void;
}) {
  const offline = useOfflineDownloads(
    { id: accountId, name: 'Fixture account' },
    undefined,
    () => null,
    { spaceRoot: root },
  );
  return (
    <>
      <button type="button" onClick={() => void offline.toggle(item, root.id).finally(onSettled)}>
        Prepare held copy
      </button>
      <p>Published copies: {offline.downloads.size}</p>
      {offline.message && <p role="alert">{offline.message.text}</p>}
    </>
  );
}

/** Exercise the real hook, IndexedDB opening and request lifetime with a held response. */
function DelayedDownload({ change }: { change: 'unmount' | 'account' | 'sign-out' }) {
  const [accountId, setAccountId] = useState(user.id);
  const [left, setLeft] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(false);
  const [finished, setFinished] = useState(false);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const previousFetch = globalThis.fetch;
    const previousAccount = preparedAccount();
    const previousWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const previousRuntime = currentRuntime();
    const manifest: ShellManifest = {
      protocol: 1,
      version: '0123456789abcdef',
      compatibility: { format: 1, sdkVersion: OFFLINE_SDK_VERSION },
      entry: '/assets/story-runtime.js',
      css: [],
      files: ['/assets/story-runtime.js'],
    };
    installRuntimeHost({
      manifest,
      compatibility: manifest.compatibility,
      switchTo: async () => {
        throw new Error('This fixture does not switch runtimes.');
      },
    });
    // Let a wrongly admitted download reach durable publication, so this
    // regression fails rather than passing because Storybook has no app worker.
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
    setPreparedAccount(null);
    const delayed: typeof fetch = async (input, init) => {
      if (input !== `/api/spaces/${root.id}/items/${item.id}/offline-bundle`)
        return previousFetch(input, init);
      setPendingRequest(true);
      await new Promise<void>((resolve) => {
        release.current = resolve;
      });
      return Response.json(bundle(item.id, item.name, root.id));
    };
    globalThis.fetch = delayed;
    return () => {
      release.current?.();
      if (globalThis.fetch === delayed) globalThis.fetch = previousFetch;
      if (previousWorker) Object.defineProperty(navigator, 'serviceWorker', previousWorker);
      else Reflect.deleteProperty(navigator, 'serviceWorker');
      if (previousRuntime) installRuntimeHost(previousRuntime);
      else delete window.__spinelRuntimeHost;
      setPreparedAccount(previousAccount);
    };
  }, []);
  return (
    <div className="sp-ui">
      {!left && (
        <DelayedDownloadControls accountId={accountId} onSettled={() => setFinished(true)} />
      )}
      <button
        type="button"
        disabled={!pendingRequest}
        onClick={() => {
          if (change === 'unmount') setLeft(true);
          else if (change === 'account') setAccountId(user.id + '-other');
          else setPreparedAccount(null); // App does this before awaiting the logout response.
        }}
      >
        Change account lifecycle
      </button>
      <button
        type="button"
        disabled={!pendingRequest}
        onClick={() => {
          release.current?.();
        }}
      >
        Complete held download
      </button>
      {finished && <p role="status">Held download completed</p>}
    </div>
  );
}

async function cancelDownload(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Prepare held copy' }));
  const change = await canvas.findByRole('button', { name: 'Change account lifecycle' });
  await waitFor(() => expect(change).toBeEnabled());
  await userEvent.click(change);
  await userEvent.click(canvas.getByRole('button', { name: 'Complete held download' }));
  await canvas.findByText('Held download completed');
  await expect(preparedAccount()).toBeNull();
  await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
  await expect(canvas.queryByText('Published copies: 1')).not.toBeInTheDocument();
}

export const UnmountDuringDownload: Story = {
  render: () => <DelayedDownload change="unmount" />,
  play: ({ canvasElement }) => cancelDownload(canvasElement),
};
export const ChangeAccountDuringDownload: Story = {
  render: () => <DelayedDownload change="account" />,
  play: ({ canvasElement }) => cancelDownload(canvasElement),
};
export const SignOutDuringDownload: Story = {
  render: () => <DelayedDownload change="sign-out" />,
  play: ({ canvasElement }) => cancelDownload(canvasElement),
};
