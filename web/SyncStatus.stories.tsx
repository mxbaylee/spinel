import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { SyncStatus } from './SyncStatus.tsx';

const meta = {
  id: 'dashboard-syncstatus',
  title: 'Current production/Dashboard/SyncStatus',
  component: SyncStatus,
  args: { onTryNow: fn(), allowNavigation: fn(() => true) },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SyncStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

const dark = { theme: 'dark' };
const phone = { viewport: { value: 'phone', isRotated: false } };
const recover = [
  { itemId: '11111111-1111-4111-8111-111111111111', name: 'Team roadmap' },
  { itemId: '22222222-2222-4222-8222-222222222222', name: 'Quarterly budget' },
];

/** Saved edits and no connection: one status, and one action to recheck. */
export const Waiting: Story = {
  args: { queued: { phase: 'waiting', count: 1 } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('Waiting to sync');
    await userEvent.click(canvas.getByRole('button', { name: 'Try now' }));
    await expect(args.onTryNow).toHaveBeenCalledTimes(1);
  },
};
export const WaitingMany: Story = { args: { queued: { phase: 'waiting', count: 3 } } };
/** The check is running; the button can't be pressed twice. */
export const WaitingChecking: Story = {
  args: { queued: { phase: 'waiting', count: 2 }, checking: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Checking…' })).toBeDisabled();
  },
};
export const WaitingDark: Story = { ...Waiting, globals: dark };
export const WaitingPhone: Story = { ...Waiting, globals: phone };

/** Online and sending. No action: it finishes by itself. */
export const Syncing: Story = {
  args: { queued: { phase: 'syncing', count: 2 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('Syncing now');
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};
export const SyncingDark: Story = { ...Syncing, globals: dark };
export const SyncingPhone: Story = { ...Syncing, globals: phone };

/** Work that needs a choice, with its action beside the status. One banner. */
export const Attention: Story = {
  args: { recover: recover.slice(0, 1) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Needs attention');
    await expect(canvas.getByRole('link', { name: 'Recover Team roadmap' })).toBeVisible();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};
/** Needing a choice beside files that are still waiting: both lines, all actions in one row. */
export const AttentionAndWaiting: Story = {
  args: { recover, queued: { phase: 'waiting', count: 2 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Needs attention');
    await expect(canvas.getByRole('alert')).toHaveTextContent('Waiting to sync');
    await expect(canvas.getAllByRole('link', { name: /^Recover / })).toHaveLength(2);
    await expect(canvas.getByRole('button', { name: 'Try now' })).toBeVisible();
  },
};
/** Needing a choice beside files that are being sent: no Try now, nothing else to do. */
export const AttentionAndSyncing: Story = {
  args: { recover: recover.slice(0, 1), queued: { phase: 'syncing', count: 1 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Syncing now');
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};
export const AttentionDark: Story = { ...AttentionAndWaiting, globals: dark };
export const AttentionPhone: Story = { ...AttentionAndWaiting, globals: phone };

/** The guard can keep unsaved work in view: a refused Recover click goes nowhere. */
export const NavigationGuard: Story = {
  args: { recover, allowNavigation: fn(() => false) },
  play: async ({ canvasElement, args }) => {
    const before = location.href;
    await userEvent.click(
      within(canvasElement).getByRole('link', { name: 'Recover Quarterly budget' }),
    );
    await expect(args.allowNavigation).toHaveBeenCalledOnce();
    await expect(location.href).toBe(before);
  },
};
/** A long file name wraps inside its button; targets stay 44 px and nothing scrolls sideways. */
export const LongNamePhone: Story = {
  globals: phone,
  args: {
    recover: [
      {
        itemId: '33333333-3333-4333-8333-333333333333',
        name: 'Workshop planning — travel, accessibility, accommodation and shared research notes for the October gathering',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: /^Recover Workshop planning/ });
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    );
  },
};

/** Nothing saved on this device: no banner and no reserved space. */
export const Nothing: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('status')).not.toBeInTheDocument();
  },
};
