import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import type { ApiMock } from '../.storybook/api.ts';
import { RESTORE_CONSEQUENCES, RESTORE_RESOURCE_MESSAGES } from '../src/shared/restore.ts';
import type { RestoreOutcome, RestorePreparation } from '../src/shared/restore.ts';
import { BackupRestore } from './BackupRestore.tsx';
import { refreshMaintenanceStatus } from './maintenanceState.ts';

const now = Date.UTC(2026, 9, 29, 12);
const job: RestorePreparation = {
  id: 'b1111111-1111-4111-8111-111111111111',
  state: 'ready',
  source: 'upload',
  createdAt: now,
  expiresAt: now + 30 * 60_000,
  bytes: 12 * 1024 * 1024,
  sourceCreatedAt: new Date(now - 86400_000).toISOString(),
  sourceSha256: 'a'.repeat(64),
  target: {
    generationId: 'b2222222-2222-4222-8222-222222222222',
    epoch: 'b3333333-3333-4333-8333-333333333333',
  },
  preview: {
    provisional: true,
    currentAccounts: 2,
    currentPasskeys: 3,
    sharingRemoved: 4,
    sharingDowngraded: 2,
    isolatedItems: 7,
    isolatedGroups: 2,
    detachedRoots: 3,
    heldTrashBatches: 1,
  },
  verification: {
    applicationCompatible: true,
    sourceCompatible: true,
    databaseVerified: true,
    tables: 33,
    rows: 200,
    snapshots: 14,
    images: 6,
  },
  resources: {
    provisional: true,
    checkedAt: now,
    requiredAdditionalBytes: 768 * 1024 ** 2,
    availableBytes: 4 * 1024 ** 3,
    sufficient: true,
    filesystems: [
      {
        purposes: ['application', 'preparation', 'recovery'],
        requiredAdditionalBytes: 768 * 1024 ** 2,
        availableBytes: 4 * 1024 ** 3,
        sufficient: true,
      },
    ],
  },
  confirmation: 'b'.repeat(64),
  consequencesVersion: 1,
  error: null,
};
const read = (state: RestorePreparation['state'] | null) => ({
  'GET /api/admin/restores': {
    available: true,
    job: state ? { ...job, state } : null,
    outcome: null,
    pending: false,
  },
});
const verified = {
  'POST /api/auth/reauthentication/options': {
    options: { challenge: 'fixture' },
    challengeId: 'fixture',
  },
  'POST /api/auth/reauthentication/verify': { verifiedUntil: 4102444800000 },
  'POST /api/auth/cancel': {},
};
const authenticate = fn(async () => ({
  id: 'operator-key',
  rawId: 'operator-key',
  type: 'public-key' as const,
  response: { authenticatorData: 'fixture', clientDataJSON: 'fixture', signature: 'fixture' },
  clientExtensionResults: {},
}));
const meta = {
  id: 'admin-backuprestore',
  title: 'Current production/Admin/BackupRestore',
  component: BackupRestore,
  args: { currentId: 'operator' },
  decorators: [
    (Story) => (
      <div className="sp-ui" style={{ maxWidth: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BackupRestore>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {
  parameters: { api: read(null) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Prepare restore' })).toBeEnabled(),
    );
    await expect(canvas.getByText(/Document contents stay private/)).toBeVisible();
  },
};
export const Unavailable: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': { available: false, job: null, outcome: null, pending: null },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Supervised restore is unavailable/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Prepare restore' })).toBeDisabled();
  },
};
export const Loading: Story = { parameters: { api: { 'GET /api/admin/restores': pending() } } };
export const StatusFailed: Story = {
  parameters: { api: { 'GET /api/admin/restores': failure('/private/host/key', 503) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toBeVisible();
    await expect(canvas.queryByText('/private/host/key')).toBeNull();
  },
};
export const SessionUnavailable: Story = {
  parameters: { api: { 'GET /api/admin/restores': failure('private session details', 401) } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      /Sign in again/,
    );
  },
};
export const Uploading: Story = { parameters: { api: read('uploading') } };
export const Preparing: Story = { parameters: { api: read('preparing') } };
export const MaintenanceDraining: Story = {
  parameters: {
    api: {
      ...read('ready'),
      'GET /api/maintenance': {
        available: true,
        phase: 'running',
        epoch: 'restore-fixture',
        notice: null,
      },
    },
  },
  play: async ({ canvasElement, parameters }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Review restore' })).toBeEnabled(),
    );
    (parameters.api as ApiMock)['GET /api/maintenance'] = {
      available: true,
      phase: 'draining',
      epoch: 'restore-fixture',
      notice: null,
    };
    await refreshMaintenanceStatus();
    await expect(await canvas.findByText(/workspace is in maintenance/)).toBeVisible();
    for (const name of ['Review restore', 'Cancel preparation', 'Refresh restore status']) {
      await expect(canvas.getByRole('button', { name })).toBeDisabled();
    }
    await expect(canvas.getByRole('link', { name: 'Open recovery guide' })).toBeVisible();
    await expect(canvas.queryByText('Restore complete')).toBeNull();
  },
};
export const Ready: Story = {
  parameters: { api: read('ready') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Provisional access changes')).toBeVisible();
    await expect(canvas.getByText(job.sourceSha256!)).toBeVisible();
    await expect(canvas.getByText(/This workspace at/)).toBeVisible();
    await expect(canvas.getByText('Verified backup')).toBeVisible();
    await expect(canvas.getByText(/^Tables:/)).toHaveTextContent(
      'Tables: 33 · Rows: 200 · Snapshots: 14 · Images: 6',
    );
    await expect(canvas.getByText('Estimated disk space')).toBeVisible();
    await expect(canvas.queryByText(job.target.generationId)).toBeNull();
  },
};
export const SeparateRecoveryVolume: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': {
        available: true,
        outcome: null,
        pending: false,
        job: {
          ...job,
          resources: {
            ...job.resources!,
            requiredAdditionalBytes: 1024 ** 3,
            availableBytes: 4 * 1024 ** 3,
            filesystems: [
              {
                purposes: ['application', 'preparation'],
                requiredAdditionalBytes: 512 * 1024 ** 2,
                availableBytes: 2 * 1024 ** 3,
                sufficient: true,
              },
              {
                purposes: ['recovery'],
                requiredAdditionalBytes: 512 * 1024 ** 2,
                availableBytes: 2 * 1024 ** 3,
                sufficient: true,
              },
            ],
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Recovery volume')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Review restore' })).toBeEnabled();
  },
};
export const InsufficientDiskSpace: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': {
        available: true,
        outcome: null,
        pending: false,
        job: {
          ...job,
          state: 'failed',
          confirmation: null,
          error: RESTORE_RESOURCE_MESSAGES['disk-space'],
          resources: {
            ...job.resources!,
            availableBytes: 256 * 1024 ** 2,
            sufficient: false,
            filesystems: [
              {
                ...job.resources!.filesystems[0],
                availableBytes: 256 * 1024 ** 2,
                sufficient: false,
              },
            ],
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Editing has not been paused/)).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Review restore' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Prepare restore' })).toBeEnabled();
  },
};
export const MemoryHeadroomRefusal: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': {
        available: true,
        outcome: null,
        pending: false,
        job: {
          ...job,
          state: 'failed',
          confirmation: null,
          resources: null,
          error: RESTORE_RESOURCE_MESSAGES['memory-headroom'],
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(RESTORE_RESOURCE_MESSAGES['memory-headroom']),
    ).toBeVisible();
  },
};
export const ConfirmedDiskShortage: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': {
        available: true,
        outcome: null,
        pending: true,
        job: {
          ...job,
          state: 'accepted',
          resources: null,
          error: RESTORE_RESOURCE_MESSAGES['disk-space'],
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(RESTORE_RESOURCE_MESSAGES['disk-space'])).toBeVisible();
    await expect(canvas.queryByText('Estimated disk space')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Retry confirmed restore' })).toBeEnabled();
  },
};
export const SmallBackup: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': {
        available: true,
        job: { ...job, bytes: 2048, verification: { ...job.verification!, images: 1 } },
        outcome: null,
        pending: false,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('2 KiB', { exact: true })).toBeVisible();
    await expect(canvas.queryByText('0 MiB', { exact: true })).toBeNull();
    await expect(canvas.getByText(/^Tables:/)).toHaveTextContent(
      'Tables: 33 · Rows: 200 · Snapshots: 14 · Images: 1',
    );
    const dialog = await openConfirmation(canvasElement);
    await expect(dialog.getByText('2 KiB', { exact: true })).toBeVisible();
    await expect(dialog.queryByText('0 MiB', { exact: true })).toBeNull();
    await expect(dialog.getByText(/^Tables:/)).toHaveTextContent(
      'Tables: 33 · Rows: 200 · Snapshots: 14 · Images: 1',
    );
  },
};
export const Cancelled: Story = { parameters: { api: read('cancelled') } };
export const Expired: Story = { parameters: { api: read('expired') } };
export const Failed: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': {
        available: true,
        outcome: null,
        pending: false,
        job: { ...job, state: 'failed', error: '/private/backup.sqlite' },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/Restore preparation failed/);
    await expect(canvas.queryByText('/private/backup.sqlite')).toBeNull();
  },
};
export const AdmissionNeedsAttention: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': {
        available: true,
        outcome: null,
        pending: false,
        job: { ...job, state: 'admitting', error: 'untrusted diagnostic' },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('button', { name: 'Retry confirmed restore' }),
    ).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'Cancel preparation' })).toBeNull();
    await expect(canvas.queryByText('untrusted diagnostic')).toBeNull();
  },
};
export const Accepted: Story = { parameters: { api: read('accepted') } };
export const StartedOutcomeUnconfirmed: Story = {
  parameters: { api: read('started') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/final outcome is not yet confirmed/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Prepare restore' })).toBeDisabled();
    await expect(canvas.queryByText('Restore complete')).toBeNull();
  },
};

