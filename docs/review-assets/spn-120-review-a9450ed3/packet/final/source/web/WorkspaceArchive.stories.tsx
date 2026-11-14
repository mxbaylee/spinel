import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
import type { ArchiveTask } from '../src/shared/archive.ts';
import { WorkspaceArchive } from './WorkspaceArchive.tsx';

const id = '00000000-0000-4000-8000-000000000067';
const task = (overrides: Partial<ArchiveTask> = {}): ArchiveTask => ({
  id,
  state: 'exporting',
  completed: 3,
  total: 12,
  downloadUrl: `/api/items/archive-export/${id}/download`,
  ...overrides,
});
const exporting = {
  'POST /api/items/archive-export': { task: task() },
  [`GET /api/items/archive-export/${id}`]: { task: task() },
};
const meta = {
  id: 'dashboard-workspacearchive',
  title: 'Current production/Dashboard/WorkspaceArchive',
  component: WorkspaceArchive,
  args: { onClose: fn() },
} satisfies Meta<typeof WorkspaceArchive>;
export default meta;
type Story = StoryObj<typeof meta>;

async function begin(canvasElement: HTMLElement) {
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.click(await screen.findByRole('button', { name: 'Export files' }));
  return screen;
}

export const Confirmation: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Export all my files',
    });
    await expect(within(dialog).getByText(/Files shared with you, Trash, history/)).toBeVisible();
    await assertDialogControls(dialog);
  },
};

export const Starting: Story = {
  parameters: { api: { 'POST /api/items/archive-export': pending() } },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await expect(screen.getByRole('status')).toHaveTextContent('Starting your export…');
    await expect(screen.getByRole('button', { name: 'Cancel export' })).toBeEnabled();
    await assertDialogControls(screen.getByRole('dialog'));
  },
};

export const Preparing: Story = {
  parameters: {
    api: {
      'POST /api/items/archive-export': { task: task({ completed: 0, total: null }) },
      [`GET /api/items/archive-export/${id}`]: { task: task({ completed: 0, total: null }) },
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Preparing your archive…'),
    );
  },
};

