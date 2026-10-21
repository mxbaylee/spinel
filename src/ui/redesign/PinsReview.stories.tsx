import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import {
  PinReviewButton,
  PinnedReview,
  PinsReviewProvider,
  initialReviewPins,
  useReviewPins,
} from './PinsReview.tsx';
import type { PinsReviewState, ReviewPin } from './PinsReview.tsx';
import { DashboardMockup } from './Mockups.tsx';
import { Button } from './Controls.tsx';
import './mockups.css';

const folder: ReviewPin = { id: 'fixture-Household', name: 'Household', kind: 'folder' };
const note: ReviewPin = {
  id: 'fixture-Notes for next week',
  name: 'Notes for next week',
  kind: 'doc',
};
const loaded = [...initialReviewPins, folder];
function Example({
  state = 'ready',
  empty = false,
  compact = false,
  fail = false,
}: {
  state?: PinsReviewState;
  empty?: boolean;
  compact?: boolean;
  fail?: boolean;
}) {
  const [opened, setOpened] = useState('');
  return (
    <PinsReviewProvider
      initialItems={empty ? [] : loaded}
      initialState={state}
      mutationResult={fail ? 'failure' : 'success'}
    >
      <div className="sp-ui rd-pins-example">
        <p>Local preview · changes reset when reloaded.</p>
        <PinReviewButton item={note} />
        <PinnedReview compact={compact} onSelect={setOpened} selected={opened} />
        {opened && <p>Opened item: {opened}</p>}
      </div>
    </PinsReviewProvider>
  );
}
const meta = {
  title: 'Redesign/Pins',
  component: Example,
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loaded: Story = {};
export const Empty: Story = { args: { empty: true } };
export const Loading: Story = { args: { state: 'loading' } };
export const LoadFailed: Story = { args: { state: 'load-failed' } };
export const Pending: Story = {
  args: { state: 'pending' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Pin Notes for next week' })).toBeDisabled();
    await expect(canvas.getByText('Updating pins…')).toBeVisible();
  },
};
export const UpdateFailed: Story = { args: { state: 'update-failed' } };
export const Compact: Story = { args: { compact: true } };
export const CompactEmpty: Story = { args: { compact: true, empty: true } };
export const CompactLoading: Story = { args: { compact: true, state: 'loading' } };
export const CompactLoadFailed: Story = { args: { compact: true, state: 'load-failed' } };
export const CompactPending: Story = { args: { compact: true, state: 'pending' } };
export const CompactUpdateFailed: Story = { args: { compact: true, state: 'update-failed' } };
export const PinAndUnpin: Story = {
  args: { empty: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Pin Notes for next week' }));
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Unpin Notes for next week' })).toBeEnabled(),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Notes for next week' }));
    await expect(canvas.getByText('Opened item: fixture-Notes for next week')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Unpin Notes for next week' }));
    await waitFor(() => expect(canvas.getByText(/No pins yet/)).toBeVisible());
  },
};
export const ReorderAndRemoveFolder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const popup = within(document.body);
    const ids = () =>
      Array.from(canvasElement.querySelectorAll('[data-pin-id]')).map((row) =>
        row.getAttribute('data-pin-id'),
      );
    await userEvent.click(canvas.getByRole('button', { name: 'Household' }));
    await expect(canvas.getByText('Opened item: fixture-Household')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Pin actions for Household' }));
    await userEvent.click(await popup.findByRole('menuitem', { name: 'Move up' }));
    await waitFor(() =>
      expect(ids()).toEqual([
        'fixture-Quarterly budget',
        'fixture-Household',
        'fixture-Autumn plans',
      ]),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Pin actions for Household' }));
    await userEvent.click(await popup.findByRole('menuitem', { name: 'Unpin' }));
    await waitFor(() => expect(ids()).toEqual(initialReviewPins.map((item) => item.id)));
  },
};
export const RetryLoad: Story = {
  args: { state: 'load-failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Refresh pins' }));
    await expect(canvas.getByRole('button', { name: 'Household' })).toBeVisible();
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
  },
};
export const RetryUpdate: Story = {
  args: { fail: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Pin Notes for next week' }));
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent('Your previous pins are unchanged.'),
    );
    await expect(
      canvas.queryByRole('button', { name: /^Notes for next week$/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry update' }));
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Unpin Notes for next week' })).toBeEnabled(),
    );
    await expect(canvas.getByRole('button', { name: /^Notes for next week$/ })).toBeVisible();
  },
};

const openPinnedFile = fn();
export const DashboardNavigation: Story = {
  parameters: { shell: 'none' },
  render: () => <DashboardMockup collapsed onOpen={openPinnedFile} />,
  play: async ({ canvasElement }) => {
    openPinnedFile.mockClear();
    const canvas = within(canvasElement);
    const page = within(document.body);
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Notes for next week' }),
    );
    await userEvent.click(await page.findByRole('menuitem', { name: /^Pin$/ }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-pin-id="fixture-Notes for next week"]'),
      ).not.toBeNull(),
    );
    // Desktop opens the sidebar; phone opens the same shared model in its navigation dialog.
    await userEvent.click(canvas.getByRole('button', { name: 'Expand navigation' }));
    const pins = within(page.getByRole('region', { name: 'Pinned items' }));
    await userEvent.click(pins.getByRole('button', { name: /^Notes for next week$/ }));
    await expect(openPinnedFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: note.id, kind: 'doc' }),
    );
  },
};

