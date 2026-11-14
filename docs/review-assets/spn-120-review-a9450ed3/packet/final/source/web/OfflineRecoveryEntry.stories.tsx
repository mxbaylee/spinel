import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { OfflineBundle } from '../src/shared/offlineBundle.ts';
import { OfflineRecoveryEntry } from './OfflineRecoveryEntry.tsx';
import { OFFLINE_SDK_VERSION } from './offline/OfflineAccess.ts';
import { openOfflineStore, preparedAccount, setPreparedAccount } from './offline/offlineStore.ts';

const accountId = 'storybook-offline-recovery-entry';
const itemId = '11111111-1111-4111-8111-111111111154';
const privateTitle = 'Previously downloaded research notes';

/** Prepare only account markers and a clean fixture; none of these error states loads Univer. */
function DeviceFixture({
  account,
  clean,
  children,
}: {
  account: string | null;
  clean: boolean;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const previous = preparedAccount();
    let cancelled = false;
    setPreparedAccount(null);
    void (async () => {
      const store = await openOfflineStore(accountId);
      try {
        for (const download of await store.downloads()) await store.remove(download.itemId);
        if (clean) {
          const bundle: OfflineBundle = {
            version: 1,
            accountId,
            itemId,
            name: privateTitle,
            kind: 'doc',
            unitId: itemId,
            revision: 1,
            revisionOffset: 0,
            access: 'editor',
            readOnly: false,
            sdkVersion: OFFLINE_SDK_VERSION,
            images: [],
            snapshot: { id: itemId, body: { dataStream: '\r\n' }, documentStyle: {} },
          } as OfflineBundle;
          await store.saveDownload(bundle, new Map());
        }
      } finally {
        store.close();
      }
      if (cancelled) return;
      setPreparedAccount(account);
      setReady(true);
    })().catch((error) => {
      if (!cancelled)
        setProblem(error instanceof Error ? error.message : 'Could not prepare story data.');
    });
    return () => {
      cancelled = true;
      setPreparedAccount(previous);
    };
  }, [account, clean]);
  return problem ? (
    <p role="alert">{problem}</p>
  ) : ready ? (
    children
  ) : (
    <p role="status">Preparing story…</p>
  );
}

const meta = {
  id: 'offline-recovery-entry',
  title: 'Current production/Offline/Recovery entry',
  component: OfflineRecoveryEntry,
  args: {
    accountId,
    itemId,
    connection: 'online',
    navigation: { allow: fn(() => false), dirty: fn() },
  },
  parameters: {
    preparedAccount: accountId,
    clean: false,
    docs: {
      description: {
        component:
          'Production recovery-link errors use the real account marker and IndexedDB lookup. Native recovery rendering, image verification, and inaccessible-original reload are covered in Playwright.',
      },
    },
  },
  decorators: [
    (Story, context) => (
      <DeviceFixture
        account={context.parameters.preparedAccount as string | null}
        clean={Boolean(context.parameters.clean)}
      >
        <Story />
      </DeviceFixture>
    ),
  ],
} satisfies Meta<typeof OfflineRecoveryEntry>;
export default meta;
type Story = StoryObj<typeof meta>;

const checkError =
  (message: string): NonNullable<Story['play']> =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(message);
    await expect(canvas.getByRole('heading', { name: 'Offline changes' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'My files' })).toBeEnabled();
    await expect(canvas.queryByText(privateTitle)).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('region', { name: 'Document workspace' }),
    ).not.toBeInTheDocument();
    await expect(canvasElement.querySelector('.univer-container')).toBeNull();
  };

export const MissingDeviceCopy: Story = {
  play: checkError('There are no saved offline changes for this document on this device.'),
};
export const InvalidLink: Story = {
  args: { itemId: 'not-a-valid-item' },
  play: checkError('This recovery link is not valid.'),
};
export const NoPreparedAccount: Story = {
  parameters: { preparedAccount: null },
  play: checkError('This account has no prepared device copy here.'),
};
export const AnotherAccount: Story = {
  parameters: { preparedAccount: 'storybook-different-account', clean: true },
  play: checkError('This account has no prepared device copy here.'),
};
export const CleanDownloadedCopy: Story = {
  parameters: { clean: true },
  play: checkError('There are no saved offline changes for this document on this device.'),
};
export const GuardedReturnToMyFiles: Story = {
  play: async (context) => {
    await checkError('There are no saved offline changes for this document on this device.')(
      context,
    );
    const before = location.href;
    await userEvent.click(within(context.canvasElement).getByRole('button', { name: 'My files' }));
    await expect(context.args.navigation.allow).toHaveBeenCalledOnce();
    await expect(location.href).toBe(before);
  },
};
export const MissingCopyDark: Story = { ...MissingDeviceCopy, globals: { theme: 'dark' } };
export const InvalidLinkPhone: Story = {
  ...InvalidLink,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
