import type { Meta, StoryObj } from '@storybook/react-vite';
import { failure, pending } from '../.storybook/api.ts';
import { BackupStatus } from './BackupStatus.tsx';

const hour = 3_600_000;
const now = Date.now();
type Status = {
  configured: boolean;
  lastGood: number | null;
  lastAttempt: number | null;
  error: string | null;
  running: boolean;
  overdue: boolean;
};
const status: Status = {
  configured: true,
  lastGood: now - 5 * hour,
  lastAttempt: now - 5 * hour,
  error: null,
  running: false,
  overdue: false,
};
const reply = (overrides: Partial<Status>) => ({
  'GET /api/admin/backups': { ...status, ...overrides },
});

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  title: 'Admin/BackupStatus',
  component: BackupStatus,
} satisfies Meta<typeof BackupStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = { parameters: { api: reply({}) } };
export const Running: Story = {
  parameters: { api: reply({ running: true, lastAttempt: now - 1 * hour }) },
};
/** No backup has ever succeeded, and offsite backups are configured, so one is overdue. */
export const NeverRun: Story = {
  parameters: { api: reply({ lastGood: null, lastAttempt: null, overdue: true }) },
};
export const Overdue: Story = {
  parameters: {
    api: reply({ lastGood: now - 40 * hour, lastAttempt: now - 2 * hour, overdue: true }),
  },
};
export const Failed: Story = {
  parameters: {
    api: reply({
      lastGood: now - 40 * hour,
      lastAttempt: now - 2 * hour,
      overdue: true,
      error:
        'Backup or retention failed. Check the private backup configuration, storage access and free disk space, then retry.',
    }),
  },
};
export const NotConfigured: Story = {
  parameters: { api: reply({ configured: false, lastGood: null, lastAttempt: null }) },
};
export const Loading: Story = { parameters: { api: { 'GET /api/admin/backups': pending() } } };
export const LoadFailed: Story = {
  parameters: { api: { 'GET /api/admin/backups': failure('Backups are unavailable.', 500) } },
};
