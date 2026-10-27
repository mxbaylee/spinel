import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { AuthEntry } from './AuthEntry.tsx';

const meta = {
  id: 'account-entry',
  title: 'Current production/Account/Entry',
  component: AuthEntry,
  parameters: { shell: 'none' },
  args: {
    mode: 'sign-in',
    loading: false,
    validSetup: false,
    inviteDetails: null,
    name: '',
    busy: false,
    error: '',
    notice: '',
    onName: fn(),
    onPasskey: fn(),
    onCancel: fn(),
    onHome: fn(),
  },
} satisfies Meta<typeof AuthEntry>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Pending: Story = { args: { busy: true } };
export const Finishing: Story = {
  args: { busy: true, finishing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('Finishing the passkey request…');
    await expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull();
  },
};
export const Cancelled: Story = { args: { notice: 'Passkey request cancelled.' } };
export const Failed: Story = {
  args: { error: 'Passkey request did not finish. Try again and choose your passkey manager.' },
};
export const UnsupportedBrowser: Story = {
  args: { error: 'Passkeys need a supported browser at Spinel’s secure address.' },
};
export const Unreachable: Story = {
  args: { unreachable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await expect(canvas.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull();
  },
};
export const Setup: Story = { args: { mode: 'setup', validSetup: true } };
export const SetupPending: Story = { args: { ...Setup.args, busy: true } };
export const SetupUnavailable: Story = { args: { mode: 'setup' } };
export const SetupFailed: Story = {
  args: {
    ...Setup.args,
    error: 'This setup link has expired or been replaced. Run the setup command again.',
  },
};
export const Invite: Story = {
  args: { mode: 'invite', inviteDetails: { recovery: false, name: '' } },
};
export const InviteLoading: Story = { args: { mode: 'invite', loading: true } };
export const InviteUnavailable: Story = {
  args: { mode: 'invite', error: 'This invitation has expired or is no longer available.' },
};
export const InvitePending: Story = { args: { ...Invite.args, name: 'Alex Kim', busy: true } };
export const Recovery: Story = {
  args: { mode: 'invite', name: 'Alex Kim', inviteDetails: { recovery: true, name: 'Alex Kim' } },
};
export const RecoveryPending: Story = { args: { ...Recovery.args, busy: true } };
export const RecoveryFailed: Story = {
  args: {
    ...Recovery.args,
    error: 'Could not use this passkey. Try again or contact the operator.',
  },
};
export const LongRecoveryName: Story = {
  args: {
    ...Recovery.args,
    name: 'Alex'.repeat(20),
    inviteDetails: { recovery: true, name: 'Alex'.repeat(20) },
  },
};

export const Help: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Need help?' }));
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Access to this workspace',
      }),
    ).toBeVisible();
  },
};
export const OperatorHelp: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Need help?' }));
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Access to this workspace',
      }),
    );
    await userEvent.click(dialog.getByText('Operator help and commands'));
    await expect(dialog.getByText('npm run setup', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('npm run setup -- --recover-admin', { exact: true }),
    ).toBeVisible();
  },
};
export const HelpKeyboardReturn: Story = {
  play: async ({ canvasElement }) => {
    const help = within(canvasElement).getByRole('button', { name: 'Need help?' });
    await userEvent.click(help);
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Access to this workspace',
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(help).toHaveFocus());
  },
};
export const InviteThenCancel: Story = {
  args: Invite.args,
  render: function InviteFlow(args) {
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    return (
      <AuthEntry
        {...args}
        name={name}
        onName={setName}
        busy={busy}
        notice={notice}
        onPasskey={() => {
          setBusy(true);
          setNotice('');
        }}
        onCancel={() => {
          setBusy(false);
          setNotice('Passkey request cancelled.');
        }}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Join with a passkey' })).toBeDisabled();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Your name' }), 'Alex Kim');
    await userEvent.click(canvas.getByRole('button', { name: 'Join with a passkey' }));
    await expect(await canvas.findByRole('button', { name: 'Cancel' })).toHaveFocus();
    await expect(canvas.getByRole('textbox', { name: 'Your name' })).toBeDisabled();
    await userEvent.keyboard('{Enter}');
    await expect(await canvas.findByRole('button', { name: 'Join with a passkey' })).toHaveFocus();
    await expect(canvas.getByRole('textbox', { name: 'Your name' })).toHaveValue('Alex Kim');
  },
};
