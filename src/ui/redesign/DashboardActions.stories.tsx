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
    within(canvasElement.ownerDocument.body).getByRole('menuitem', { name: action }),
  );
}
export const CreateDoc: Story = {
  render: () => <DashboardMockup />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'New file' }));
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('menuitem', { name: 'Doc' }),
    );
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
export const Share: Story = {
  render: () => <DashboardMockup />,
  play: ({ canvasElement }) => openFileAction(canvasElement, 'Autumn plans', 'Share…'),
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
      await userEvent.click(portal.getByRole('menuitem', { name: 'Delete permanently…' }));
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
