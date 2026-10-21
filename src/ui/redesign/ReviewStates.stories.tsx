import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { AdminMockup, EntryMockup, ProfileMockup } from './Mockups.tsx';
import { Walkthrough } from './Walkthrough.tsx';

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
export const ConsentOperator: Story = {
  render: () => <Walkthrough persona="operator" start="consent" initialConsentState="operator" />,
};
export const ConsentMalformed: Story = { render: () => <EntryMockup consentState="malformed" /> };
export const ConsentUnavailable: Story = {
  render: () => <EntryMockup consentState="unavailable" />,
};
export const ConsentLimit: Story = {
  render: () => <Walkthrough start="consent" initialConsentState="limit" />,
};
export const ConsentLimitManageConnections: Story = {
  ...ConsentLimit,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Manage connected assistants' }));
    await expect(canvas.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Connected assistants' })).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: /^Disconnect Desktop assistant from/ }),
    );
    await expect(canvas.getByText('Disconnected', { exact: true })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Back to connection request' })).toBeVisible();
  },
};
export const ConsentLimitReturn: Story = {
  ...ConsentLimit,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Manage connected assistants' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Back to connection request' }));
    await expect(canvas.getByRole('heading', { name: 'Allow this connection?' })).toBeVisible();
    await expect(canvas.getByRole('alert')).toHaveTextContent('start again from your application');
  },
};
export const ConsentOperatorSignOut: Story = {
  ...ConsentOperator,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Sign out' }));
    await expect(canvas.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
    await expect(canvas.getByText('Design walkthrough · owner · local preview')).toBeVisible();
  },
};
export const ConsentEverydayAccount: Story = {
  ...ConsentOperator,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in with a passkey' }));
    await userEvent.click(canvas.getByText('Design walkthrough · owner · local preview'));
    await userEvent.click(canvas.getByRole('combobox', { name: 'Preview event' }));
    await userEvent.click(within(document.body).getByRole('option', { name: 'Passkey succeeded' }));
    await expect(canvas.getByRole('heading', { name: 'My files' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Administration' })).not.toBeInTheDocument();
  },
};
export const ConsentExpiredBeforeAllow: Story = {
  render: () => <EntryMockup expireOnAllow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Allow connection' }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('expired before access was granted');
    await expect(canvas.queryByRole('button', { name: 'Allow connection' })).toBeNull();
  },
};
