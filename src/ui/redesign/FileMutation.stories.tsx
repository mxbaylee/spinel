import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DashboardMockup } from './Mockups.tsx';

const meta = {
  title: 'Redesign/File mutations',
  component: DashboardMockup,
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Local pending and failure fixtures. Retry applies the retained draft to sample files only; no server request runs.',
      },
    },
  },
} satisfies Meta<typeof DashboardMockup>;
export default meta;
type Story = StoryObj<typeof meta>;

async function checkPending(canvasElement: HTMLElement, field: string, value: string) {
  const page = within(canvasElement.ownerDocument.body);
  const dialog = within(page.getByRole('dialog'));
  const input = dialog.getByLabelText(field);
  await expect(input).toBeDisabled();
  if (field === 'Name') await expect(input).toHaveValue(value);
  else await expect(input).toHaveTextContent(value);
  await expect(dialog.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  await expect(page.getByRole('dialog')).toBeVisible();
}
export const CreatePending: Story = {
  args: { fileMutation: 'create-pending' },
  play: ({ canvasElement }) => checkPending(canvasElement, 'Name', 'Weekend notes'),
};
export const CreateFailed: Story = { args: { fileMutation: 'create-error' } };
export const RenamePending: Story = {
  args: { fileMutation: 'rename-pending' },
  play: ({ canvasElement }) => checkPending(canvasElement, 'Name', 'Autumn plans revised'),
};
export const RenameFailed: Story = { args: { fileMutation: 'rename-error' } };
export const MovePending: Story = {
  args: { fileMutation: 'move-pending' },
  play: ({ canvasElement }) => checkPending(canvasElement, 'Destination folder', 'Work'),
};
export const MoveFailed: Story = { args: { fileMutation: 'move-error' } };
export const FileIntoFolderPending: Story = {
  args: { fileMutation: 'file-pending' },
  play: ({ canvasElement }) => checkPending(canvasElement, 'Destination folder', 'Work'),
};
export const FileIntoFolderFailed: Story = { args: { fileMutation: 'file-error' } };
export const RetryCreate: Story = {
  args: { fileMutation: 'create-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const dialog = within(page.getByRole('dialog', { name: 'New Doc' }));
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Weekend notes');
    await expect(dialog.getByRole('alert')).toHaveTextContent('no file was created');
    await expect(canvasElement.querySelector('.rd-file-list')?.textContent).not.toContain(
      'Weekend notes',
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull());
    await expect(
      canvas.getByRole('button', { name: 'More actions for Weekend notes' }),
    ).toBeVisible();
  },
};
export const RetryRename: Story = {
  args: { fileMutation: 'rename-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const dialog = within(page.getByRole('dialog', { name: 'Rename · Autumn plans' }));
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Autumn plans revised');
    await expect(dialog.getByRole('alert')).toHaveTextContent('original name is unchanged');
    await expect(canvasElement.querySelector('.rd-file-list')?.textContent).not.toContain(
      'Autumn plans revised',
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    await expect(
      canvas.getByRole('button', { name: 'More actions for Autumn plans revised' }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole('button', { name: 'More actions for Autumn plans' }),
    ).toBeNull();
  },
};
async function retryPlacement(canvasElement: HTMLElement, file: string) {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  const dialog = within(page.getByRole('dialog'));
  await expect(dialog.getByLabelText('Destination folder')).toHaveTextContent('Work');
  await expect(dialog.getByRole('alert')).toHaveTextContent('location is unchanged');
  await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
  await userEvent.click(
    within(canvas.getByRole('list', { name: 'Files' })).getByRole('button', { name: /^Work / }),
  );
  await expect(canvas.getByRole('heading', { name: 'Work' })).toBeVisible();
  await expect(canvas.getByRole('button', { name: `More actions for ${file}` })).toBeVisible();
}
export const RetryMove: Story = {
  args: { fileMutation: 'move-error' },
  play: ({ canvasElement }) => retryPlacement(canvasElement, 'Autumn plans'),
};
export const RetryFileIntoFolder: Story = {
  args: { fileMutation: 'file-error' },
  play: async ({ canvasElement }) => {
    await retryPlacement(canvasElement, 'Quarterly budget');
    const canvas = within(canvasElement);
    // Filing a reference must retain the owner's name and the recipient's access.
    const row = canvas.getByRole('button', { name: /^Quarterly budget / });
    await expect(row).toHaveTextContent('Shared · Can edit');
    await expect(row).toHaveTextContent('Owner: Alex Kim');
  },
};
export const CancelFailedRename: Story = {
  args: { fileMutation: 'rename-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(page.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await expect(
      canvas.getByRole('button', { name: 'More actions for Autumn plans' }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole('button', { name: 'More actions for Autumn plans revised' }),
    ).toBeNull();
  },
};
async function cancelPlacement(canvasElement: HTMLElement, file: string, folder: string) {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(page.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  await userEvent.click(
    within(canvas.getByRole('list', { name: 'Files' })).getByRole('button', {
      name: new RegExp(`^${folder} `),
    }),
  );
  await expect(canvas.getByRole('button', { name: `More actions for ${file}` })).toBeVisible();
}
export const FailedMoveKeepsOriginalFolder: Story = {
  args: { fileMutation: 'move-error' },
  play: ({ canvasElement }) => cancelPlacement(canvasElement, 'Autumn plans', 'Trips'),
};
export const FailedFilingKeepsOriginalPlacement: Story = {
  args: { fileMutation: 'file-error' },
  play: ({ canvasElement }) => cancelPlacement(canvasElement, 'Quarterly budget', 'Household'),
};
