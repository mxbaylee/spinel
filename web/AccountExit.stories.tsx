import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AccountExitView } from './AccountExit.tsx';
import type { ExitViewState } from './AccountExit.tsx';

const pending: ExitViewState = {
  remote: 'waiting',
  persisted: true,
  counts: { downloads: 3, pending: 1, uncertain: 0 },
  checking: false,
  choice: 'undecided',
  canDelete: true,
  deleting: false,
  error: '',
};
function Example(props: Parameters<typeof AccountExitView>[0]) {
  const [state, setState] = useState(props.state);
  return (
    <AccountExitView
      {...props}
      state={state}
      onKeep={() => {
        props.onKeep();
        setState({ ...state, choice: 'kept' });
      }}
      onDelete={() => {
        props.onDelete();
        setState({
          ...state,
          choice: 'deleted',
          counts: { downloads: 0, pending: 0, uncertain: 0 },
        });
      }}
      onRetry={() => {
        props.onRetry();
        setState({ ...state, remote: 'confirmed', error: '' });
      }}
    />
  );
}
const meta = {
  id: 'account-exit',
  title: 'Current production/Account/Sign out',
  component: AccountExitView,
  render: (args) => <Example {...args} />,
  parameters: { shell: 'none' },
  args: {
    state: pending,
    onKeep: fn(),
    onDelete: fn(),
    onRetry: fn(),
    onFreshExit: fn(),
    onContinue: fn(),
  },
} satisfies Meta<typeof AccountExitView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PendingChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Local access is locked.' })).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('Sign-out is saved for retry.');
    await expect(canvas.getByRole('button', { name: 'Keep changes' })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull();
  },
};
export const Checking: Story = {
  args: { state: { ...pending, counts: null, checking: true, remote: 'sending' } },
};
export const CountsUnavailable: Story = {
  args: {
    state: {
      ...pending,
      counts: null,
      error: 'Could not check offline storage. Any changes were kept.',
    },
  },
};
export const ConfirmedPendingChanges: Story = {
  args: { state: { ...pending, remote: 'confirmed' } },
};
export const KeptWhileOffline: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Keep changes' }));
    await expect(args.onKeep).toHaveBeenCalledOnce();
    await expect(
      canvas.getByText(
        'Your offline data is kept and locked. Sign in to the same account to recover it.',
      ),
    ).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Continue' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Try sign-out again' })).toBeEnabled();
  },
};
export const RetryConfirmed: Story = {
  args: { state: { ...pending, choice: 'kept' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Try sign-out again' }));
    await expect(canvas.getByRole('status')).toHaveTextContent('Signed out on the server.');
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeEnabled();
  },
};
export const NotQueued: Story = {
  args: { state: { ...pending, persisted: false, canDelete: false, counts: null } },
};
export const UnrecognizedExit: Story = {
  args: {
    state: {
      ...pending,
      remote: 'unknown',
      counts: null,
      canDelete: false,
      error: 'The earlier sign-out could not be identified. Its offline data is kept.',
    },
  },
};
export const WaitingForAnotherSignIn: Story = {
  args: {
    state: {
      ...pending,
      error: 'Finish or cancel the sign-in in your other Spinel tabs, then try again.',
    },
  },
};
export const DeleteConfirmation: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Delete offline data…' }),
    );
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', {
      name: 'Delete this account’s offline data?',
    });
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByRole('button', { name: 'Keep offline data' })).toBeEnabled();
    await expect(dialog).toHaveTextContent(
      'Changes that never reached the server cannot be recovered.',
    );
  },
};
export const CancelDeletion: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Delete offline data…' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    await expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).toBeNull();
    await expect(trigger).toHaveFocus();
    await expect(args.onDelete).not.toHaveBeenCalled();
  },
};
export const Deleted: Story = {
  args: { state: { ...pending, remote: 'confirmed' } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Delete offline data…' }));
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', {
      name: 'Delete this account’s offline data?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete offline data' }));
    await expect(args.onDelete).toHaveBeenCalledOnce();
    await expect(
      canvas.getByText(
        'Offline data for this account was deleted from this device. Server documents were not changed.',
      ),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeEnabled();
  },
};
export const DeletionRefused: Story = {
  args: {
    state: {
      ...pending,
      error: 'Close this document in every tab before removing its device copy.',
    },
  },
  play: DeleteConfirmation.play,
};
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
