import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { RestoreNotice as Notice } from '../src/shared/restore.ts';
import { RestoreNotice, restoreNoticeStorageKey } from './RestoreNotice.tsx';

const notice: Notice = {
  outcome: 'restored',
  at: Date.UTC(2026, 9, 30, 18),
  backupCreatedAt: '2026-10-28T02:00:00.000Z',
};
const recovered: Notice = { outcome: 'recovered', at: notice.at };
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
    const status = within(canvasElement).getByRole('status');
    await expect(status).toHaveTextContent('Workspace restored.');
    await expect(status).toHaveTextContent('later changes were discarded');
    await expect(status).toHaveTextContent('everyone was signed out');
    await expect(status).toHaveTextContent('personal filing, links or sharing may have changed');
  },
};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
/** A restore that did not finish keeps the original content but still reset access. */
export const RestoreUndone: Story = {
  args: { notice: recovered },
  play: async ({ canvasElement }) => {
    const status = within(canvasElement).getByRole('status');
    await expect(status).toHaveTextContent('Workspace restore undone.');
    await expect(status).toHaveTextContent('kept its own content');
    await expect(status).toHaveTextContent('everyone was signed out');
    await expect(status).not.toHaveTextContent('backup from');
  },
};
export const RestoreUndoneDark: Story = { ...RestoreUndone, globals: { theme: 'dark' } };
export const Dismissed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss restore notice' }));
    await expect(canvas.queryByRole('region', { name: 'Workspace restored' })).toBeNull();
    await expect(localStorage.getItem(restoreNoticeStorageKey)).toBe(String(notice.at));
  },
};
export const AnotherRestoreAfterDismissal: Story = {
  beforeEach: () => {
    localStorage.setItem(restoreNoticeStorageKey, String(notice.at - 86_400_000));
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
