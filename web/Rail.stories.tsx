import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { Rail } from './Rail.tsx';

const meta = {
  id: 'shell-rail',
  title: 'Current production/Shell/Rail',
  component: Rail,
  // theme.css styles the rail only as the direct <header> of .workspace, so render
  // it there instead of inside the default <main> shell.
  parameters: { shell: 'none' },
  // The guard declines, as it would with unsaved changes, so clicking a link
  // leaves the canvas where it is instead of loading the app's routes.
  args: {
    user: { isAdmin: false, name: 'Alex Baylee', icon: 'lucide:flower', color: 'info-strong' },
    navigation: { allow: () => false },
    onSignOut: fn(),
    connection: 'online',
  },
  render: (args) => (
    <div className="workspace">
      <Rail {...args} />
    </div>
  ),
} satisfies Meta<typeof Rail>;
export default meta;
type Story = StoryObj<typeof meta>;

/** An everyday account: Dashboard, appearance, profile and Sign out. Hover or focus a button for its label. */
export const Member: Story = {};
/** The admin account's first link goes to Admin instead of the dashboard. */
export const Admin: Story = { args: { user: { isAdmin: true } } };
/** A lost connection changes only the fixed icon beside the gem. */
export const Offline: Story = { args: { connection: 'offline' } };
/** Recovery waits for a verified connection without changing the navigation geometry. */
export const Reconnecting: Story = { args: { connection: 'reconnecting' } };
/** Below 640px the rail becomes a bar across the top, and labels drop below their buttons. */
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
/** Before signing in only the gem shows; there is no workspace navigation. */
export const SignedOut: Story = {
  args: { user: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole('status', { name: 'Connection status' }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument();
  },
};

export const Compact: Story = { args: { compact: true } };
