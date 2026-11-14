import type { Meta, StoryObj } from '@storybook/react-vite';
import { OfflineBadge, OfflineUnreachable } from './OfflineStatus.tsx';

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
