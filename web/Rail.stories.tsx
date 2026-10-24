import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within, userEvent } from 'storybook/test';
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
    <div className={`workspace${args.files ? ' files-workspace' : ''}`}>
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

export const Files: Story = {
  args: { files: { shared: false, open: fn() } },
  play: async ({ canvasElement }) => {
    if (window.innerWidth < 1024) return;
    const canvas = within(canvasElement);
    const rail = canvas.getByRole('banner').getBoundingClientRect();
    const appearance = canvas
      .getByRole('radiogroup', { name: 'Appearance' })
      .getBoundingClientRect();
    // The approved expanded rail centers appearance above the profile row.
    await expect(
      Math.abs((appearance.left + appearance.right - rail.left - rail.right) / 2),
    ).toBeLessThanOrEqual(1);
  },
};
export const FilesCollapsed: Story = {
  ...Files,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const collapse = canvas.queryByRole('button', { name: 'Collapse navigation' });
    if (!collapse) return;
    await userEvent.click(collapse);
    await expect(canvas.getByRole('button', { name: 'My files' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Shared with me' })).toBeVisible();
  },
};
export const FilesLongProfileName: Story = {
  ...Files,
  args: {
    ...Files.args,
    user: { isAdmin: false, name: 'Alex With A Very Long Display Name That Stays In The Sidebar' },
  },
  play: async ({ canvasElement, args }) => {
    const profile = within(canvasElement).getByRole('link', { name: 'Your profile' });
    await expect(profile).toHaveAttribute('title', `${args.user!.name} — Your profile`);
    if (window.innerWidth < 1024) return;
    const label = within(profile).getByText(args.user!.name!);
    await expect(getComputedStyle(label).textOverflow).toBe('ellipsis');
    await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
    await expect(profile.getBoundingClientRect().right).toBeLessThanOrEqual(224);
  },
};
export const FilesPhone: Story = {
  ...Files,
  ...Phone,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Appearance and profile remain direct actions even before the drawer opens.
    const profile = canvas.getByRole('link', { name: 'Your profile' });
    await expect(canvas.getAllByRole('link', { name: 'Your profile' })).toHaveLength(1);
    await expect(profile).toBeVisible();
    const controls = [
      profile,
      ...['Follow system', 'Light', 'Dark'].map((name) => canvas.getByRole('radio', { name })),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const bounds = control.getBoundingClientRect();
      await expect(bounds.left).toBeGreaterThanOrEqual(0);
      await expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
      if (window.innerWidth <= 640) {
        await expect(bounds.width).toBeGreaterThanOrEqual(44);
        await expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
    }
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
export const FilesDrawer: Story = {
  ...FilesPhone,
  play: async ({ canvasElement }) => {
    const browse = within(canvasElement).queryByRole('button', { name: 'Browse files' });
    if (!browse) return;
    await userEvent.click(browse);
    const modal = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Browse files' }),
    );
    await expect(modal.getByRole('button', { name: 'My files' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Shared with me' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Sign out' })).toBeVisible();
    for (const name of ['My files', 'Shared with me', 'Sign out']) {
      const control = modal.getByRole('button', { name });
      await expect(getComputedStyle(control).borderTopStyle).toBe('solid');
      await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await expect(modal.queryByRole('link', { name: 'Your profile' })).not.toBeInTheDocument();
    await expect(modal.queryByRole('radiogroup', { name: 'Appearance' })).not.toBeInTheDocument();
  },
};