async function openPreparation(canvasElement: HTMLElement) {
  const button = await within(canvasElement).findByRole('button', { name: 'Prepare restore' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  return within(
    await within(document.body).findByRole('dialog', { name: 'Prepare workspace restore' }),
  );
}
export const ManualUpload: Story = {
  parameters: { api: read(null) },
  play: async ({ canvasElement }) => {
    const dialog = await openPreparation(canvasElement);
    await expect(dialog.getByLabelText('Encrypted workspace backup')).toBeVisible();
    await expect(dialog.getByLabelText('Separate recovery key')).toBeVisible();
    await expect(dialog.getByText(/SQLite database file cannot be restored here/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Verify and prepare' })).toBeDisabled();
  },
};
async function openCatalog(canvasElement: HTMLElement) {
  const dialog = await openPreparation(canvasElement);
  await userEvent.click(dialog.getByRole('combobox', { name: 'Backup source' }));
  await userEvent.click(
    await within(document.body).findByRole('option', { name: 'Previously saved backup' }),
  );
  return dialog;
}
export const SavedBackups: Story = {
  parameters: {
    api: {
      ...read(null),
      'GET /api/admin/restores/catalog': {
        entries: [
          { id: 'c'.repeat(64), createdAt: now },
          { id: 'd'.repeat(64), createdAt: now - 86400_000 },
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openCatalog(canvasElement);
    await expect(await dialog.findByRole('combobox', { name: 'Saved backup' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Verify and prepare' })).toBeDisabled();
  },
};
export const SavedBackupsEmpty: Story = {
  parameters: { api: { ...read(null), 'GET /api/admin/restores/catalog': { entries: [] } } },
  play: async ({ canvasElement }) => {
    const dialog = await openCatalog(canvasElement);
    await expect(await dialog.findByText(/No complete saved backups/)).toBeVisible();
  },
};
export const SavedBackupsLoading: Story = {
  parameters: { api: { ...read(null), 'GET /api/admin/restores/catalog': pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await openCatalog(canvasElement);
    await expect(await dialog.findByRole('status')).toHaveTextContent('Loading saved backups');
  },
};
export const SavedBackupsFailed: Story = {
  parameters: {
    api: { ...read(null), 'GET /api/admin/restores/catalog': failure('private destination', 503) },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openCatalog(canvasElement);
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      /Saved backups could not be loaded/,
    );
  },
};
async function openConfirmation(canvasElement: HTMLElement, retry = false) {
  const button = await within(canvasElement).findByRole('button', {
    name: retry ? 'Retry confirmed restore' : 'Review restore',
  });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  return within(
    await within(document.body).findByRole('dialog', { name: 'Restore this workspace?' }),
  );
}
export const ConfirmationReview: Story = {
  parameters: { api: read('ready') },
  play: async ({ canvasElement }) => {
    const dialog = await openConfirmation(canvasElement);
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await expect(dialog.getByText('Backup fingerprint')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Verify and restore workspace' }),
    ).toBeDisabled();
  },
};
export const FullConfirmation: Story = {
  parameters: { api: read('ready') },
  play: async ({ canvasElement }) => {
    const dialog = await openConfirmation(canvasElement);
    for (const consequence of RESTORE_CONSEQUENCES)
      await expect(dialog.getByText(consequence)).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Verify and restore workspace' }),
    ).toBeDisabled();
    await userEvent.click(dialog.getByRole('checkbox'));
    await expect(
      dialog.getByRole('button', { name: 'Verify and restore workspace' }),
    ).toBeEnabled();
    // ConfirmationReview preserves the top/source view. This existing story
    // finishes at the acknowledgement and actions so screenshots cover both ends.
    const confirm = dialog.getByRole('button', { name: 'Verify and restore workspace' });
    confirm.scrollIntoView({ block: 'end', behavior: 'instant' });
    await waitFor(() => {
      const panel = confirm.closest('[role="dialog"]')!.getBoundingClientRect();
      for (const node of [
        dialog.getByRole('checkbox').closest('label')!,
        dialog.getByRole('button', { name: 'Cancel' }),
        confirm,
      ]) {
        const box = node.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(Math.max(0, panel.top) - 1);
        expect(box.bottom).toBeLessThanOrEqual(Math.min(window.innerHeight, panel.bottom) + 1);
      }
    });
  },
};
export const WaitingForPasskey: Story = {
  parameters: { api: { ...read('ready'), 'POST /api/auth/reauthentication/options': pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await openConfirmation(canvasElement);
    await userEvent.click(dialog.getByRole('checkbox'));
    await userEvent.click(dialog.getByRole('button', { name: 'Verify and restore workspace' }));
    await expect(await dialog.findByRole('status')).toHaveTextContent('Waiting for your passkey');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  },
};
export const CancelVerification: Story = {
  parameters: WaitingForPasskey.parameters,
  play: async ({ canvasElement }) => {
    const dialog = await openConfirmation(canvasElement);
    await userEvent.click(dialog.getByRole('checkbox'));
    await userEvent.click(dialog.getByRole('button', { name: 'Verify and restore workspace' }));
    await dialog.findByRole('status');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
    await expect(
      within(canvasElement).getByRole('button', { name: 'Review restore' }),
    ).toHaveFocus();
  },
};
export const VerificationFailed: Story = {
  parameters: {
    api: {
      ...read('ready'),
      'POST /api/auth/reauthentication/options': failure('/private/passkey', 500),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openConfirmation(canvasElement);
    await userEvent.click(dialog.getByRole('checkbox'));
    await userEvent.click(dialog.getByRole('button', { name: 'Verify and restore workspace' }));
    await expect(await dialog.findByRole('alert')).toBeVisible();
    await expect(dialog.queryByText('/private/passkey')).toBeNull();
  },
};
export const RecordingConfirmation: Story = {
  args: { authenticate },
  parameters: {
    api: {
      ...read('ready'),
      ...verified,
      [`POST /api/admin/restores/preparations/${job.id}/confirm`]: pending(),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openConfirmation(canvasElement);
    await userEvent.click(dialog.getByRole('checkbox'));
    await userEvent.click(dialog.getByRole('button', { name: 'Verify and restore workspace' }));
    await waitFor(() =>
      expect(dialog.getByRole('status')).toHaveTextContent('Recording restore confirmation'),
    );
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  },
};
export const ExpiredOriginalConfirmation: Story = {
  parameters: {
    api: {
      ...AdmissionNeedsAttention.parameters?.api,
      [`POST /api/admin/restores/preparations/${job.id}/confirm`]: failure('expired original', 428),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openConfirmation(canvasElement, true);
    await userEvent.click(dialog.getByRole('checkbox'));
    await userEvent.click(dialog.getByRole('button', { name: 'Retry confirmed restore' }));
    await expect(
      await within(canvasElement).findByText(/original confirmation expired/),
    ).toBeVisible();
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('alert')).toHaveLength(1);
    await expect(canvas.queryByRole('button', { name: 'Retry confirmed restore' })).toBeNull();
    await expect(canvas.queryByText(/Passkey verification expired/)).toBeNull();
    await expect(canvas.queryByText(/check status or retry the same confirmation/)).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Refresh restore status' })).toBeEnabled();
    await expect(canvas.getByRole('link', { name: 'Open recovery guide' })).toBeVisible();
  },
};

function recorded(state: RestoreOutcome['state'], pending = false): Story {
  const outcome: RestoreOutcome = {
    id: job.id,
    state,
    updatedAt: now,
    source: { bytes: job.bytes!, sha256: job.sourceSha256! },
  };
  return {
    parameters: {
      api: { 'GET /api/admin/restores': { available: true, job: null, outcome, pending } },
    },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      await expect(
        await canvas.findByRole('heading', { name: 'Recorded restore outcome' }),
      ).toBeVisible();
      await expect(canvas.getByText(job.sourceSha256!)).toBeVisible();
      const prepare = canvas.getByRole('button', { name: 'Prepare restore' });
      if (state === 'unresolved' || pending) await expect(prepare).toBeDisabled();
      else await expect(prepare).toBeEnabled();
      if (state === 'original-recovered') {
        await expect(
          canvas.getByText(/The backup restore did not succeed. Original content was recovered/),
        ).toBeVisible();
        await expect(canvas.queryByText(/^Backup restored\./)).toBeNull();
      }
    },
  };
}
export const BackupRestored = recorded('backup-restored');
export const OriginalRecovered = recorded('original-recovered');
export const DidNotStart = recorded('did-not-start');
export const UnresolvedOutcome = recorded('unresolved', true);
export const PendingWithoutRecord: Story = {
  parameters: {
    api: {
      'GET /api/admin/restores': { available: true, job: null, outcome: null, pending: true },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/A restore still needs attention/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Prepare restore' })).toBeDisabled();
  },
};
export const IncompleteObservation: Story = {
  parameters: { api: { 'GET /api/admin/restores': { available: true, job: null } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      /Restore status is unavailable/,
    );
    await expect(canvas.getByRole('button', { name: 'Prepare restore' })).toBeDisabled();
  },
};
