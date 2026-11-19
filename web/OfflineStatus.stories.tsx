import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import type { OfflineDownload } from './offline/offlineStore.ts';
import { OfflineBadge, OfflineSyncNotice, OfflineUnreachable } from './OfflineStatus.tsx';

const meta = {
  id: 'dashboard-offlinebadge',
  title: 'Current production/Dashboard/OfflineBadge',
  component: OfflineBadge,
} satisfies Meta<typeof OfflineBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A Sheet or Doc downloaded on this device with **Available offline on this device**. */
export const Available: Story = { args: { state: 'available' } };
/** A Space opens only the individual pages prepared on this device. */
export const PagesAvailable: Story = { args: { state: 'pages-available' } };
/** Offline, a known item that isn't downloaded: it stays listed but can't open. */
export const NeedsConnection: Story = { args: { state: 'needs-connection' } };
/** New documents are not uploaded, even when their blank device copy has no edits. */
export const NotSynced: Story = { args: { state: 'not-synced' } };
/** Recovery choices belong to this file's menu, not the connection indicator. */
export const NeedsAttention: Story = { args: { state: 'needs-attention' } };
/** Renders nothing: online, an item that isn't downloaded carries no badge. */
export const None: Story = { args: { state: null } };

/** Offline with no local data for this account: a signed-out or unprepared device. */
export const Unreachable: StoryObj<typeof OfflineUnreachable> = {
  render: () => <OfflineUnreachable />,
};

const pendingFile = (value: number): OfflineDownload => ({
  itemId: `0000000${value}-0000-4000-8000-000000000163`,
  name: `Pending file ${value}`,
  kind: 'doc',
  pending: true,
  readOnly: false,
  revision: 1,
  downloadedAt: Date.UTC(2026, 10, 18, 14, 5),
});
const noticeMeta = (
  downloads: OfflineDownload[],
  text: RegExp,
): StoryObj<typeof OfflineSyncNotice> => ({
  render: () => <OfflineSyncNotice downloads={downloads} />,
  play: async ({ canvasElement }) => {
    const notice = within(canvasElement).getByRole('status');
    await expect(notice).toHaveTextContent(text);
    await expect(notice).toHaveTextContent('Nothing to do');
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument();
    await expect(within(canvasElement).queryByRole('link')).not.toBeInTheDocument();
  },
});
/** One file with ordinary saved edits: informational, no action. */
export const SyncNoticeOne: StoryObj<typeof OfflineSyncNotice> = noticeMeta(
  [pendingFile(1)],
  /1 file has changes/,
);
/** Several files; retained and creation work is not counted here. */
export const SyncNoticeMany: StoryObj<typeof OfflineSyncNotice> = {
  ...noticeMeta(
    [
      pendingFile(1),
      pendingFile(2),
      { ...pendingFile(3), retained: true },
      { ...pendingFile(4), creation: { parentId: null, createdAt: 0 } },
    ],
    /2 files have changes/,
  ),
};
export const SyncNoticeDark: StoryObj<typeof OfflineSyncNotice> = {
  ...SyncNoticeOne,
  globals: { theme: 'dark' },
};
export const SyncNoticePhone: StoryObj<typeof OfflineSyncNotice> = {
  ...SyncNoticeMany,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
/** Renders nothing once delivery is acknowledged (pending false) or work is retained. */
export const SyncNoticeCleared: StoryObj<typeof OfflineSyncNotice> = {
  render: () => (
    <OfflineSyncNotice
      downloads={[
        { ...pendingFile(1), pending: false },
        { ...pendingFile(2), retained: true },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('status')).not.toBeInTheDocument();
  },
};
