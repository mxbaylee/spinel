import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { DeviceStoragePanel } from './DeviceStoragePanel.tsx';
import type { DeviceItem, DeviceStorageDialog } from './DeviceStoragePanel.tsx';
import type { DeviceInventory } from './offline/deviceStorage.ts';

const ordinary = '11111111-1111-4111-8111-111111111155';
const child = '22222222-2222-4222-8222-222222222255';
const space = '33333333-3333-4333-8333-333333333355';
const clean: DeviceItem = {
  itemId: ordinary,
  name: 'Household budget',
  kind: 'sheet',
  readOnly: false,
  revision: 4,
  downloadedAt: 1,
  available: true,
  bytes: 2411725,
};
const pending: DeviceItem = {
  ...clean,
  itemId: child,
  spaceId: space,
  name: 'Trip journal',
  kind: 'doc',
  pending: true,
  bytes: 18432,
};
const inventory: DeviceInventory = {
  state: 'ready',
  items: [
    clean,
    pending,
    {
      ...clean,
      itemId: '44444444-4444-4444-8444-444444444455',
      name: 'Shared recipe collection',
      kind: 'doc',
      readOnly: true,
      bytes: 8192,
    },
  ],
  bytes: 2438349,
  origin: { usage: 30146560, quota: 536870912 },
  persistence: 'granted',
};

