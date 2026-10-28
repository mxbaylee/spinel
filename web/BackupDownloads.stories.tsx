import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { BackupDownloads } from './BackupDownloads.tsx';
import type { BackupExportJob, BackupPolicy } from './BackupDownloads.tsx';

const now = Date.UTC(2026, 9, 27, 12);
const manualPolicy: BackupPolicy = {
  automatic: false,
  manualDownload: true,
  manualReady: true,
  manualUnavailable: null,
  backupHourUtc: 2,
  retention: { daily: 7, weekly: 4, monthly: 6 },
  maxArchiveBytes: 5 * 1024 * 1024 * 1024,
};
const job: BackupExportJob = {
  id: 'fixture-backup',
  state: 'ready',
  createdAt: now,
  expiresAt: now + 15 * 60_000,
  bytes: 12 * 1024 * 1024,
  keyId: 'workspace-2026-10',
  error: null,
};
const read = (state: BackupExportJob['state'] | null) => ({
  'GET /api/admin/backups/exports': { job: state ? { ...job, state } : null },
});
const meta = {
  id: 'admin-backupdownloads',
  title: 'Current production/Admin/BackupDownloads',
  component: BackupDownloads,
  args: { currentId: 'operator', policy: manualPolicy, hasDestination: false },
  decorators: [
    (Story) => (
      <div className="admin-health-card sp-ui" style={{ maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BackupDownloads>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ManualOnly: Story = {
  parameters: { api: read(null) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Prepare workspace backup' })).toBeEnabled(),
    );
    await expect(canvas.getByText(/recovery key is kept separately/)).toBeVisible();
    await expect(canvas.queryByText('Previously saved backups')).toBeNull();
  },
};
export const Preparing: Story = { parameters: { api: read('preparing') } };
export const Ready: Story = { parameters: { api: read('ready') } };
export const SendingToBrowser: Story = { parameters: { api: read('downloading') } };
export const Delivered: Story = {
  parameters: { api: read('delivered') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent(/Check that the download finished/),
    );
    await expect(canvas.getByText(/does not confirm an offsite copy/)).toBeVisible();
  },
};
export const Cancelled: Story = { parameters: { api: read('cancelled') } };
export const Expired: Story = { parameters: { api: read('expired') } };
export const Failed: Story = {
  parameters: {
    api: {
      'GET /api/admin/backups/exports': {
        job: { ...job, state: 'failed', error: '/private/recovery-key-file' },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      /could not be prepared or delivered/,
    );
    await expect(canvas.queryByText('/private/recovery-key-file')).toBeNull();
  },
};
export const DisabledByPolicy: Story = {
  args: { policy: { ...manualPolicy, manualDownload: false, manualReady: false } },
  parameters: { api: read(null) },
};
export const ReadyDownloadDisabled: Story = {
  args: { policy: { ...manualPolicy, manualDownload: false, manualReady: false } },
  parameters: { api: read('ready') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const download = await canvas.findByRole('button', { name: 'Download encrypted backup' });
    await waitFor(() => expect(canvas.queryByText('Loading download status…')).toBeNull());
    await expect(download).toBeDisabled();
    await expect(canvas.getByText(/turned off in the deployment configuration/)).toBeVisible();
  },
};
export const MissingRecoveryKey: Story = {
  args: { policy: { ...manualPolicy, manualReady: false, manualUnavailable: 'key_unavailable' } },
  parameters: { api: read(null) },
};
export const Loading: Story = {
  parameters: { api: { 'GET /api/admin/backups/exports': pending() } },
};
export const StatusUnavailable: Story = {
  parameters: { api: { 'GET /api/admin/backups/exports': failure('private details', 503) } },
};

async function openPrepare(canvasElement: HTMLElement) {
  const button = await within(canvasElement).findByRole('button', {
    name: 'Prepare workspace backup',
  });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  return within(
    await within(document.body).findByRole('dialog', { name: 'Prepare encrypted backup' }),
  );
}
export const FreshPasskeyRequired: Story = {
  parameters: { api: read(null) },
  play: async ({ canvasElement }) => {
    const dialog = await openPrepare(canvasElement);
    await expect(dialog.getByText(/separate recovery key to restore it/)).toBeVisible();
  },
};
export const WaitingForPasskey: Story = {
  parameters: {
    api: { ...read(null), 'POST /api/auth/reauthentication/options': pending() },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openPrepare(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify and prepare backup' }));
    await waitFor(() =>
      expect(dialog.getByRole('status')).toHaveTextContent('Waiting for your passkey'),
    );
    await expect(dialog.getByRole('button', { name: /^Cancel$/ })).toBeEnabled();
  },
};
export const CancelPasskey: Story = {
  parameters: {
    api: { ...read(null), 'POST /api/auth/reauthentication/options': pending() },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openPrepare(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify and prepare backup' }));
    await waitFor(() =>
      expect(dialog.getByRole('status')).toHaveTextContent('Waiting for your passkey'),
    );
    await userEvent.click(dialog.getByRole('button', { name: /^Cancel$/ }));
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull();
      expect(
        within(canvasElement).getByRole('button', { name: 'Prepare workspace backup' }),
      ).toHaveFocus();
    });
  },
};
export const VerificationFailed: Story = {
  parameters: {
    api: {
      ...read(null),
      'POST /api/auth/reauthentication/options': failure('private detail', 500),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openPrepare(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify and prepare backup' }));
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      /backup request could not be confirmed/,
    );
    await expect(dialog.queryByText('private detail')).toBeNull();
  },
};
export const JobContended: Story = {
  args: {
    authenticate: fn(async () => ({
      id: 'operator-key',
      rawId: 'operator-key',
      type: 'public-key' as const,
      response: { authenticatorData: 'fixture', clientDataJSON: 'fixture', signature: 'fixture' },
      clientExtensionResults: {},
    })),
  },
  parameters: {
    api: {
      ...read(null),
      'POST /api/auth/reauthentication/options': {
        options: { challenge: 'fixture' },
        challengeId: 'fixture',
      },
      'POST /api/auth/reauthentication/verify': { verifiedUntil: 4102444800000 },
      'POST /api/auth/cancel': {},
      'POST /api/admin/backups/exports': failure('Other operator private job', 409),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openPrepare(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify and prepare backup' }));
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      /active recovery job to finish/,
    );
    await expect(dialog.queryByText('Other operator private job')).toBeNull();
  },
};
export const SavedBackups: Story = {
  args: { hasDestination: true },
  parameters: {
    api: {
      ...read(null),
      'GET /api/admin/backups/catalog': {
        entries: [
          { id: 'opaque-point-one', createdAt: now },
          { id: 'opaque-point-two', createdAt: now - 86400_000 },
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Previously saved backups'));
    await expect(await canvas.findByLabelText('Saved backup')).toBeVisible();
    await expect(canvas.queryByText('opaque-point-one')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Prepare selected backup' })).toBeDisabled();
  },
};
export const SavedBackupsEmpty: Story = {
  args: { hasDestination: true },
  parameters: { api: { ...read(null), 'GET /api/admin/backups/catalog': { entries: [] } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText('Previously saved backups'));
  },
};
export const SavedBackupsLoading: Story = {
  args: { hasDestination: true },
  parameters: { api: { ...read(null), 'GET /api/admin/backups/catalog': pending() } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText('Previously saved backups'));
  },
};
export const SavedBackupsFailed: Story = {
  args: { hasDestination: true },
  parameters: { api: { ...read(null), 'GET /api/admin/backups/catalog': failure('private', 503) } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText('Previously saved backups'));
  },
};
