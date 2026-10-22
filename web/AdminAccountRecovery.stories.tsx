import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { TransferPreview } from '../src/shared/adminRecovery.ts';
import { AdminUsers } from './AdminUsers.tsx';

type Scenario =
  | 'ready'
  | 'reactivate-pending'
  | 'reactivate-failed'
  | 'reactivate-committed-warning'
  | 'reactivate-readback-failed'
  | 'preview-loading'
  | 'preview-failed'
  | 'preview-retry'
  | 'no-recipients'
  | 'nothing-owned'
  | 'transfer-pending'
  | 'transfer-failed'
  | 'transfer-retry'
  | 'transfer-stale'
  | 'transfer-committed-warning'
  | 'transfer-unconfirmed'
  | 'transfer-readback-failed'
  | 'duplicate-names'
  | 'long-names';
const sourceName = 'Priya Patel';
const targetName = 'Alex Kim';
const longSource = 'Priya Patel — Research, planning and shared projects';
const longTarget = 'Alex Kim — Everyday account for research and family planning';

/** Stateful API fixtures exercise the real dialogs; persistence is proved in browser tests. */
function RecoveryFixture({
  scenario = 'ready',
  onTransfer,
}: {
  scenario?: Scenario;
  onTransfer: (body: unknown) => void;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = globalThis.fetch;
    let previewAttempts = 0;
    let transferAttempts = 0;
    let reactivationAttempts = 0;
    const users = [
      { id: 'operator', name: 'Operator', isAdmin: true, disabled: false, passkeys: [] },
      {
        id: 'recipient',
        name: scenario === 'long-names' ? longTarget : targetName,
        isAdmin: false,
        disabled: scenario === 'no-recipients',
        passkeys: [],
      },
      {
        id: 'departed',
        name: scenario === 'long-names' ? longSource : sourceName,
        isAdmin: false,
        disabled: true,
        passkeys: [],
      },
      {
        id: 'secondary-admin',
        name: 'Secondary Operator',
        isAdmin: true,
        disabled: true,
        passkeys: [],
      },
    ];
    if (scenario === 'duplicate-names')
      users.push(
        { id: 'recipient-other', name: targetName, isAdmin: false, disabled: false, passkeys: [] },
        { id: 'departed-other', name: sourceName, isAdmin: false, disabled: true, passkeys: [] },
      );
    const preview: TransferPreview = {
      source: { id: 'departed', name: users[2]!.name },
      recipients:
        scenario === 'no-recipients'
          ? []
          : [
              { id: 'recipient', name: users[1]!.name },
              ...(scenario === 'duplicate-names'
                ? [{ id: 'recipient-other', name: targetName }]
                : []),
            ],
      counts:
        scenario === 'nothing-owned'
          ? { items: 0, folders: 0, links: 0 }
          : { items: 8, folders: 3, links: 2 },
      confirmation: 'first-counts-only-confirmation',
    };
    const failure = (error: string, status = 503) => Response.json({ error }, { status });
    const fixtureFetch: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      );
      if (url.pathname === '/api/auth/admin/users') {
        if (
          (scenario === 'transfer-readback-failed' && transferAttempts) ||
          (scenario === 'reactivate-readback-failed' && reactivationAttempts)
        )
          return failure('Account details could not be refreshed. Try again.');
        return Response.json({ users });
      }
      if (url.pathname === '/api/auth/invites') return Response.json({ invites: [] });
      if (url.pathname === '/api/auth/invites/recipients')
        return Response.json({
          users: users
            .filter((user) => !user.disabled)
            .map((user) => ({ id: user.id, name: user.name, isAdmin: Number(user.isAdmin) })),
        });
      if (url.pathname === '/api/auth/admin/users/departed/transfer-preview') {
        previewAttempts++;
        if (scenario === 'preview-loading') return new Promise<Response>(() => {});
        if (
          scenario === 'preview-failed' ||
          (scenario === 'preview-retry' && previewAttempts === 1)
        )
          return failure('Transfer details could not be loaded. Try again.');
        return Response.json(preview);
      }
      if (url.pathname === '/api/auth/admin/users/departed/transfer') {
        transferAttempts++;
        if (scenario === 'transfer-pending') return new Promise<Response>(() => {});
        const submitted = JSON.parse(String(init?.body));
        onTransfer(submitted);
        if (
          !preview.recipients.some((person) => person.id === submitted.targetId) ||
          submitted.confirmation !== preview.confirmation
        )
          return failure('Review current details and choose an eligible account.', 409);
        if (scenario === 'transfer-stale' && transferAttempts === 1) {
          preview.counts.items++;
          preview.confirmation = 'changed-structural-set';
          return failure('These files changed. Review the transfer again before confirming.', 409);
        }
        if (
          scenario === 'transfer-failed' ||
          (scenario === 'transfer-retry' && transferAttempts === 1) ||
          scenario === 'transfer-readback-failed'
        )
          return failure(
            'Transfer could not be confirmed. Refresh the details before trying again.',
          );
        preview.counts = { items: 0, folders: 0, links: 0 };
        preview.confirmation = 'no-owned-files';
        if (scenario === 'transfer-committed-warning')
          return failure(
            'Ownership transferred, but open connections could not refresh. Refresh accounts to see the result.',
          );
        if (scenario === 'transfer-unconfirmed') throw new TypeError('Failed to fetch');
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/reactivate')) {
        reactivationAttempts++;
        if (scenario === 'reactivate-pending') return new Promise<Response>(() => {});
        if (scenario === 'reactivate-failed' || scenario === 'reactivate-readback-failed')
          return failure('Reactivation could not be confirmed. Refresh the account details.');
        const user = users.find(
          (entry) => url.pathname === `/api/auth/admin/users/${entry.id}/reactivate`,
        );
        if (user) user.disabled = false;
        if (scenario === 'reactivate-committed-warning')
          return failure(
            'Account reactivated, but open connections could not refresh. Refresh accounts to see the result.',
          );
        return new Response(null, { status: 204 });
      }
      return original(input, init);
    };
    globalThis.fetch = fixtureFetch;
    setReady(true);
    return () => {
      if (globalThis.fetch === fixtureFetch) globalThis.fetch = original;
    };
  }, [scenario, onTransfer]);
  return ready ? <AdminUsers currentId="operator" /> : null;
}

