import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { RestoreNotice, restoreNoticeStorageKey } from './RestoreNotice.tsx';

const notice = {
  restoredAt: Date.UTC(2026, 9, 30, 18),
  backupCreatedAt: '2026-10-28T02:00:00.000Z',
};
const meta = {
  id: 'restore-notice',
  title: 'Current production/Shell/Restore notice',
  component: RestoreNotice,
  parameters: { shell: 'none' },
  args: { notice },
  beforeEach: () => {
    localStorage.removeItem(restoreNoticeStorageKey);
    return () => localStorage.removeItem(restoreNoticeStorageKey);
  },
} satisfies Meta<typeof RestoreNotice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Restored: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByRole('status');
    await expect(status).toHaveTextContent('Workspace restored.');
    await expect(status).toHaveTextContent('changes made after that backup were discarded');
    await expect(status).toHaveTextContent('personal filing, links or sharing may have changed');
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss restore notice' }));
    await expect(canvas.queryByRole('region', { name: 'Workspace restored' })).toBeNull();
    await expect(localStorage.getItem(restoreNoticeStorageKey)).toBe(String(notice.restoredAt));
  },
};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
export const AnotherRestoreAfterDismissal: Story = {
  beforeEach: () => {
    localStorage.setItem(restoreNoticeStorageKey, String(notice.restoredAt - 86_400_000));
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('region', { name: 'Workspace restored' }),
    ).toBeVisible();
  },
};
export const NeverRestored: Story = {
  args: { notice: null },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.restore-notice')).toBeNull();
  },
};
