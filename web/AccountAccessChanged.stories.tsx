import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AccountAccessChanged } from './AccountExit.tsx';

const meta = {
  id: 'account-access-changed',
  title: 'Current production/Account/Access changed',
  component: AccountAccessChanged,
  parameters: { shell: 'none' },
  args: { onReopen: fn() },
} satisfies Meta<typeof AccountAccessChanged>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Locked: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'This tab is locked.' })).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Reopen Spinel to continue with this browser’s current sign-in.',
    );
    await expect(canvas.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull();
    await expect(args.onReopen).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Reopen Spinel' }));
    await expect(args.onReopen).toHaveBeenCalledOnce();
  },
};
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