const meta = {
  id: 'admin-account-recovery',
  title: 'Current production/Admin/Account recovery',
  component: RecoveryFixture,
  args: { onTransfer: fn() },
  parameters: {
    docs: {
      description: {
        component:
          'Real Operator account controls and recovery dialogs with stateful, count-only API fixtures. These stories prove UI states and interactions, not server authorization, ownership persistence, native editing or passkey recovery; those have separate application tests.',
      },
    },
  },
} satisfies Meta<typeof RecoveryFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
type Play = NonNullable<Story['play']>;

const open =
  (kind: 'reactivate' | 'transfer', name = sourceName): Play =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: `Actions for ${name}` }));
    await userEvent.click(
      await portal.findByRole('menuitem', {
        name: kind === 'reactivate' ? 'Reactivate…' : 'Transfer ownership…',
      }),
    );
    await expect(
      await portal.findByRole('dialog', {
        name: kind === 'reactivate' ? `Reactivate ${name}?` : `Transfer ownership from ${name}`,
      }),
    ).toBeVisible();
  };
const select =
  (name = targetName): Play =>
  async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const combo = await portal.findByRole('combobox', { name: 'New owner' });
    await userEvent.click(combo);
    await userEvent.click(await portal.findByRole('option', { name }));
    await expect(combo).toHaveTextContent(name);
  };
