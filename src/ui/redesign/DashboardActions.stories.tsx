import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { DashboardMockup } from './Mockups.tsx';

const meta = {
  title: 'Redesign/File dialogs',
  parameters: { shell: 'none', layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

async function openFileAction(canvasElement: HTMLElement, file: string, action: string) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: `More actions for ${file}` }),
  );
  await userEvent.click(
    await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: action }),
  );
  await expect(
    await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: `${action.replace('…', '')} · ${file}`,
    }),
  ).toBeVisible();
}
export const CreateDoc: Story = {
  render: () => <DashboardMockup />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'New file' }));
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Doc' }),
    );
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New Doc' }),
    ).toBeVisible();
  },
};
export const Rename: Story = {
  render: () => <DashboardMockup />,
  play: ({ canvasElement }) => openFileAction(canvasElement, 'Autumn plans', 'Rename…'),
};
export const Move: Story = {
  render: () => <DashboardMockup />,
  play: ({ canvasElement }) => openFileAction(canvasElement, 'Autumn plans', 'Move…'),
};
export const FileIntoFolder: Story = {
  render: () => <DashboardMockup />,
  play: ({ canvasElement }) =>
    openFileAction(canvasElement, 'Quarterly budget', 'File into folder…'),
};
export const Tags: Story = {
  render: () => <DashboardMockup />,
  play: ({ canvasElement }) => openFileAction(canvasElement, 'Autumn plans', 'Tags…'),
};
export const PersonalTagsAndExactFilter: Story = {
  render: () => <DashboardMockup />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await openFileAction(canvasElement, 'Autumn plans', 'Tags…');
    let dialog = within(portal.getByRole('dialog', { name: 'Tags · Autumn plans' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Tag' }), 'home, work');
    await userEvent.click(dialog.getByRole('button', { name: 'Add tag' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await openFileAction(canvasElement, 'Autumn plans', 'Tags…');
    dialog = within(portal.getByRole('dialog', { name: 'Tags · Autumn plans' }));
    // A comma is valid tag content; reopening must preserve one complete tag.
    await expect(dialog.getByRole('button', { name: 'Remove #home, work' })).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await userEvent.click(canvas.getByRole('button', { name: /^Filters / }));
    const filter = canvas.getByRole('textbox', { name: 'Tag' });
    await userEvent.type(filter, 'home');
    await expect(canvas.getByRole('heading', { name: 'No matching files' })).toBeVisible();
    await userEvent.clear(filter);
    await userEvent.type(filter, '#HOME, WORK');
    await expect(
      canvas.getByRole('button', { name: 'More actions for Autumn plans' }),
    ).toBeVisible();
  },
};
export const FolderHasNoTagsAction: Story = {
  render: () => <DashboardMockup />,
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for Household' }),
    );
    await expect(portal.queryByRole('menuitem', { name: 'Tags…' })).toBeNull();
  },
};
export const Share: Story = {
  render: () => <DashboardMockup />,
  play: ({ canvasElement }) => openFileAction(canvasElement, 'Autumn plans', 'Share…'),
};
export const FolderSharing: Story = {
  render: () => <DashboardMockup />,
  play: async ({ canvasElement }) => {
    await openFileAction(canvasElement, 'Household', 'Share…');
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', {
      name: 'Share · Household',
    });
    await expect(
      within(dialog).getByRole('combobox', { name: 'Alex’s direct access' }),
    ).toBeVisible();
    // Folder access is account-only; a folder never offers a public guest link.
    await expect(
      within(dialog).queryByRole('heading', { name: 'Anyone with the link' }),
    ).toBeNull();
    await expect(within(dialog).queryByRole('button', { name: 'Create link' })).toBeNull();
    await expect(within(dialog).getByText(/Folders cannot have guest links/)).toBeVisible();
  },
};

export const DeletePermanently: Story = {
  render: () => <DashboardMockup state="trash" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    const open = async () => {
      await userEvent.click(
        canvas.getByRole('button', { name: 'More actions for Old Autumn plans' }),
      );
      await userEvent.click(await portal.findByRole('menuitem', { name: 'Delete permanently…' }));
      await expect(
        await portal.findByRole('dialog', { name: 'Delete “Old Autumn plans” permanently?' }),
      ).toBeVisible();
    };
    await open();
    const confirmation = await portal.findByRole('dialog', {
      name: 'Delete “Old Autumn plans” permanently?',
    });
    await expect(
      within(confirmation).getByText(
        'This permanently removes “Old Autumn plans”. You cannot undo this or restore it from Trash.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      within(confirmation).getByRole('button', { name: 'Delete permanently' }),
    ).toBeVisible();
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await expect(
      canvas.getByRole('button', { name: 'More actions for Old Autumn plans' }),
    ).toBeVisible();
    await open();
  },
};

export const EmptyTrash: Story = { render: () => <DashboardMockup state="empty-trash" /> };
export const EmptyShared: Story = { render: () => <DashboardMockup state="empty-shared" /> };