export const BrowserDownload: Story = {
  parameters: {
    api: {
      'POST /api/items/archive-export': {
        task: task({ state: 'ready', completed: 0, total: null }),
      },
      [`GET /api/items/archive-export/${id}`]: {
        task: task({ state: 'ready', completed: 0, total: null }),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const original = HTMLAnchorElement.prototype.click;
    const downloads: string[] = [];
    HTMLAnchorElement.prototype.click = function () {
      downloads.push(this.href);
    };
    try {
      await begin(canvasElement);
      await waitFor(() =>
        expect(downloads).toEqual([`${location.origin}/api/items/archive-export/${id}/download`]),
      );
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
  },
};

export const Exporting: Story = {
  parameters: { api: exporting },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Exporting 3 of 12 files…'),
    );
    await assertDialogControls(screen.getByRole('dialog'));
  },
};

export const Completed: Story = {
  parameters: {
    api: {
      'POST /api/items/archive-export': {
        task: task({ state: 'completed', completed: 12 }),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Archive sent to your browser. Check your downloads.',
      ),
    );
    await expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  },
};

export const EmptyArchive: Story = {
  parameters: {
    api: {
      'POST /api/items/archive-export': {
        task: task({ state: 'completed', completed: 0, total: 0 }),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Archive sent to your browser. Check your downloads.',
      ),
    );
  },
};

export const StartFailed: Story = {
  parameters: {
    api: {
      'POST /api/items/archive-export': failure(
        'An export is already running. Finish or cancel it before trying again.',
        409,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      /An export is already running/,
    );
    await expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await assertDialogControls(screen.getByRole('dialog'));
  },
};

export const ExportFailed: Story = {
  parameters: {
    api: {
      'POST /api/items/archive-export': {
        task: task({
          state: 'failed',
          error: 'Could not finish the archive. Try again when your files have finished saving.',
        }),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not finish the archive/,
    );
    await expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  },
};

export const ProgressUnavailable: Story = {
  parameters: {
    api: {
      ...exporting,
      [`GET /api/items/archive-export/${id}`]: failure(
        'Could not check export progress. Retry the status or cancel the export.',
        503,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not check export progress/,
    );
    await expect(screen.getByRole('button', { name: 'Retry status' })).toBeEnabled();
    await expect(screen.getByRole('button', { name: 'Cancel export' })).toBeEnabled();
  },
};

export const ExpiredTask: Story = {
  parameters: {
    api: {
      ...exporting,
      [`GET /api/items/archive-export/${id}`]: failure(
        'This archive task is no longer available.',
        404,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    const message =
      'This export task is no longer available. Check your downloads before starting again.';
    await expect(await screen.findByText(message)).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    await expect(screen.getByRole('button', { name: 'Close dialog' })).toBeEnabled();
    await expect(screen.queryByRole('button', { name: 'Retry status' })).not.toBeInTheDocument();
    // A missing receipt must release the controller's active-task guard too.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await expect(await screen.findByRole('button', { name: 'Cancel export' })).toBeEnabled();
    await expect(await screen.findByText(message)).toBeVisible();
    await assertDialogControls(screen.getByRole('dialog'));
  },
};

export const CancelExpiredTask: Story = {
  parameters: {
    api: {
      ...exporting,
      [`DELETE /api/items/archive-export/${id}`]: failure(
        'This archive task is no longer available.',
        404,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await screen.findByText('Exporting 3 of 12 files…');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel export' }));
    await expect(
      await screen.findByText(
        'This export task is no longer available. Check your downloads before starting again.',
      ),
    ).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    await expect(screen.getByRole('button', { name: 'Close dialog' })).toBeEnabled();
    await expect(screen.queryByRole('button', { name: 'Retry status' })).not.toBeInTheDocument();
    await expect(screen.queryByRole('button', { name: 'Cancel export' })).not.toBeInTheDocument();
    await assertDialogControls(screen.getByRole('dialog'));
  },
};

export const RetryProgress: Story = {
  parameters: { api: exporting },
  play: async ({ canvasElement }) => {
    const original = globalThis.fetch;
    let reads = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith(`/archive-export/${id}`) && (init?.method ?? 'GET') === 'GET') {
        reads++;
        return reads === 1
          ? Response.json({ error: 'Connection interrupted. Retry the status.' }, { status: 503 })
          : Response.json({ task: task({ state: 'completed', completed: 12 }) });
      }
      return original(input, init);
    };
    try {
      const screen = await begin(canvasElement);
      await userEvent.click(await screen.findByRole('button', { name: 'Retry status' }));
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'Archive sent to your browser. Check your downloads.',
        ),
      );
      await expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      globalThis.fetch = original;
    }
  },
};

export const Cancelling: Story = {
  parameters: {
    api: { ...exporting, [`DELETE /api/items/archive-export/${id}`]: pending() },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await screen.findByText('Exporting 3 of 12 files…');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel export' }));
    await expect(screen.getByRole('status')).toHaveTextContent('Cancelling export…');
    await expect(screen.getByRole('button', { name: 'Cancel export' })).toBeDisabled();
    await assertDialogControls(screen.getByRole('dialog'));
  },
};

export const Cancelled: Story = {
  parameters: {
    api: {
      ...exporting,
      [`DELETE /api/items/archive-export/${id}`]: { task: task({ state: 'cancelled' }) },
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await screen.findByText('Exporting 3 of 12 files…');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel export' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Export cancelled.'));
    await expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  },
};

export const CancelBeforeStart: Story = {
  parameters: { api: { 'POST /api/items/archive-export': pending() } },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    await expect(screen.getByRole('status')).toHaveTextContent('Export cancelled.');
    await expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  },
};

export const CancellationFailed: Story = {
  parameters: {
    api: {
      ...exporting,
      [`DELETE /api/items/archive-export/${id}`]: failure(
        'Could not confirm cancellation. Check the export status and try again.',
        503,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const screen = await begin(canvasElement);
    await screen.findByText('Exporting 3 of 12 files…');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel export' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not confirm cancellation/,
    );
    await expect(screen.getByRole('button', { name: 'Retry status' })).toBeEnabled();
    await expect(screen.getByRole('button', { name: 'Cancel export' })).toBeEnabled();
  },
};
