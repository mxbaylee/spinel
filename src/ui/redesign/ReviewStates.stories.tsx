import type { Meta, StoryObj } from '@storybook/react-vite';
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
