import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { BackupStatus } from './BackupStatus.tsx';
import type { BackupStatusResponse } from './BackupStatus.tsx';

const hour = 3_600_000;
const now = Date.UTC(2026, 9, 27, 12);
const status: BackupStatusResponse = {
  configured: true,
  destination: 'spaces',
  offsite: true,
  keyId: 'workspace-2026-10',
  lastGood: now - 5 * hour,
  lastAttempt: now - 5 * hour,
  error: null,
  running: false,
  overdue: false,
  verification: {
    lastGood: now - 24 * hour,
    lastAttempt: now - 24 * hour,
    error: null,
    running: false,
    overdue: false,
    keyId: 'workspace-2026-10',
  },
};
const reply = (overrides: Partial<BackupStatusResponse>) => ({
  'GET /api/admin/backups': { ...status, ...overrides },
});

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  id: 'admin-backupstatus',
  title: 'Current production/Admin/BackupStatus',
  component: BackupStatus,
} satisfies Meta<typeof BackupStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  parameters: { api: reply({}) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('OK')).toBeVisible();
    const verification = within(canvas.getByRole('region', { name: 'Restore verification' }));
    await expect(verification.getByText('Verified', { exact: true })).toBeVisible();
    await expect(verification.getByText(/Last successful restore check:/)).not.toHaveTextContent(
      'None yet',
    );
  },
};
export const LocalBackup: Story = {
  parameters: { api: reply({ destination: 'filesystem', offsite: false }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Local backup saved')).toBeVisible();
    await expect(canvas.getByRole('alert')).toHaveTextContent('independent offsite copy');
    await expect(canvas.queryByText('OK', { exact: true })).not.toBeInTheDocument();
    await expect(canvas.getByText('Verified', { exact: true })).toBeVisible();
  },
};
export const Running: Story = {
  parameters: { api: reply({ running: true, lastAttempt: now - 1 * hour }) },
};
/** No backup has ever succeeded, and offsite backups are configured, so one is overdue. */
export const NeverRun: Story = {
  parameters: {
    api: reply({
      lastGood: null,
      lastAttempt: null,
      offsite: false,
      overdue: true,
      verification: { ...status.verification, lastGood: null, lastAttempt: null, keyId: null },
    }),
  },
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
  parameters: {
    api: reply({
      configured: false,
      destination: null,
      offsite: false,
      keyId: null,
      lastGood: null,
      lastAttempt: null,
      verification: { ...status.verification, lastGood: null, lastAttempt: null, keyId: null },
    }),
  },
};
export const ConfigurationFailed: Story = {
  parameters: {
    api: reply({
      destination: null,
      offsite: false,
      keyId: null,
      error: 'Backup configuration could not be loaded. Check the private configuration and retry.',
    }),
  },
};
export const VerificationRunning: Story = {
  parameters: {
    api: reply({ verification: { ...status.verification, running: true, lastAttempt: now } }),
  },
};
export const VerificationNeverRun: Story = {
  parameters: {
    api: reply({
      verification: { ...status.verification, lastGood: null, lastAttempt: null, keyId: null },
    }),
  },
};
export const VerificationOverdue: Story = {
  parameters: {
    api: reply({
      verification: { ...status.verification, lastGood: now - 9 * 24 * hour, overdue: true },
    }),
  },
};
export const VerificationFailed: Story = {
  parameters: {
    api: reply({
      verification: {
        ...status.verification,
        lastAttempt: now,
        error: 'Restore verification failed. Keep the backup and check the recovery guide.',
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const panel = within(
      await within(canvasElement).findByRole('region', { name: 'Restore verification' }),
    );
    await expect(panel.getByRole('alert')).toHaveTextContent('Restore verification failed');
    await expect(panel.getByText(/Last successful restore check:/)).not.toHaveTextContent(
      'None yet',
    );
    await expect(panel.getByText('Failed', { exact: true })).toBeVisible();
    await expect(panel.queryByText('Verified', { exact: true })).not.toBeInTheDocument();
  },
};
export const LocalVerificationFailed: Story = {
  parameters: {
    api: reply({
      destination: 'filesystem',
      offsite: false,
      verification: {
        ...status.verification,
        lastAttempt: now,
        error: 'Restore verification failed. Keep the backup and check the recovery guide.',
      },
    }),
  },
};
export const RetainedKeyVerified: Story = {
  parameters: {
    api: reply({
      keyId: 'workspace-2026-11',
      verification: { ...status.verification, keyId: 'workspace-2026-10' },
    }),
  },
};
export const Loading: Story = { parameters: { api: { 'GET /api/admin/backups': pending() } } };
export const LoadFailed: Story = {
  parameters: { api: { 'GET /api/admin/backups': failure('Backups are unavailable.', 500) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Could not load backup status',
    );
    await expect(canvas.queryByText('Backups are unavailable.')).not.toBeInTheDocument();
  },
};

const manualPolicy = {
  automatic: false,
  manualDownload: true,
  manualReady: true,
  manualUnavailable: null,
  backupHourUtc: 2,
  retention: { daily: 7, weekly: 4, monthly: 6 },
  maxArchiveBytes: 5 * 1024 * 1024 * 1024,
};
export const ManualDownloads: Story = {
  args: { currentId: 'operator' },
  parameters: {
    api: {
      ...reply({
        destination: null,
        offsite: false,
        lastGood: null,
        lastAttempt: null,
        policy: manualPolicy,
        verification: { ...status.verification, lastGood: null, lastAttempt: null },
      }),
      'GET /api/admin/backups/exports': { job: null },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Automatic backups off')).toBeVisible();
    await expect(canvas.getByText('Destination: Manual downloads only')).toBeVisible();
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Prepare workspace backup' })).toBeEnabled(),
    );
    await expect(canvas.queryByText('OK', { exact: true })).toBeNull();
  },
};
export const SpacesPolicy: Story = {
  args: { currentId: 'operator' },
  parameters: {
    api: {
      ...reply({ destination: 'spaces', policy: { ...manualPolicy, automatic: true } }),
      'GET /api/admin/backups/exports': { job: null },
    },
  },
};
export const DownloadReady: Story = {
  args: { currentId: 'operator' },
  parameters: {
    api: {
      ...reply({
        destination: 'filesystem',
        offsite: false,
        policy: { ...manualPolicy, automatic: true },
      }),
      'GET /api/admin/backups/exports': {
        job: {
          id: 'fixture-backup',
          state: 'ready',
          createdAt: now,
          expiresAt: now + 900_000,
          bytes: 12 * 1024 * 1024,
          keyId: 'workspace-2026-10',
          error: null,
        },
      },
    },
  },
};
