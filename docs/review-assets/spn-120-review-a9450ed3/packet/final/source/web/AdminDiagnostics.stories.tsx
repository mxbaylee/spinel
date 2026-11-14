import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
import { AdminDiagnostics } from './AdminDiagnostics.tsx';
import { diagnosticsStory } from './diagnosticsStoryData.ts';
import './administration.css';

const api = { 'GET /api/admin/diagnostics': diagnosticsStory };
async function openClear(canvasElement: HTMLElement) {
  const canvas = within(canvasElement),
    body = within(document.body);
  await waitFor(() =>
    expect(canvas.getByRole('button', { name: 'Download diagnostics' })).toBeEnabled(),
  );
  await userEvent.click(canvas.getByRole('button', { name: 'Diagnostics actions' }));
  await userEvent.click(await body.findByRole('menuitem', { name: 'Truncate diagnostics…' }));
  return body.findByRole('dialog', { name: 'Truncate diagnostics' });
}
const meta = {
  title: 'Current production/Admin/Diagnostics',
  component: AdminDiagnostics,
  args: { onBusyChange: fn() },
} satisfies Meta<typeof AdminDiagnostics>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = { parameters: { api } };
export const Empty: Story = {
  parameters: {
    api: { 'GET /api/admin/diagnostics': { ...diagnosticsStory, recordCount: 0, logicalBytes: 0 } },
  },
};
export const Loading: Story = { parameters: { api: { 'GET /api/admin/diagnostics': pending() } } };
export const Unavailable: Story = {
  parameters: {
    api: {
      'GET /api/admin/diagnostics': { ...diagnosticsStory, available: false, generation: null },
    },
  },
};
export const Failed: Story = {
  parameters: { api: { 'GET /api/admin/diagnostics': failure('private storage details', 503) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Diagnostics status is unavailable.',
    );
    await expect(canvas.queryByText('private storage details')).not.toBeInTheDocument();
  },
};
export const Expired: Story = {
  parameters: { api: { 'GET /api/admin/diagnostics': failure('private identity', 401) } },
};
export const AnotherDownload: Story = {
  parameters: { api: { 'GET /api/admin/diagnostics': { ...diagnosticsStory, exporting: true } } },
};
export const Losses: Story = {
  parameters: {
    api: {
      'GET /api/admin/diagnostics': {
        ...diagnosticsStory,
        dropped: { invalid: 3, queue: 12, storage: 89, unavailable: 4, stale: 2 },
      },
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByText('Dropped records since server start'),
    );
  },
};
export const Confirmation: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const dialog = await openClear(canvasElement);
    await assertDialogControls(dialog);
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const truncate = within(dialog).getByRole('button', { name: 'Truncate diagnostics' });
    await waitFor(() => {
      const first = cancel.getBoundingClientRect();
      const second = truncate.getBoundingClientRect();
      expect(second.left >= first.right + 8 || second.top >= first.bottom + 8).toBe(true);
    });
  },
};
export const CancelClear: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const dialog = await openClear(canvasElement);
    await expect(within(dialog).getByText(/cannot be undone/)).toBeVisible();
    await expect(within(dialog).getByText(/Feedback flags are cleared/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await expect(
      within(canvasElement).getByRole('button', { name: 'Diagnostics actions' }),
    ).toHaveFocus();
    await expect(within(canvasElement).queryByText(/Diagnostics cleared/)).not.toBeInTheDocument();
  },
};
export const Clearing: Story = {
  parameters: { api: { ...api, 'POST /api/admin/diagnostics/truncate': pending() } },
  play: async ({ canvasElement, args }) => {
    const dialog = await openClear(canvasElement);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Truncate diagnostics' }));
    await expect(within(dialog).getByRole('button', { name: 'Clearing…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(dialog).toBeVisible();
    await expect(args.onBusyChange).toHaveBeenLastCalledWith(true);
  },
};
export const ClearFailed: Story = {
  parameters: {
    api: { ...api, 'POST /api/admin/diagnostics/truncate': failure('private sqlite details', 503) },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openClear(canvasElement);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Truncate diagnostics' }));
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'The clear request could not be confirmed.',
    );
    await expect(within(canvasElement).queryByText(/Diagnostics cleared/)).not.toBeInTheDocument();
  },
};
export const ChangedCollection: Story = {
  parameters: {
    api: { ...api, 'POST /api/admin/diagnostics/truncate': failure('generation changed', 409) },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openClear(canvasElement);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Truncate diagnostics' }));
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'confirm again',
    );
    await expect(dialog).not.toBeInTheDocument();
    await expect(within(canvasElement).queryByText(/Diagnostics cleared/)).not.toBeInTheDocument();
  },
};
export const Cleared: Story = {
  parameters: {
    api: {
      ...api,
      'POST /api/admin/diagnostics/truncate': {
        generation: '22222222-2222-4222-8222-222222222222',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openClear(canvasElement);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Truncate diagnostics' }));
    await expect(await within(canvasElement).findByText(/Diagnostics cleared/)).toBeVisible();
  },
};
export const Downloading: Story = {
  parameters: { api: { ...api, 'POST /api/admin/diagnostics/download': pending() } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const download = canvas.getByRole('button', { name: 'Download diagnostics' });
    await waitFor(() => expect(download).toBeEnabled());
    await userEvent.click(download);
    await expect(canvas.getByRole('button', { name: 'Downloading…' })).toBeDisabled();
    await expect(args.onBusyChange).toHaveBeenLastCalledWith(true);
  },
};
export const DownloadCancelled: Story = {
  parameters: Downloading.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Download diagnostics' })).toBeEnabled(),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Download diagnostics' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel download' }));
    await expect(canvas.getByText(/Download cancelled/)).toBeVisible();
  },
};
export const DownloadFailed: Story = {
  parameters: {
    api: { ...api, 'POST /api/admin/diagnostics/download': failure('secret export path', 503) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Download diagnostics' })).toBeEnabled(),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Download diagnostics' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Diagnostics could not be downloaded.',
    );
    await expect(canvas.queryByText(/snapshot sent/)).not.toBeInTheDocument();
  },
};
export const DownloadReady: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const original = window.fetch;
    window.fetch = async (input, init) =>
      String(input).endsWith('/diagnostics/download')
        ? new Response('SQLite format 3\0Story-only snapshot', {
            headers: { 'Content-Type': 'application/vnd.sqlite3' },
          })
        : original(input, init);
    try {
      const canvas = within(canvasElement);
      await waitFor(() =>
        expect(canvas.getByRole('button', { name: 'Download diagnostics' })).toBeEnabled(),
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Download diagnostics' }));
      await expect(
        await canvas.findByText(/Diagnostics snapshot sent to your browser/),
      ).toBeVisible();
    } finally {
      window.fetch = original;
    }
  },
};
export const FreshConfirmationRequired: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const original = window.fetch;
    const next = '22222222-2222-4222-8222-222222222222';
    const posted: unknown[] = [];
    window.fetch = async (input, init) => {
      if (String(input).endsWith('/diagnostics/truncate')) {
        posted.push(JSON.parse(String(init?.body)));
        return posted.length === 1
          ? Response.json({ error: 'Collection changed' }, { status: 409 })
          : Response.json({ generation: next });
      }
      if (String(input).endsWith('/admin/diagnostics') && posted.length)
        return Response.json({ ...diagnosticsStory, generation: next });
      return original(input, init);
    };
    try {
      const first = await openClear(canvasElement);
      await userEvent.click(within(first).getByRole('button', { name: 'Truncate diagnostics' }));
      await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
        'confirm again',
      );
      await expect(posted).toEqual([{ confirm: true, generation: diagnosticsStory.generation }]);
      const second = await openClear(canvasElement);
      await userEvent.click(within(second).getByRole('button', { name: 'Truncate diagnostics' }));
      await expect(await within(canvasElement).findByText(/Diagnostics cleared/)).toBeVisible();
      await expect(posted).toEqual([
        { confirm: true, generation: diagnosticsStory.generation },
        { confirm: true, generation: next },
      ]);
    } finally {
      window.fetch = original;
    }
  },
};
export const ClearCommittedReadbackFailed: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const original = window.fetch;
    let committed = false;
    window.fetch = async (input, init) => {
      if (String(input).endsWith('/diagnostics/truncate')) {
        committed = true;
        return Response.json({ generation: '22222222-2222-4222-8222-222222222222' });
      }
      if (committed && String(input).endsWith('/admin/diagnostics'))
        return Response.json({ error: 'Private failure' }, { status: 503 });
      return original(input, init);
    };
    try {
      const dialog = await openClear(canvasElement);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Truncate diagnostics' }));
      await expect(await within(canvasElement).findByText(/Diagnostics cleared/)).toBeVisible();
      await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
        'Diagnostics status is unavailable.',
      );
    } finally {
      window.fetch = original;
    }
  },
};
