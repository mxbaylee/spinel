import type { Meta, StoryObj } from '@storybook/react-vite';
import { OfflineBadge, OfflineBanner } from './OfflineStatus.tsx';

const meta = {
  title: 'Dashboard/OfflineBadge',
  component: OfflineBadge,
} satisfies Meta<typeof OfflineBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A Sheet or Doc downloaded on this device with **Available offline on this device**. */
export const Available: Story = { args: { state: 'available' } };
/** Offline, a known item that isn't downloaded: it stays listed but can't open. */
export const NeedsConnection: Story = { args: { state: 'needs-connection' } };
/** Renders nothing: online, an item that isn't downloaded carries no badge. */
export const None: Story = { args: { state: null } };

/** Local mode's banner over the last-synced file list. */
export const Banner: StoryObj<typeof OfflineBanner> = {
  render: (args) => <OfflineBanner {...args} />,
  args: { syncedAt: Date.UTC(2026, 9, 19, 14, 5) },
};