type CatalogChange = 'rename' | 'trash' | 'failed-then-trash';
function CatalogChangeControls({ change }: { change: CatalogChange }) {
  const pins = useReviewPins();
  return (
    <div className="sp-ui rd-pins-example">
      <p>Local review: change a file while its pin update is pending.</p>
      <Button
        disabled={pins.state !== 'ready'}
        onClick={() => {
          pins.toggle(note);
          // The same event guarantees reconciliation precedes the update timer.
          if (change === 'rename') pins.reconcile([...loaded, { ...note, name: 'Weekend notes' }]);
          else if (change === 'trash') pins.reconcile(loaded);
        }}
      >
        Start pin update
      </Button>
      {change === 'failed-then-trash' && (
        <Button
          disabled={pins.state !== 'update-failed'}
          onClick={() => {
            pins.reconcile(loaded);
            pins.retry();
          }}
        >
          Trash file and retry pin update
        </Button>
      )}
      <output aria-label="Pin update state">{pins.state}</output>
      <PinnedReview onSelect={() => {}} />
    </div>
  );
}
function CatalogChangeExample({ change }: { change: CatalogChange }) {
  return (
    <PinsReviewProvider
      initialItems={loaded}
      mutationResult={change === 'failed-then-trash' ? 'failure' : 'success'}
    >
      <CatalogChangeControls change={change} />
    </PinsReviewProvider>
  );
}
export const RenameDuringPendingUpdate: Story = {
  render: () => <CatalogChangeExample change="rename" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Start pin update' }));
    // Wait for completion, so an immediate reconcile cannot hide a later stale commit.
    await waitFor(() =>
      expect(canvas.getByLabelText('Pin update state')).toHaveTextContent(/^ready$/),
    );
    await expect(canvas.getByRole('button', { name: /^Weekend notes$/ })).toBeVisible();
    await expect(
      canvas.queryByRole('button', { name: /^Notes for next week$/ }),
    ).not.toBeInTheDocument();
    await expect(
      Array.from(canvasElement.querySelectorAll('[data-pin-id]')).map((row) =>
        row.getAttribute('data-pin-id'),
      ),
    ).toEqual([...loaded, note].map((item) => item.id));
  },
};
export const TrashDuringPendingUpdate: Story = {
  render: () => <CatalogChangeExample change="trash" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Start pin update' }));
    await waitFor(() =>
      expect(canvas.getByLabelText('Pin update state')).toHaveTextContent(/^ready$/),
    );
    await expect(
      canvas.queryByRole('button', { name: /^Notes for next week$/ }),
    ).not.toBeInTheDocument();
    await expect(
      Array.from(canvasElement.querySelectorAll('[data-pin-id]')).map((row) =>
        row.getAttribute('data-pin-id'),
      ),
    ).toEqual(loaded.map((item) => item.id));
  },
};
export const TrashBeforeRetryUpdate: Story = {
  render: () => <CatalogChangeExample change="failed-then-trash" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Start pin update' }));
    await waitFor(() =>
      expect(canvas.getByLabelText('Pin update state')).toHaveTextContent(/^update-failed$/),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Trash file and retry pin update' }));
    await waitFor(() =>
      expect(canvas.getByLabelText('Pin update state')).toHaveTextContent(/^ready$/),
    );
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('button', { name: /^Notes for next week$/ }),
    ).not.toBeInTheDocument();
    await expect(
      Array.from(canvasElement.querySelectorAll('[data-pin-id]')).map((row) =>
        row.getAttribute('data-pin-id'),
      ),
    ).toEqual(loaded.map((item) => item.id));
  },
};
