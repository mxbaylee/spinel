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
    const window = canvasElement.ownerDocument.defaultView!;
    const width = window.innerWidth;
    // Base UI radios render spans, not buttons. Check the actual targets at
    // phone widths even when the screenshot browser uses a fine pointer.
    for (const control of canvasElement.querySelectorAll('button, [role="radio"]')) {
      const rect = control.getBoundingClientRect();
      await expect(rect.left).toBeGreaterThanOrEqual(0);
      await expect(rect.right).toBeLessThanOrEqual(width);
      if (width <= 600 || window.matchMedia('(any-pointer: coarse)').matches) {
        await expect(rect.width).toBeGreaterThanOrEqual(44);
        await expect(rect.height).toBeGreaterThanOrEqual(44);
      }
    }
    const radios = canvas.queryAllByRole('radio');
    const initial = radios.find((radio) => radio.getAttribute('aria-checked') === 'true');
    for (const radio of radios) {
      await userEvent.click(radio);
      await expect(radio).toHaveAttribute('aria-checked', 'true');
      await expect(canvas.getAllByRole('radio', { checked: true })).toHaveLength(1);
    }
    if (initial) await userEvent.click(initial);
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  },
} satisfies Meta<typeof AccessState>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Revoked: Story = {};
export const RevokedWithUnsavedInput: Story = {
  args: { kind: 'revoked', unsaved: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Some changes were not saved. This document is no longer accessible.')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /copy|recover|retry|export/i })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();
  },
};
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
