import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { Walkthrough } from './Walkthrough.tsx';
const meta = {
  title: 'Redesign/Walkthrough',
  component: Walkthrough,
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Connected proposal using local fixtures only. Use the separate Preview event controls to simulate passkey results, save failures and guest revocation. Product navigation connects the screens; no production data is accessed.',
      },
    },
  },
} satisfies Meta<typeof Walkthrough>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = { args: { persona: 'owner' } };
export const Collaborator: Story = { args: { persona: 'collaborator', start: 'sign-in' } };
export const Operator: Story = { args: { persona: 'operator', start: 'setup' } };
export const ReturningOperator: Story = { args: { persona: 'operator', start: 'sign-in' } };
export const LinkGuest: Story = { args: { persona: 'guest', start: 'editor' } };
export const Homepage: Story = { args: { start: 'home' } };
export const SignIn: Story = { args: { start: 'sign-in' } };
export const PasskeyPending: Story = { args: { start: 'sign-in', initialOutcome: 'pending' } };
export const SignInCancelled: Story = { args: { start: 'sign-in', initialOutcome: 'cancelled' } };
export const SignInError: Story = { args: { start: 'sign-in', initialOutcome: 'error' } };
export const Invitation: Story = { args: { persona: 'collaborator', start: 'invite' } };
export const Recovery: Story = { args: { start: 'recovery' } };
export const InvalidSetup: Story = {
  args: { persona: 'operator', start: 'setup', initialOutcome: 'invalid' },
};
export const Settings: Story = { args: { start: 'profile' } };
export const Administration: Story = { args: { persona: 'operator', start: 'admin' } };
export const Sheet: Story = { args: { start: 'editor' } };
export const Doc: Story = { args: { start: 'editor', initialKind: 'doc' } };
export const SheetFullEditor: Story = {
  args: { start: 'editor' },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Hide review controls' }),
    );
  },
};
export const DocFullEditor: Story = {
  args: { start: 'editor', initialKind: 'doc' },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Hide review controls' }),
    );
  },
};

export const OperatorHelp: Story = {
  args: { persona: 'operator', start: 'setup' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Need help?' }));
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByText('Operator help and commands'),
    );
  },
};
