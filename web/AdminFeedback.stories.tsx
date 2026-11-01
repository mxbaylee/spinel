import type { Meta, StoryObj } from '@storybook/react-vite';
import { StrictMode } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { failure, fileReply, pending } from '../.storybook/api.ts';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
import { AdminUsers } from './AdminUsers.tsx';
import { feedbackActor, feedbackGeneration, feedbackPair } from './feedbackStoryData.ts';

const api = {
  'GET /api/auth/admin/users': {
    users: [
      { id: 'operator', name: 'Sam Rivera', isAdmin: true, disabled: false, passkeys: [] },
      { id: feedbackActor, name: 'Alex Kim', isAdmin: false, disabled: false, passkeys: [] },
    ],
  },
  'GET /api/admin/diagnostics/feedback': {
    generation: feedbackGeneration,
    actors: [feedbackActor],
  },
  'POST /api/admin/diagnostics/feedback/prepare': feedbackPair,
  [`POST /api/admin/diagnostics/feedback/${feedbackPair.id}/download`]: fileReply(
    'Synthetic story artifact; real SQLite membership is checked by the browser suite.',
    'application/vnd.sqlite3',
    'diagnostics.sqlite',
  ),
  [`POST /api/admin/diagnostics/feedback/${feedbackPair.id}/cancel`]: {},
};
const meta = {
  title: 'Current production/Admin/Feedback',
  component: AdminUsers,
  args: { currentId: 'operator' },
  render: (args) => (
    <StrictMode>
      <AdminUsers {...args} />
    </StrictMode>
  ),
} satisfies Meta<typeof AdminUsers>;
export default meta;
type Story = StoryObj<typeof meta>;
async function openDownloads(canvasElement: HTMLElement, scope = 'user') {
  const canvas = within(canvasElement),
    body = within(document.body);
  await userEvent.click(
    await canvas.findByRole('button', { name: 'Feedback downloads for Alex Kim' }),
  );
  await userEvent.click(await body.findByRole('menuitem', { name: `Download ${scope} metrics` }));
  return body.findByRole('dialog', { name: 'Feedback diagnostics' });
}