function Preview({
  value = inventory,
  loading = false,
  locked = false,
  error,
  initialDialog,
  failure = false,
  becamePending = false,
  removing = false,
  onRemove = fn(),
}: {
  value?: DeviceInventory | null;
  loading?: boolean;
  locked?: boolean;
  error?: string;
  initialDialog?: 'about' | 'clean' | 'pending' | 'discard';
  failure?: boolean;
  becamePending?: boolean;
  removing?: boolean;
  onRemove?: (itemId: string, discard: boolean) => void;
}) {
  const [data, setData] = useState(value);
  const item = value?.items[0] ?? clean;
  const [dialog, setDialog] = useState<DeviceStorageDialog>(
    initialDialog === 'about'
      ? { kind: 'about' }
      : initialDialog
        ? {
            kind: 'remove',
            item: initialDialog === 'clean' ? item : { ...item, pending: true },
            discard: initialDialog === 'discard',
          }
        : null,
  );
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(
    failure && initialDialog
      ? { text: 'Close this document in every tab before removing its device copy.', failed: true }
      : null,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  function remove() {
    if (dialog?.kind !== 'remove') return;
    onRemove(dialog.item.itemId, dialog.discard === true);
    if (failure) {
      setMessage({
        text: 'Close this document in every tab before removing its device copy.',
        failed: true,
      });
      return;
    }
    if (becamePending && !dialog.discard) {
      setData(
        (previous) =>
          previous && {
            ...previous,
            items: previous.items.map((entry) =>
              entry.itemId === dialog.item.itemId ? { ...entry, pending: true } : entry,
            ),
          },
      );
      setDialog({ kind: 'remove', item: { ...dialog.item, pending: true } });
      setMessage({
        text: 'This copy now has saved or unverified offline changes. Nothing was removed.',
        failed: false,
      });
      return;
    }
    setData(
      (previous) =>
        previous && {
          ...previous,
          items: previous.items.filter((entry) => entry.itemId !== dialog.item.itemId),
        },
    );
    setMessage({
      text: `${dialog.item.name} was removed from this device. The original is unchanged.`,
      failed: false,
    });
    setDialog(null);
  }
  return (
    <div style={{ maxWidth: 680, padding: 24 }}>
      <DeviceStoragePanel
        inventory={data}
        loading={loading}
        locked={locked}
        error={locked ? 'You signed out or changed accounts on this device.' : error}
        operation={removing ? { itemId: item.itemId } : null}
        dialog={dialog}
        message={message}
        headingRef={heading}
        onRefresh={fn()}
        onRequestPersistence={() => {
          setData((previous) => previous && { ...previous, persistence: 'denied' });
          setMessage({
            text: 'Storage protection was not granted. Your existing device copies are kept.',
            failed: false,
          });
        }}
        onOpenDialog={(next, from) => {
          if (from) trigger.current = from;
          setDialog(next);
          setMessage(null);
        }}
        onConfirmRemove={remove}
        allowNavigation={fn(() => false)}
        finalFocus={() => (trigger.current?.isConnected ? trigger.current : heading.current)}
      />
    </div>
  );
}

const meta = {
  id: 'offline-device-storage',
  title: 'Current production/Offline/This device',
  component: Preview,
  args: { onRemove: fn() },
  parameters: {
    docs: {
      description: {
        component:
          'The production device-storage presentation and dialogs. Fixtures demonstrate states; Playwright verifies actual IndexedDB, quota, images, account isolation and native pending changes.',
      },
    },
  },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { value: null, loading: true } };
export const Empty: Story = {
  args: {
    value: { ...inventory, state: 'empty', items: [], bytes: 0, persistence: 'not-requested' },
  },
};
export const Documents: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: clean.name })).toHaveAttribute(
      'href',
      `/?item=${ordinary}`,
    );
    await expect(canvas.getByRole('link', { name: pending.name })).toHaveAttribute(
      'href',
      `/?offlineRecovery=${child}`,
    );
    await expect(canvas.getByText('View only')).toBeVisible();
    await expect(canvas.getByText('Pending changes')).toBeVisible();
    await expect(canvas.getByText('This account’s documents')).toBeVisible();
    await expect(canvas.getByText('Browser storage for this site')).toBeVisible();
  },
};
export const SpacePage: Story = {
  args: { value: { ...inventory, items: [{ ...pending, pending: false }] } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: pending.name })).toHaveAttribute(
      'href',
      `/spaces/${space}?item=${child}`,
    );
  },
};
export const MissingStore: Story = {
  args: { value: { ...inventory, state: 'missing', items: [], bytes: 0 } },
};
export const StartupMetadataMissing: Story = {
  args: {
    value: {
      ...inventory,
      items: inventory.items.map((item) => ({
        ...item,
        available: false,
        problem:
          'The saved account or file list is missing or incomplete. Connect to prepare this device again. Saved document data is retained.',
      })),
    },
  },
};
export const StorageUnavailable: Story = {
  args: {
    value: {
      ...inventory,
      state: 'unavailable',
      items: [],
      bytes: null,
      origin: {},
      persistence: 'error',
      problem: 'Device storage is unavailable. Allow browser storage, then try again.',
    },
  },
};
export const StoragePreparationFailed: Story = {
  args: {
    value: null,
    error:
      'Offline downloads need browser storage. Allow storage or free up space, then try again.',
  },
};
export const AccountLocked: Story = {
  args: { value: null, locked: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(clean.name)).not.toBeInTheDocument();
    await expect(canvas.queryByText(pending.name)).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  },
};
export const ProtectionDenied: Story = { args: { value: { ...inventory, persistence: 'denied' } } };
export const ProtectionUnsupported: Story = {
  args: { value: { ...inventory, persistence: 'unsupported' } },
};
export const ProtectionError: Story = { args: { value: { ...inventory, persistence: 'error' } } };
export const RequestProtection: Story = {
  args: { value: { ...inventory, persistence: 'not-requested' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Request storage protection' }));
    await expect(canvas.getByText('Your browser did not grant storage protection.')).toBeVisible();
    await expect(canvas.getByRole('link', { name: clean.name })).toBeVisible();
  },
};
export const AboutStorage: Story = {
  args: { initialDialog: 'about' },
  play: async () => {
    const guide = within(
      within(document.body).getByRole('dialog', { name: 'About device storage' }),
    );
    await expect(guide.getByText(/Use a regular window/)).toBeVisible();
    await expect(guide.getByText(/Server backups cannot restore edits/)).toBeVisible();
  },
};
export const CleanRemoval: Story = { args: { initialDialog: 'clean' } };
export const PendingRemoval: Story = {
  args: { initialDialog: 'pending', value: { ...inventory, items: [pending] } },
};
export const DiscardConfirmation: Story = {
  args: { initialDialog: 'discard', value: { ...inventory, items: [pending] } },
};
export const RemovalFailed: Story = { args: { initialDialog: 'clean', failure: true } };
export const Removing: Story = {
  args: { initialDialog: 'discard', removing: true, value: { ...inventory, items: [pending] } },
  play: async () => {
    const body = within(document.body);
    const dialog = body.getByRole('dialog', { name: 'Discard offline changes?' });
    await expect(within(dialog).getByRole('button', { name: 'Removing…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(dialog).toBeVisible();
  },
};
export const DamagedPending: Story = {
  args: {
    initialDialog: 'pending',
    value: {
      ...inventory,
      items: [
        {
          ...pending,
          available: false,
          uncertain: true,
          bytes: null,
          problem: 'An image is missing or incomplete. Saved offline changes have been kept.',
        },
      ],
      bytes: null,
    },
  },
};
export const CancelKeepsChanges: Story = {
  args: { value: { ...inventory, items: [pending] } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: `Remove ${pending.name} from device` });
    await userEvent.click(button);
    const body = within(document.body);
    const dialog = body.getByRole('dialog', { name: 'Keep your offline changes' });
    await expect(within(dialog).getByRole('link', { name: 'Open recovery' })).toHaveAttribute(
      'href',
      `/?offlineRecovery=${child}`,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard offline changes…' }));
    await expect(body.getByRole('dialog', { name: 'Discard offline changes?' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(button));
    await expect(canvas.getByRole('link', { name: pending.name })).toBeVisible();
    await expect(args.onRemove).not.toHaveBeenCalled();
  },
};
export const NewlyPendingIsKept: Story = {
  args: { becamePending: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const retained = canvas.getByRole('link', { name: clean.name });
    await userEvent.click(canvas.getByRole('button', { name: `Remove ${clean.name} from device` }));
    const body = within(document.body);
    await userEvent.click(
      within(body.getByRole('dialog', { name: 'Remove device copy?' })).getByRole('button', {
        name: 'Remove from device',
      }),
    );
    const dialog = body.getByRole('dialog', { name: 'Keep your offline changes' });
    await expect(
      within(dialog).getByText(
        'This copy now has saved or unverified offline changes. Nothing was removed.',
      ),
    ).toBeVisible();
    await expect(retained).toBeInTheDocument();
    await expect(within(dialog).getByRole('link', { name: 'Open recovery' })).toHaveAttribute(
      'href',
      `/?offlineRecovery=${ordinary}`,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep on device' }));
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
    await expect(canvas.getByRole('link', { name: clean.name })).toBeVisible();
    await expect(canvas.getByRole('link', { name: clean.name })).toHaveAttribute(
      'href',
      `/?offlineRecovery=${ordinary}`,
    );
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
    await expect(args.onRemove).toHaveBeenCalledWith(ordinary, false);
  },
};
export const RemovalReturnsFocus: Story = {
  args: { value: { ...inventory, items: [clean] } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole('button', { name: `Remove ${clean.name} from device` }));
    await userEvent.click(
      within(body.getByRole('dialog', { name: 'Remove device copy?' })).getByRole('button', {
        name: 'Remove from device',
      }),
    );
    await expect(args.onRemove).toHaveBeenCalledWith(ordinary, false);
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
    await expect(canvas.queryByRole('link', { name: clean.name })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        canvas.getByRole('heading', { name: 'Offline documents' }),
      ),
    );
  },
};
export const LongTitlePhone: Story = {
  args: {
    value: {
      ...inventory,
      items: [
        {
          ...pending,
          name: '旅行の記録 — shared plans and the notes we still need to finish before leaving on our very long journey together',
        },
      ],
    },
  },
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Pending changes')).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  },
};
