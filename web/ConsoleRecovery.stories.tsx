import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConsoleRecovery } from './ConsoleRecovery.tsx';

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
    finishing: false,
    error: '',
    notice: '',
    onRecover: fn(),
    onCancel: fn(),
  },
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
      canvas.queryByRole('button', { name: 'Recover admin with a passkey' }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  },
};
export const Cancelled: Story = { args: { notice: 'Passkey request cancelled.' } };
export const Retry: Story = {
  args: { error: 'Passkey request did not finish. Try again and choose your passkey manager.' },
};
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };

export const Finishing: Story = {
  args: { busy: true, finishing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Finishing admin recovery… Keep this page open.',
    );
    await expect(canvas.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  },
};
export const Help: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Need help?' }));
    await expect(
      within(canvasElement.ownerDocument.body).getByRole('dialog', {
        name: 'Recover admin access',
      }),
    ).toBeVisible();
  },
};