const submit: Play = async (context) => {
  await open('transfer')(context);
  await select()(context);
  const portal = within(context.canvasElement.ownerDocument.body);
  await userEvent.click(portal.getByRole('button', { name: 'Transfer ownership' }));
};
const reactivate: Play = async (context) => {
  await open('reactivate')(context);
  const portal = within(context.canvasElement.ownerDocument.body);
  await userEvent.click(portal.getByRole('button', { name: 'Reactivate account' }));
};
export const DisabledAccounts: Story = {};
export const ConfirmReactivation: Story = { play: open('reactivate') };
export const DisabledAdminReactivation: Story = {
  play: async (context) => {
    const portal = within(context.canvasElement.ownerDocument.body);
    await userEvent.click(
      await portal.findByRole('button', { name: 'Actions for Secondary Operator' }),
    );
    await expect(portal.queryByRole('menuitem', { name: 'Transfer ownership…' })).toBeNull();
    await userEvent.click(await portal.findByRole('menuitem', { name: 'Reactivate…' }));
    await expect(
      await portal.findByRole('dialog', { name: 'Reactivate Secondary Operator?' }),
    ).toBeVisible();
  },
};
export const ReactivationPending: Story = {
  args: { scenario: 'reactivate-pending' },
  play: async (context) => {
    await reactivate(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(portal.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
    await expect(portal.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(portal.getByRole('dialog')).toBeVisible();
  },
};
export const ReactivationFailed: Story = {
  args: { scenario: 'reactivate-failed' },
  play: async (context) => {
    await reactivate(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(await portal.findByText(/Account details are up to date/)).toBeVisible();
    await expect(portal.getByRole('button', { name: 'Reactivate account' })).toBeEnabled();
  },
};
export const ReactivationReadbackFailed: Story = {
  args: { scenario: 'reactivate-readback-failed' },
  play: async (context) => {
    await reactivate(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(
      await portal.findByRole('button', { name: 'Refresh account details' }),
    ).toBeEnabled();
    await expect(portal.getByRole('button', { name: 'Reactivate account' })).toBeDisabled();
  },
};
export const ReactivationCommittedWarning: Story = {
  args: { scenario: 'reactivate-committed-warning' },
  play: async (context) => {
    await reactivate(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(await portal.findByText(/This account is active/)).toBeVisible();
    await expect(portal.getByRole('button', { name: 'Reactivate account' })).toBeDisabled();
    await expect(portal.getByRole('alert')).toHaveTextContent('Account reactivated');
  },
};
export const Reactivated: Story = {
  play: async (context) => {
    await reactivate(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await waitFor(() => expect(portal.queryByRole('dialog')).toBeNull());
    const account = within(portal.getByRole('region', { name: `${sourceName} account` }));
    await expect(account.getByText('Member · Active')).toBeVisible();
    await expect(
      await portal.findByRole('option', { name: `Recover ${sourceName}` }),
    ).toBeInTheDocument();
  },
};
export const TransferLoading: Story = {
  args: { scenario: 'preview-loading' },
  play: open('transfer'),
};
export const TransferLoadFailed: Story = {
  args: { scenario: 'preview-failed' },
  play: open('transfer'),
};
export const RetryTransferLoad: Story = {
  args: { scenario: 'preview-retry' },
  play: async (context) => {
    await open('transfer')(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await userEvent.click(await portal.findByRole('button', { name: 'Refresh account details' }));
    await expect(await portal.findByRole('combobox', { name: 'New owner' })).toBeVisible();
    await expect(portal.queryByRole('alert')).toBeNull();
  },
};
export const TransferReady: Story = {
  play: async (context) => {
    await open('transfer')(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(await portal.findByRole('combobox', { name: 'New owner' })).toHaveTextContent(
      'Choose an account',
    );
    await expect(portal.getByRole('button', { name: 'Transfer ownership' })).toBeDisabled();
  },
};
export const TransferRecipientChosen: Story = {
  play: async (context) => {
    await open('transfer')(context);
    await select()(context);
  },
};
export const TransferNoRecipients: Story = {
  args: { scenario: 'no-recipients' },
  play: open('transfer'),
};
export const TransferNothingOwned: Story = {
  args: { scenario: 'nothing-owned' },
  play: open('transfer'),
};
export const TransferPending: Story = {
  args: { scenario: 'transfer-pending' },
  play: async (context) => {
    await submit(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(portal.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
    await expect(portal.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    await expect(portal.getByRole('combobox', { name: 'New owner' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(portal.getByRole('dialog')).toBeVisible();
  },
};
export const TransferFailed: Story = { args: { scenario: 'transfer-failed' }, play: submit };
export const TransferReadbackFailed: Story = {
  args: { scenario: 'transfer-readback-failed' },
  play: async (context) => {
    await submit(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(
      await portal.findByRole('button', { name: 'Refresh account details' }),
    ).toBeEnabled();
    await expect(portal.getByRole('button', { name: 'Transfer ownership' })).toBeDisabled();
  },
};
export const TransferStale: Story = {
  args: { scenario: 'transfer-stale' },
  play: async (context) => {
    await submit(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(await portal.findByRole('combobox', { name: 'New owner' })).toHaveTextContent(
      targetName,
    );
    await expect(portal.getByRole('alert')).toHaveTextContent('These files changed');
    await expect(portal.getByText('9', { exact: true })).toBeVisible();
    await expect(portal.getByRole('button', { name: 'Transfer ownership' })).toBeEnabled();
  },
};
export const TransferCommittedWarning: Story = {
  args: { scenario: 'transfer-committed-warning' },
  play: async (context) => {
    await submit(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(
      await portal.findByText('This account has no owned files or folders to transfer.'),
    ).toBeVisible();
    await expect(portal.getByRole('alert')).toHaveTextContent('Ownership transferred');
    await expect(portal.getByRole('button', { name: 'Transfer ownership' })).toBeDisabled();
  },
};
export const TransferUnconfirmedResponse: Story = {
  args: { scenario: 'transfer-unconfirmed' },
  play: async (context) => {
    await submit(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(
      await portal.findByText('This account has no owned files or folders to transfer.'),
    ).toBeVisible();
    await expect(portal.getByRole('alert')).toHaveTextContent('The result could not be confirmed');
    await expect(portal.getByRole('button', { name: 'Transfer ownership' })).toBeDisabled();
  },
};
export const TransferComplete: Story = {
  play: async (context) => {
    await submit(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await waitFor(() => expect(portal.queryByRole('dialog')).toBeNull());
    await expect(portal.getByText(/Ownership transferred from Priya Patel/)).toBeVisible();
  },
};
export const RetryTransfer: Story = {
  args: { scenario: 'transfer-retry' },
  play: async (context) => {
    await submit(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(await portal.findByRole('combobox', { name: 'New owner' })).toHaveTextContent(
      targetName,
    );
    await userEvent.click(portal.getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => expect(portal.queryByRole('dialog')).toBeNull());
    await expect(portal.getByText(/Ownership transferred from Priya Patel/)).toBeVisible();
  },
};
export const LongAccountNames: Story = {
  args: { scenario: 'long-names' },
  play: async (context) => {
    await open('transfer', longSource)(context);
    await select(longTarget)(context);
  },
};
export const DuplicateAccountNames: Story = {
  args: { scenario: 'duplicate-names' },
  play: async (context) => {
    await open('transfer', `${sourceName} (departed)`)(context);
    await select(`${targetName} (recipient-other)`)(context);
  },
};
export const DuplicateNameTargetSubmitted: Story = {
  args: { scenario: 'duplicate-names' },
  play: async (context) => {
    await open('transfer', `${sourceName} (departed)`)(context);
    await select(`${targetName} (recipient-other)`)(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await expect(portal.getByRole('dialog')).toHaveAccessibleName(
      `Transfer ownership from ${sourceName} (departed)`,
    );
    await expect(
      portal.getByText(`${targetName} (recipient-other)`, { selector: 'strong', exact: true }),
    ).toBeVisible();
    await userEvent.click(portal.getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => expect(portal.queryByRole('dialog')).toBeNull());
    await expect(context.args.onTransfer).toHaveBeenCalledWith({
      targetId: 'recipient-other',
      confirmation: 'first-counts-only-confirmation',
    });
  },
};
export const CancelReturnsFocus: Story = {
  play: async (context) => {
    await open('transfer')(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await userEvent.click(portal.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(portal.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(portal.getByRole('button', { name: `Actions for ${sourceName}` })).toHaveFocus(),
    );
    await expect(portal.getByText('Member · Disabled')).toBeVisible();
  },
};
export const KeyboardRecipientChoice: Story = {
  play: async (context) => {
    await open('transfer')(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    const combo = await portal.findByRole('combobox', { name: 'New owner' });
    combo.focus();
    await userEvent.keyboard('{Enter}');
    await expect(await portal.findByRole('listbox')).toBeVisible();
    // Base UI focuses the selected option on an animation frame after opening.
    await waitFor(() =>
      expect(portal.getByRole('option', { name: 'Choose an account' })).toHaveFocus(),
    );
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(portal.getByRole('option', { name: targetName })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(combo).toHaveTextContent(targetName));
    await waitFor(() => expect(portal.queryByRole('listbox')).toBeNull());
  },
};
