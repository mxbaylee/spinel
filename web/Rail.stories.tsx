import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Rail } from './Rail.tsx';

const meta = {
  title: 'Shell/Rail',
  component: Rail,
  // theme.css styles the rail only as the direct <header> of .workspace, so render
  // it there instead of inside the default <main> shell.
  parameters: { shell: 'none' },
  // The guard declines, as it would with unsaved changes, so clicking a link
  // leaves the canvas where it is instead of loading the app's routes.
  args: { user: { isAdmin: false }, navigation: { allow: () => false }, onSignOut: fn() },
  render: (args) => (
    <div className="workspace">
      <Rail {...args} />
    </div>
  ),
} satisfies Meta<typeof Rail>;
export default meta;
type Story = StoryObj<typeof meta>;

/** An everyday account: Dashboard, Settings and Sign out. Hover or focus a button for its label. */
export const Member: Story = {};
/** The admin account's first link goes to Admin instead of the dashboard. */
export const Admin: Story = { args: { user: { isAdmin: true } } };
/** Below 640px the rail becomes a bar across the top, and labels drop below their buttons. */
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
/** Before signing in only the gem shows; there is no workspace navigation. */
export const SignedOut: Story = { args: { user: null } };
