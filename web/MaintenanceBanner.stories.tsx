import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { MaintenancePublicStatus } from '../src/shared/maintenance.ts';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { MaintenanceBanner } from './Maintenance.tsx';
import {
  maintenanceBannerKey,
  maintenanceDismissals,
  maintenanceDismissalLifetime,
} from './maintenanceDismissal.ts';

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
const paused: MaintenancePublicStatus = { ...running, phase: 'paused' };
const meta = {
  id: 'maintenance-banner',
  title: 'Current production/Shell/Maintenance status',
  component: MaintenanceBanner,
  parameters: { shell: 'none' },
  args: { status: scheduled },
  beforeEach: () => {
    maintenanceDismissals.clear();
    return () => maintenanceDismissals.clear();
  },
} satisfies Meta<typeof MaintenanceBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Scheduled: Story = {};
export const Paused: Story = { args: { status: paused } };
export const Draining: Story = { args: { status: { ...scheduled, phase: 'draining' } } };
export const Reconnecting: Story = {
  args: { status: paused, reachable: false },
};
export const GuestPaused: Story = {
  args: { status: paused, guest: true },
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

export const PausedDismissed: Story = {
  args: { status: paused },
  beforeEach: () => {
    maintenanceDismissals.dismiss(maintenanceBannerKey(paused)!);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Edits paused')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Dismiss for now' })).toBeNull();
    await expect(canvas.getByText(/Already acknowledged edits remain saved/)).not.toBeVisible();
  },
};
export const GuestPausedDismissed: Story = {
  ...PausedDismissed,
  args: { status: paused, guest: true },
};
export const ReconnectingDismissed: Story = {
  args: { status: paused, reachable: false },
  beforeEach: PausedDismissed.beforeEach,
};
export const DismissAndReopen: Story = {
  args: { status: paused },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss for now' }));
    await expect(canvas.getByText('Edits paused')).toBeVisible();
    await expect(canvas.getByText('Details').closest('summary')).toHaveFocus();
    await expect(canvas.getByText(/Already acknowledged edits remain saved/)).not.toBeVisible();
    // Synthetic Enter does not perform the browser's native <summary> activation.
    // Real Enter/Space coverage lives in e2e/maintenance-banner.spec.ts.
    await userEvent.click(canvas.getByText('Details'));
    await expect(canvas.getByText(/Already acknowledged edits remain saved/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Dismiss for now' })).toBeVisible();
  },
};
export const ExpiredDismissal: Story = {
  beforeEach: () => {
    maintenanceDismissals.dismiss(
      maintenanceBannerKey(scheduled)!,
      Date.now() - maintenanceDismissalLifetime,
    );
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Maintenance scheduled')).toBeVisible();
  },
};

/** Only these buttons are fixture controls; the banner is the production component. */
function DismissalJourney() {
  const [status, setStatus] = useState(scheduled);
  const [mount, setMount] = useState(0);
  return (
    <div>
      <MaintenanceBanner key={mount} status={status} />
      <Button onClick={() => setStatus(structuredClone(status))}>Poll unchanged status</Button>
      <Button onClick={() => setMount((value) => value + 1)}>Remount banner</Button>
      <Button onClick={() => setStatus({ ...status, phase: 'paused' })}>Start maintenance</Button>
      <Button
        onClick={() => setStatus({ ...status, notice: { ...status.notice!, id: 'replacement' } })}
      >
        Replace notice
      </Button>
    </div>
  );
}
export const NewPauseResurfaces: Story = {
  render: () => <DismissalJourney />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss for now' }));
    await expect(canvas.queryByRole('region', { name: 'Workspace maintenance' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Poll unchanged status' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Remount banner' }));
    await expect(canvas.queryByRole('region', { name: 'Workspace maintenance' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Start maintenance' }));
    await expect(canvas.getByText('Edits paused')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Dismiss for now' })).toBeVisible();
  },
};
export const ReplacementResurfaces: Story = {
  render: () => <DismissalJourney />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss for now' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Replace notice' }));
    await expect(canvas.getByText('Maintenance scheduled')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Dismiss for now' })).toBeVisible();
  },
};
