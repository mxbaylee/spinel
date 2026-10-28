import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { MaintenancePublicStatus } from '../src/shared/maintenance.ts';
import { MaintenanceBanner } from './Maintenance.tsx';

const running: MaintenancePublicStatus = {
  available: true,
  phase: 'running',
  epoch: 'fixture-epoch',
  notice: null,
};
const scheduled: MaintenancePublicStatus = {
  ...running,
  notice: {
    id: 'fixture-notice',
    startsAt: Date.UTC(2030, 10, 3, 9, 30),
    timeZone: 'America/Los_Angeles',
    durationMinutes: 30,
    state: 'scheduled',
  },
};
const meta = {
  id: 'maintenance-banner',
  title: 'Current production/Shell/Maintenance status',
  component: MaintenanceBanner,
  parameters: { shell: 'none' },
  args: { status: scheduled },
} satisfies Meta<typeof MaintenanceBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Scheduled: Story = {};
export const Paused: Story = { args: { status: { ...running, phase: 'paused' } } };
export const Draining: Story = { args: { status: { ...scheduled, phase: 'draining' } } };
export const Reconnecting: Story = {
  args: { status: { ...running, phase: 'paused' }, reachable: false },
};
export const GuestPaused: Story = {
  args: { status: { ...running, phase: 'paused' }, guest: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Details'));
    await expect(canvas.getByText(/Already acknowledged edits remain saved/)).toBeVisible();
    await expect(canvas.queryByText(/Devices without a connection/)).toBeNull();
    await expect(canvas.queryByRole('link')).toBeNull();
  },
};
export const NoticeDetails: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Details'));
    await expect(canvas.getByText(/America\/Los_Angeles/)).toBeVisible();
    await expect(canvas.getByText(/does not pause edits automatically/)).toBeVisible();
  },
};
export const Cancelled: Story = {
  args: { status: { ...scheduled, notice: { ...scheduled.notice!, state: 'cancelled' } } },
};
export const Running: Story = { args: { status: running } };
export const Unavailable: Story = { args: { status: { ...running, available: false } } };
