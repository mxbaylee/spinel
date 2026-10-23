import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { ConsoleRecovery } from './ConsoleRecovery.tsx';
import { Rail } from './Rail.tsx';

const meta = {
  id: 'account-console-recovery',
  title: 'Current production/Account/Console recovery',
  component: ConsoleRecovery,
  parameters: { shell: 'none' },
  args: {
    name: 'Workspace operator',
    loading: false,
    validLink: true,
    busy: false,
    error: '',
    notice: '',
    onRecover: fn(),
    onCancel: fn(),
  },
  render: (args) => (
    <div className="workspace">
      <Rail user={null} navigation={{ allow: () => false }} onSignOut={() => {}} />
      <div className="workspace-body">
        <main>
          <ConsoleRecovery {...args} />
        </main>
      </div>
    </div>
  ),
} satisfies Meta<typeof ConsoleRecovery>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Workspace operator' })).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Recover admin with a passkey' }),
    ).toBeEnabled();
  },
};
export const Loading: Story = { args: { name: '', loading: true } };
export const MissingLink: Story = { args: { name: '', validLink: false } };
export const ExpiredLink: Story = {
  args: {
    name: '',
    error: 'This recovery link is unavailable or expired. Run the recovery command again.',
  },
};
export const Pending: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('button', { name: 'Recover admin with a passkey' }),
    ).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  },
};
export const Cancelled: Story = { args: { notice: 'Passkey request cancelled.' } };
export const Retry: Story = {
  args: { error: 'Passkey request did not finish. Try again and choose your passkey manager.' },
};
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
