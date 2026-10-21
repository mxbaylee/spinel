import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { EntryJourney } from './EntryJourney.tsx';
import type { EntryScreen, EntryOutcome } from './EntryJourney.tsx';

function EntryState({
  screen: initialScreen,
  outcome: initialOutcome,
}: {
  screen: EntryScreen;
  outcome: EntryOutcome;
}) {
  const [screen, setScreen] = useState(initialScreen);
  const [outcome, setOutcome] = useState(initialOutcome);
  return (
    <EntryJourney
      screen={screen}
      outcome={outcome}
      initialName={initialScreen === 'invite' ? 'Alex Kim' : ''}
      onNavigate={(next) => {
        setScreen(next);
        setOutcome('ready');
      }}
      onPasskey={() => setOutcome('pending')}
    />
  );
}
const meta = {
  title: 'Redesign/Entry states',
  component: EntryState,
  args: { screen: 'invite', outcome: 'pending' },
} satisfies Meta<typeof EntryState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InvitePending: Story = {};
export const InviteCancelled: Story = { args: { outcome: 'cancelled' } };
export const InviteError: Story = { args: { outcome: 'error' } };
export const InviteInvalid: Story = { args: { outcome: 'invalid' } };
export const RecoveryPending: Story = { args: { screen: 'recovery' } };
export const RecoveryCancelled: Story = { args: { screen: 'recovery', outcome: 'cancelled' } };
export const RecoveryError: Story = { args: { screen: 'recovery', outcome: 'error' } };
export const RecoveryInvalid: Story = {
  args: { screen: 'recovery', outcome: 'invalid' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('heading', { name: 'This recovery link isn’t available.' }),
    ).toBeVisible();
    await expect(
      canvas.getByText(/Ask the workspace Operator for a new recovery link/),
    ).toBeVisible();
    await expect(canvas.queryByText('Alex Kim')).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('button', { name: 'Recover with a passkey' }),
    ).not.toBeInTheDocument();
  },
};
export const SetupPending: Story = { args: { screen: 'setup' } };
export const SetupCancelled: Story = { args: { screen: 'setup', outcome: 'cancelled' } };
export const SetupError: Story = { args: { screen: 'setup', outcome: 'error' } };
export const SetupInvalid: Story = { args: { screen: 'setup', outcome: 'invalid' } };
export const InviteCancelAndRetry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Your name' })).toHaveValue('Alex Kim');
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(canvas.getByText(/Passkey request cancelled/)).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Your name' })).toHaveValue('Alex Kim');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again with a passkey' }));
    await expect(
      canvas.getByText('Continue in your browser or device’s passkey prompt.'),
    ).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Your name' })).toBeDisabled();
  },
};