export const Flag: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Feedback available')).toBeVisible();
  },
};
export const FlagsLoading: Story = {
  parameters: { api: { ...api, 'GET /api/admin/diagnostics/feedback': pending() } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Checking feedback…')).toBeVisible();
  },
};
export const FlagsUnavailable: Story = {
  parameters: {
    api: { ...api, 'GET /api/admin/diagnostics/feedback': failure('private details', 503) },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'Feedback status is unavailable',
    );
    await expect(within(canvasElement).queryByText('No feedback')).not.toBeInTheDocument();
  },
};
export const NoFeedback: Story = {
  parameters: {
    api: {
      ...api,
      'GET /api/admin/diagnostics/feedback': { generation: feedbackGeneration, actors: [] },
    },
  },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('region', { name: 'Alex Kim account' });
    await waitFor(() =>
      expect(within(canvasElement).queryByText('Checking feedback…')).not.toBeInTheDocument(),
    );
    await expect(within(canvasElement).queryByText('Feedback available')).not.toBeInTheDocument();
  },
};
export const UserDownload: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(
      await within(dialog).findByText('User metrics sent to your browser. Check your downloads.'),
    ).toBeVisible();
    await expect(within(dialog).getByLabelText('Shared time span')).toBeVisible();
    await assertDialogControls(dialog);
  },
};
export const SystemDownload: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement, 'system');
    await expect(
      await within(dialog).findByText('System metrics sent to your browser. Check your downloads.'),
    ).toBeVisible();
  },
};
export const PairedDownloads: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    const content = within(dialog);
    await content.findByText('User metrics sent to your browser. Check your downloads.');
    const before = content.getByLabelText('Shared time span').textContent;
    await userEvent.click(content.getByRole('button', { name: 'Download system metrics' }));
    await content.findByText('System metrics sent to your browser. Check your downloads.');
    await expect(content.getByLabelText('Shared time span').textContent).toBe(before);
  },
};
export const Preparing: Story = {
  parameters: { api: { ...api, 'POST /api/admin/diagnostics/feedback/prepare': pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(
      await within(dialog).findByText('Preparing both downloads from one snapshot…'),
    ).toBeVisible();
  },
};
export const Downloading: Story = {
  parameters: {
    api: {
      ...api,
      [`POST /api/admin/diagnostics/feedback/${feedbackPair.id}/download`]: pending(),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(await within(dialog).findByText('Downloading user metrics…')).toBeVisible();
    await expect(
      within(dialog).getByRole('button', { name: 'Download system metrics' }),
    ).toBeDisabled();
  },
};
export const Cancelled: Story = {
  parameters: { api: { ...api, 'POST /api/admin/diagnostics/feedback/prepare': pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Cancel download' }));
    await expect(
      within(dialog).getByText(/Preparation and pending download cancelled/),
    ).toBeVisible();
    await expect(
      within(dialog).getByRole('button', { name: 'Prepare both downloads' }),
    ).toBeEnabled();
  },
};
export const EmptySelection: Story = {
  parameters: {
    api: {
      ...api,
      'POST /api/admin/diagnostics/feedback/prepare': {
        state: 'empty',
        generation: feedbackGeneration,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(await within(dialog).findByText(/No retained records remain/)).toBeVisible();
    await expect(
      within(dialog).getByRole('button', { name: 'Download system metrics' }),
    ).toBeDisabled();
  },
};
export const OldFeedbackOnly: Story = {
  parameters: {
    api: {
      ...api,
      'POST /api/admin/diagnostics/feedback/prepare': {
        ...feedbackPair,
        context: 'feedback-only',
        counts: { user: 1, system: 1, userObservations: 0, systemObservations: 0 },
        window: { start: feedbackPair.window.start, end: feedbackPair.window.start },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(
      await within(dialog).findByText(/Only feedback remains for this account/),
    ).toBeVisible();
  },
};
export const Expired: Story = {
  parameters: {
    api: {
      ...api,
      [`POST /api/admin/diagnostics/feedback/${feedbackPair.id}/download`]: failure('expired', 410),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'expired or diagnostics were cleared',
    );
    await expect(
      within(dialog).getByRole('button', { name: 'Prepare both downloads' }),
    ).toBeEnabled();
    await expect(
      within(dialog).getByRole('button', { name: 'Download system metrics' }),
    ).toBeDisabled();
  },
};
export const PrepareFailed: Story = {
  parameters: {
    api: {
      ...api,
      'POST /api/admin/diagnostics/feedback/prepare': failure('private storage path', 503),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'could not be completed',
    );
    await expect(within(dialog).queryByText('private storage path')).not.toBeInTheDocument();
  },
};
export const DownloadFailed: Story = {
  parameters: {
    api: {
      ...api,
      [`POST /api/admin/diagnostics/feedback/${feedbackPair.id}/download`]: failure(
        'private snapshot path',
        503,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Its snapshot is no longer available',
    );
    await expect(
      within(dialog).getByRole('button', { name: 'Download user metrics' }),
    ).toBeDisabled();
    await expect(
      within(dialog).getByRole('button', { name: 'Download system metrics' }),
    ).toBeDisabled();
    await expect(within(dialog).queryByLabelText('Shared time span')).not.toBeInTheDocument();
    await expect(
      within(dialog).getByRole('button', { name: 'Prepare both downloads' }),
    ).toBeEnabled();
  },
};
export const AccessChanged: Story = {
  parameters: {
    api: {
      ...api,
      'POST /api/admin/diagnostics/feedback/prepare': failure('private operator', 403),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Operator access is unavailable',
    );
  },
};
export const CloseRestoresFocus: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const dialog = await openDownloads(canvasElement);
    await within(dialog).findByText('User metrics sent to your browser. Check your downloads.');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Close$/ }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await expect(
      within(canvasElement).getByRole('button', { name: 'Feedback downloads for Alex Kim' }),
    ).toHaveFocus();
  },
};
