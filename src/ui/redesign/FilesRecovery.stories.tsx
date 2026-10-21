import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { DashboardMockup } from './Mockups.tsx';

const meta = {
  title: 'Redesign/File recovery',
  component: DashboardMockup,
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Member retrieval and Trash states, using local fixtures only. Offline specimens do not read or write device storage; retry does not contact a server.',
      },
    },
  },
} satisfies Meta<typeof DashboardMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SharedLoading: Story = { args: { state: 'shared-loading' } };
export const SharedError: Story = { args: { state: 'shared-error' } };
export const SharedUnknownOwner: Story = { args: { state: 'shared-unknown-owner' } };
export const SearchPending: Story = {
  args: { state: 'search-pending' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Searching… Matches from the loaded/)).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'More actions for Quarterly budget' }),
    ).toBeVisible();
  },
};
export const SearchError: Story = { args: { state: 'search-error' } };
export const LocalMode: Story = {
  args: { state: 'local' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const files = within(canvas.getByRole('list', { name: 'Files' }));
    await expect(canvas.getByText(/Files as of October 19/)).toBeVisible();
    await expect(files.getByRole('button', { name: /^Autumn plans / })).toBeDisabled();
    await expect(files.getByRole('button', { name: /^Quarterly budget / })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'New file' })).toBeNull();
    await expect(
      canvas.queryByRole('button', { name: 'More actions for Quarterly budget' }),
    ).toBeNull();
  },
};
export const LocalNoData: Story = { args: { state: 'local-no-data' } };
export const LocalNavigationKeepsPinActionsDisabled: Story = {
  args: { state: 'local', collapsed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      canvas.getByRole('button', { name: 'Offline — not connected to Spinel' }),
    ).toBeVisible();
    // On phone this opens the navigation dialog; desktop expands the same sidebar.
    await userEvent.click(canvas.getByRole('button', { name: 'Expand navigation' }));
    const navigation = page.queryByRole('dialog', { name: 'Browse files' });
    const scope = navigation ? within(navigation) : page;
    const pins = within(scope.getByRole('region', { name: 'Pinned items' }));
    await userEvent.click(pins.getByRole('button', { name: 'Pin actions for Quarterly budget' }));
    await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByRole('menuitem', { name: 'Unpin' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};
export const LocalFolderNotOpened: Story = { args: { state: 'local-folder' } };
export const TrashLoading: Story = { args: { state: 'trash-loading' } };
export const TrashError: Story = { args: { state: 'trash-error' } };
export const TrashExpired: Story = { args: { state: 'trash-expired' } };
export const EmptyTrashConfirmation: Story = { args: { state: 'trash-empty-confirm' } };
export const EmptyTrashPending: Story = { args: { state: 'trash-empty-pending' } };
export const EmptyTrashFailed: Story = { args: { state: 'trash-empty-error' } };
export const RestorePending: Story = { args: { state: 'trash-restore-pending' } };
export const RestoreFailed: Story = { args: { state: 'trash-restore-error' } };
export const DeletePending: Story = { args: { state: 'trash-delete-pending' } };
export const DeleteFailed: Story = { args: { state: 'trash-delete-error' } };
export const RetrySearch: Story = {
  args: { state: 'search-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('list', { name: 'Files' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry search' }));
    await expect(canvas.getByRole('textbox', { name: 'Search files' })).toHaveValue('budget');
    await expect(
      canvas.getByRole('button', { name: 'More actions for Quarterly budget' }),
    ).toBeVisible();
  },
};
export const RetryShared: Story = {
  args: { state: 'shared-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getAllByText('· Owner: Alex Kim')).toHaveLength(2);
  },
};
export const RetryTrash: Story = {
  args: { state: 'trash-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.getByRole('button', { name: 'Empty trash' })).toBeEnabled();
    await expect(
      within(canvas.getByRole('list', { name: 'Files' })).getAllByRole('listitem'),
    ).toHaveLength(3);
  },
};
export const RetryRestore: Story = {
  args: { state: 'trash-restore-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('It is still in Trash');
    await expect(
      within(canvas.getByRole('list', { name: 'Files' })).getAllByRole('listitem'),
    ).toHaveLength(3);
    await userEvent.click(canvas.getByRole('button', { name: 'Retry restore' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(
      within(canvas.getByRole('list', { name: 'Files' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    await expect(
      canvas.queryByRole('button', { name: 'More actions for Old Autumn plans' }),
    ).toBeNull();
  },
};
export const RetryDelete: Story = {
  args: { state: 'trash-delete-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = within(
      await portal.findByRole('dialog', { name: 'Delete “Old Autumn plans” permanently?' }),
    );
    await expect(dialog.getByRole('alert')).toHaveTextContent('It is still in Trash');
    await expect(canvasElement.querySelectorAll('.rd-file-list > [role="listitem"]')).toHaveLength(
      3,
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    const files = await canvas.findByRole('list', { name: 'Files' });
    await expect(within(files).getAllByRole('listitem')).toHaveLength(2);
    await expect(
      canvas.queryByRole('button', { name: 'More actions for Old Autumn plans' }),
    ).toBeNull();
  },
};
export const RetryEmptyTrash: Story = {
  args: { state: 'trash-empty-error' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = within(await portal.findByRole('dialog', { name: 'Empty Trash permanently?' }));
    await expect(dialog.getByRole('alert')).toHaveTextContent(
      'All listed files are still in Trash',
    );
    await expect(
      within(dialog.getByRole('list', { name: 'Files to delete permanently' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(3);
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    await expect(await portal.findByRole('heading', { name: 'Trash is empty' })).toBeVisible();
    await expect(portal.getByRole('button', { name: 'Empty trash' })).toBeDisabled();
  },
};
export const CancelEmptyTrash: Story = {
  args: { state: 'trash-empty-confirm' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = within(await portal.findByRole('dialog', { name: 'Empty Trash permanently?' }));
    await expect(dialog.getByText(/You cannot undo this/)).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    const files = await portal.findByRole('list', { name: 'Files' });
    await expect(within(files).getAllByRole('listitem')).toHaveLength(3);
  },
};
export const ExpiredRestoreUnavailable: Story = {
  args: { state: 'trash-expired' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText('Recovery expired')).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Old Notes for next week' }),
    );
    await expect(await portal.findByRole('menuitem', { name: 'Restore' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};
