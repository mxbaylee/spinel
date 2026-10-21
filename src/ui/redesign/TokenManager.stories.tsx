import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { TokenManager } from './TokenManager.tsx';
import './mockups.css';

const meta = {
  title: 'Redesign/Access tokens',
  component: TokenManager,
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'Proposed personal-token manager and operator metadata view. Local fixture only; no credentials are issued. Mirrors every existing Settings/AccessTokens state.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="sp-ui rd-dialog-stage">
        <div className="rd-dialog-example">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof TokenManager>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loaded: Story = {};
export const Empty: Story = { args: { state: 'empty' } };
export const Loading: Story = { args: { state: 'loading' } };
export const LoadFailed: Story = { args: { state: 'load-failed' } };
export const Creating: Story = {
  args: { state: 'creating' },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', {
      name: 'Create an access token',
    });
    await expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByRole('status')).toHaveTextContent('Creating access token…');
  },
};
export const Created: Story = { args: { state: 'created' } };
export const CreateFailed: Story = { args: { state: 'create-failed' } };
export const Revoking: Story = { args: { state: 'revoking' } };
export const Revoked: Story = { args: { state: 'revoked' } };
export const RevokeFailed: Story = { args: { state: 'revoke-failed' } };
export const ActiveLimit: Story = { args: { state: 'active-limit' } };
export const PreviouslyUsed: Story = { args: { state: 'previously-used' } };
export const Copied: Story = { args: { state: 'copied' } };
export const ManualCopy: Story = { args: { state: 'manual-copy' } };
export const OperatorMetadata: Story = { args: { admin: true } };
export const OperatorEmpty: Story = { args: { admin: true, state: 'empty' } };
export const OperatorLoading: Story = { args: { admin: true, state: 'loading' } };
export const OperatorLoadFailed: Story = { args: { admin: true, state: 'load-failed' } };

export const LongName: Story = {
  args: {
    initialTokenName:
      'Monthly budget archive and household planning script for all recurring workflows',
  },
};
