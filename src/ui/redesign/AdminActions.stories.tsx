import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AdminMockup } from './Mockups.tsx';

const meta = {
  title: 'Redesign/Operator actions',
  component: AdminMockup,
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Proposed account, credential and invitation states. Pending/failure are deliberate fixtures; retry changes sample data only. No access APIs are called.',
      },
    },
  },
} satisfies Meta<typeof AdminMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Accounts: Story = { args: { state: 'accounts-varied' } };
export const AccountsLoading: Story = { args: { state: 'loading' } };
export const AccountsFailed: Story = { args: { state: 'error' } };
export const InvitesLoading: Story = { args: { section: 'Invites', state: 'loading' } };
export const InvitesFailed: Story = { args: { section: 'Invites', state: 'error' } };
export const InvitesEmpty: Story = { args: { section: 'Invites', firstRun: true } };
export const InvitationStatuses: Story = { args: { section: 'Invites', state: 'invite-statuses' } };
export const InviteCreating: Story = { args: { section: 'Invites', state: 'invite-pending' } };
export const InviteCreateFailed: Story = { args: { section: 'Invites', state: 'invite-error' } };
export const InviteRevoking: Story = { args: { section: 'Invites', state: 'revoke-pending' } };
export const InviteRevokeFailed: Story = { args: { section: 'Invites', state: 'revoke-error' } };
export const DisablePending: Story = { args: { state: 'disable-pending' } };
export const DisableFailed: Story = { args: { state: 'disable-error' } };
export const RemovePasskey: Story = { args: { state: 'passkey-confirm' } };
export const RemovePasskeyPending: Story = { args: { state: 'passkey-pending' } };
export const RemovePasskeyFailed: Story = { args: { state: 'passkey-error' } };
export const ProtectedOperatorPasskey: Story = {
  args: { state: 'operator-passkey' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = await portal.findByRole('dialog', { name: 'Passkeys for Operator (you)' });
    await expect(within(dialog).getByRole('button', { name: 'Remove…' })).toBeDisabled();
    await expect(within(dialog).getByText(/last passkey cannot be removed/)).toBeVisible();
  },
};
export const ConnectionsLoading: Story = { args: { section: 'Connections', state: 'loading' } };
export const ConnectionsFailed: Story = { args: { section: 'Connections', state: 'error' } };
export const RetryInvitesLoad: Story = {
  args: { section: 'Invites', state: 'error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Could not load invites.');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Revoke' })).toBeVisible();
  },
};
export const RetryCreateInvite: Story = {
  args: { section: 'Invites', state: 'invite-error' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = within(await portal.findByRole('dialog', { name: 'Create an invitation' }));
    // Failed creation preserves both choices and does not expose a new secret.
    await expect(dialog.getByRole('combobox', { name: 'Invite for' })).toHaveTextContent(
      'Recover Alex Kim',
    );
    await expect(dialog.getByRole('combobox', { name: 'Expires in' })).toHaveTextContent('1 day');
    await expect(portal.queryByRole('textbox', { name: 'Invitation address' })).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(portal.queryByRole('dialog')).toBeNull());
    await expect(await portal.findByRole('heading', { name: 'Invite ready' })).toBeVisible();
    await expect(portal.getByText('Recover Alex Kim', { exact: true })).toBeVisible();
    await expect(portal.getByText('Available · Expires in 1 day')).toBeVisible();
  },
};
export const RetryDisable: Story = {
  args: { state: 'disable-error' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = within(await portal.findByRole('dialog', { name: 'Disable Alex Kim?' }));
    await expect(dialog.getByRole('alert')).toHaveTextContent('account is still active');
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    const account = await portal.findByRole('group', { name: 'Alex Kim account' });
    await expect(within(account).getByText('Member · Disabled')).toBeVisible();
    await expect(portal.getByRole('status')).toHaveTextContent('No real account access changed');
  },
};
export const RetryRemovePasskey: Story = {
  args: { state: 'passkey-error' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = within(
      await portal.findByRole('dialog', { name: 'Remove MacBook from Alex Kim?' }),
    );
    await expect(dialog.getByRole('alert')).toHaveTextContent(
      'passkey and its sessions are unchanged',
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    const account = within(await portal.findByRole('group', { name: 'Alex Kim account' }));
    await expect(account.getByText('Member · Active · No passkeys')).toBeVisible();
    await waitFor(() => expect(portal.queryByRole('dialog')).toBeNull());
  },
};
export const CancelFailedPasskeyRemoval: Story = {
  args: { state: 'passkey-error' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = within(
      await portal.findByRole('dialog', { name: 'Remove MacBook from Alex Kim?' }),
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    const updated = within(await portal.findByRole('dialog', { name: 'Passkeys for Alex Kim' }));
    await expect(updated.getByRole('button', { name: 'Remove…' })).toBeEnabled();
    await expect(updated.getByText('MacBook', { exact: true })).toBeVisible();
  },
};
export const RetryRevokeInvite: Story = {
  args: { section: 'Invites', state: 'revoke-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('It is still available');
    await expect(canvas.getByText(/Available · Expires/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getByText('Revoked', { exact: true })).toBeVisible();
  },
};
export const OperatorWithMultiplePasskeys: Story = {
  args: { state: 'operator-multiple-passkeys' },
};
export const RemoveOneOperatorPasskey: Story = {
  args: { state: 'operator-multiple-passkeys' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    let dialog = within(await portal.findByRole('dialog', { name: 'Passkeys for Operator (you)' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Remove…' }));
    dialog = within(
      await portal.findByRole('dialog', { name: 'Remove MacBook from Operator (you)?' }),
    );
    await expect(dialog.getByRole('button', { name: 'Remove passkey' })).toBeEnabled();
    await userEvent.click(dialog.getByRole('button', { name: 'Remove passkey' }));
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Actions for Operator (you)' }),
    );
    await userEvent.click(await portal.findByRole('menuitem', { name: 'Manage passkeys' }));
    dialog = within(await portal.findByRole('dialog', { name: 'Passkeys for Operator (you)' }));
    await expect(dialog.getByText('Security key', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Last passkey · Protected')).toBeVisible();
    await expect(dialog.queryByRole('button', { name: 'Remove…' })).toBeNull();
  },
};
