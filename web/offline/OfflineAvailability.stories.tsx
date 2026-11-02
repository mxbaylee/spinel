import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test';
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

export const ProtectionGranted: Story = {
  play: async () => {
    await expect(
      within(document.body).queryByRole('button', { name: 'How to keep them' }),
    ).not.toBeInTheDocument();
  },
};
export const ProtectionDenied: Story = {
  args: {
    message: {
      text: 'Trip journal is available offline on this device.',
      detail:
        'Your browser did not grant storage protection. It may clear offline documents when space runs low.',
      failed: false,
      storageHelp: true,
    },
  },
  play: async ({ args }) => {
    const body = within(document.body);
    const result = body.getByRole('dialog', { name: 'Offline availability' });
    const trigger = within(result).getByRole('button', { name: 'How to keep them' });
    await userEvent.click(trigger);
    const guide = body.getByRole('dialog', { name: 'About device storage' });
    await expect(within(guide).getByText(/Use a regular window/)).toBeVisible();
    await expect(within(guide).getByText(/Server backups cannot restore edits/)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(body.getByRole('dialog', { name: 'Offline availability' })).toBeVisible();
    await expect(args.onDismiss).not.toHaveBeenCalled();
    await expect(args.allowNavigation).not.toHaveBeenCalled();
  },
};
export const ProtectionUnsupported: Story = {
  args: {
    message: {
      text: 'Trip journal is available offline on this device.',
      detail: 'This browser does not offer storage protection. It may clear offline documents.',
      failed: false,
      storageHelp: true,
    },
  },
};
export const ProtectionError: Story = {
  args: {
    message: {
      text: 'Trip journal is available offline on this device.',
      detail: 'Storage protection could not be requested. Offline documents may still be cleared.',
      failed: false,
      storageHelp: true,
    },
  },
};
export const StorageGuidance: Story = {
  args: ProtectionDenied.args,
  play: async () => {
    await userEvent.click(within(document.body).getByRole('button', { name: 'How to keep them' }));
    await expect(
      within(document.body).getByRole('dialog', { name: 'About device storage' }),
    ).toBeVisible();
  },
};
export const BrowserStorageLimits: Story = {
  args: ProtectionDenied.args,
  play: async ({ args }) => {
    const body = within(document.body);
    const trigger = body.getByRole('button', { name: 'How to keep them' });
    await userEvent.click(trigger);
    const guide = within(body.getByRole('dialog', { name: 'About device storage' }));
    await userEvent.click(guide.getByText('Browser storage limits', { exact: true }));
    await expect(guide.getByText('Chrome', { exact: true })).toBeVisible();
    await expect(guide.getByText('Firefox', { exact: true })).toBeVisible();
    await expect(guide.getByText('Safari', { exact: true })).toBeVisible();
    // On a phone the expanded guide is taller than the modal. Its final action
    // must scroll into view, remain clickable, and return to the parent result.
    const done = guide.getByRole('button', { name: 'Done' });
    done.scrollIntoView({ block: 'nearest' });
    await waitFor(() => {
      const bounds = done.getBoundingClientRect();
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(
        done.contains(
          document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
        ),
      ).toBe(true);
    });
    await userEvent.click(done);
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(body.getByRole('dialog', { name: 'Offline availability' })).toBeVisible();
    await expect(args.onDismiss).not.toHaveBeenCalled();
    await expect(args.allowNavigation).not.toHaveBeenCalled();
    // Leave the explanatory state open for the independent visual capture.
    await userEvent.click(trigger);
    const reopenedDialog = body.getByRole('dialog', { name: 'About device storage' });
    const reopened = within(reopenedDialog);
    const summary = reopened.getByText('Browser storage limits', { exact: true });
    if (!summary.closest('details')!.open) await userEvent.click(summary);
    await expect(reopened.getByText('Safari', { exact: true })).toBeVisible();
    reopenedDialog.scrollTo({ top: 0 });
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
