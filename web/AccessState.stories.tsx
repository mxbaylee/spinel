import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AccessState } from './AccessState.tsx';

const meta = {
  title: 'Current production/Guest/AccessState',
  component: AccessState,
  parameters: { shell: 'none' },
  args: { kind: 'revoked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();
    const width = canvasElement.ownerDocument.defaultView!.innerWidth;
    for (const control of canvasElement.querySelectorAll('button')) {
      const rect = control.getBoundingClientRect();
      await expect(rect.left).toBeGreaterThanOrEqual(0);
      await expect(rect.right).toBeLessThanOrEqual(width);
    }
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  },
} satisfies Meta<typeof AccessState>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Revoked: Story = {};
export const Loading: Story = { args: { kind: 'loading' } };
export const UnsupportedBrowser: Story = { args: { kind: 'unsupported' } };
export const Offline: Story = { args: { kind: 'offline', onRetry: fn() } };
export const MissingGuestPage: Story = { args: { kind: 'missing' } };
export const MissingAccountFile: Story = {
  args: { kind: 'missing', embedded: true, onFiles: fn() },
};
export const Retry: Story = {
  args: { kind: 'offline', onRetry: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
