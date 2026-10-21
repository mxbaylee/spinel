import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { AdminMockup, EntryMockup, ProfileMockup } from './Mockups.tsx';

const meta = {
  title: 'Redesign/Review states',
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'Proposed recovery and progress states for existing account and Operator jobs. Local fixtures; no account, connection or server changes are made.',
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ProfileLoading: Story = { render: () => <ProfileMockup state="loading" /> };
export const ProfileLoadError: Story = { render: () => <ProfileMockup state="load-error" /> };
export const ProfileSaving: Story = { render: () => <ProfileMockup state="saving" /> };
export const ProfileSaveError: Story = { render: () => <ProfileMockup state="save-error" /> };
export const BackupRunning: Story = {
  render: () => <AdminMockup section="Backups & health" state="health-running" />,
};
export const BackupFailed: Story = {
  render: () => <AdminMockup section="Backups & health" state="health-failed" />,
};
export const BackupUnconfigured: Story = {
  render: () => <AdminMockup section="Backups & health" state="health-unconfigured" />,
};
export const BackupLoadError: Story = {
  render: () => <AdminMockup section="Backups & health" state="health-load-error" />,
};
export const BackupLoading: Story = {
  render: () => <AdminMockup section="Backups & health" state="health-loading" />,
};
export const BackupNeverRun: Story = {
  render: () => <AdminMockup section="Backups & health" state="health-never-run" />,
};
export const ConsentLoading: Story = { render: () => <EntryMockup consentState="loading" /> };
export const ConsentLoadError: Story = { render: () => <EntryMockup consentState="load-error" /> };
export const ConsentPending: Story = { render: () => <EntryMockup consentState="pending" /> };
export const ConsentCancelling: Story = { render: () => <EntryMockup consentState="cancelling" /> };
export const ConsentError: Story = { render: () => <EntryMockup consentState="error" /> };
export const ConsentOperator: Story = { render: () => <EntryMockup consentState="operator" /> };
export const ConsentMalformed: Story = { render: () => <EntryMockup consentState="malformed" /> };
export const ConsentUnavailable: Story = {
  render: () => <EntryMockup consentState="unavailable" />,
};
export const ConsentLimit: Story = { render: () => <EntryMockup consentState="limit" /> };
export const ConsentExpiredBeforeAllow: Story = {
  render: () => <EntryMockup expireOnAllow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Allow connection' }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('expired before access was granted');
    await expect(canvas.queryByRole('button', { name: 'Allow connection' })).toBeNull();
  },
};
