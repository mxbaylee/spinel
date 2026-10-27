import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, within } from 'storybook/test';
import { OfflineAvailability } from './OfflineAvailability.tsx';

const itemId = '11111111-1111-4111-8111-111111111155';
const meta = {
  id: 'offline-availability',
  title: 'Current production/Offline/Availability result',
  component: OfflineAvailability,
  args: {
    message: {
      text: 'Trip journal is available offline on this device.',
      detail: 'Your browser granted storage protection. This is not a backup or a guarantee.',
      failed: false,
    },
    onDismiss: fn(),
    allowNavigation: fn(() => false),
  },
} satisfies Meta<typeof OfflineAvailability>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ProtectionGranted: Story = {};
export const ProtectionDenied: Story = {
  args: {
    message: {
      text: 'Trip journal is available offline on this device.',
      detail:
        'Your browser did not grant storage protection. It may remove these downloads during cleanup.',
      failed: false,
    },
  },
};
export const PendingRemoval: Story = {
  args: {
    message: {
      text: 'This copy has offline changes. Recover them or review the device copy before removing it.',
      failed: false,
      recoveryItemId: itemId,
    },
  },
  play: async ({ args }) => {
    const dialog = within(
      within(document.body).getByRole('dialog', { name: 'Offline availability' }),
    );
    const recovery = dialog.getByRole('link', { name: 'Open recovery' });
    await expect(recovery).toHaveAttribute('href', `/?offlineRecovery=${itemId}`);
    await expect(dialog.getByRole('link', { name: 'Manage device copies' })).toHaveAttribute(
      'href',
      '/profile#device',
    );
    const prevented: boolean[] = [];
    // Observe React's decision after its root handler, then prevent the story
    // runner itself from opening tabs for otherwise allowed modified clicks.
    const observe = (event: MouseEvent) => {
      if (event.target !== recovery) return;
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener('click', observe);
    try {
      await userEvent.click(recovery);
      await expect(args.allowNavigation).toHaveBeenCalledTimes(1);
      expect(prevented).toEqual([true]);
      for (const modifier of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
      ])
        fireEvent.click(recovery, modifier);
      await expect(args.allowNavigation).toHaveBeenCalledTimes(1);
      expect(prevented).toEqual([true, false, false, false, false, false]);
    } finally {
      document.removeEventListener('click', observe);
    }
  },
};
