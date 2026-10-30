import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { CopyFileForm } from './CopyFile.tsx';

const id = '00000000-0000-4000-8000-000000000065';
const folder: WorkspaceItem = {
  id: '00000000-0000-4000-8000-000000000066',
  kind: 'folder',
  name: 'Household',
  parentId: null,
  access: 'owner',
  createdAt: 1,
  updatedAt: 1,
  tags: [],
};
const shared = {
  ...folder,
  id: '00000000-0000-4000-8000-000000000069',
  name: 'Trip planning',
  access: 'editor',
  ownerName: 'Alex Kim',
} satisfies WorkspaceItem;
const options = {
  name: 'October budget (copy)',
  parentId: folder.id,
  destinations: [folder, shared],
};
const api = { [`GET /api/items/${id}/copy-options`]: options };

function CopyDialog(args: React.ComponentProps<typeof CopyFileForm>) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Make a copy" icon="copy" open dismissDisabled={busy}>
      <CopyFileForm {...args} onBusy={setBusy} />
    </Modal>
  );
}
const meta = {
  id: 'dashboard-copyfile',
  title: 'Current production/Dashboard/Make a copy',
  component: CopyFileForm,
  render: (args) => <CopyDialog {...args} />,
  args: { id, onClose: fn(), onCreated: fn() },
  parameters: { api },
} satisfies Meta<typeof CopyFileForm>;
export default meta;
type Story = StoryObj<typeof meta>;

const dialog = (element: HTMLElement) =>
  within(element.ownerDocument.body).findByRole('dialog', { name: 'Make a copy' });
const ready: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const element = await dialog(canvasElement);
  await expect(await within(element).findByLabelText('Name')).toHaveValue('October budget (copy)');
  await assertDialogControls(element);
};

export const OwnedFolder: Story = { play: ready };
export const SharedViewer: Story = {
  parameters: {
    api: {
      [`GET /api/items/${id}/copy-options`]: {
        ...options,
        name: 'Shared recipe (copy)',
        parentId: null,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const element = await dialog(canvasElement);
    await expect(await within(element).findByLabelText('Folder')).toHaveValue('');
    await expect(
      within(element).getByText('Only you can open the copy until you share it.'),
    ).toBeVisible();
    await assertDialogControls(element);
  },
};
export const SharedDestination: Story = {
  play: async (context) => {
    await ready(context);
    const element = await dialog(context.canvasElement);
    await userEvent.selectOptions(within(element).getByLabelText('Folder'), shared.id);
    await expect(within(element).getByText(/This copy belongs to Alex Kim/)).toBeVisible();
    await assertDialogControls(element);
  },
};
export const Loading: Story = {
  parameters: { api: { [`GET /api/items/${id}/copy-options`]: pending() } },
  play: async ({ canvasElement }) => {
    const element = await dialog(canvasElement);
    await expect(within(element).getByRole('button', { name: 'Make a copy' })).toBeDisabled();
    await expect(within(element).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await assertDialogControls(element);
  },
};
export const WaitingForSave: Story = {
  args: { unavailable: 'Finish your edit and wait for changes to save before making a copy.' },
  play: async (context) => {
    await ready(context);
    await expect(
      within(await dialog(context.canvasElement)).getByRole('button', { name: 'Make a copy' }),
    ).toBeDisabled();
  },
};
export const Offline: Story = {
  args: { unavailable: 'Reconnect before making a copy.' },
  play: ready,
};
export const MakingCopy: Story = {
  parameters: { api: { ...api, [`POST /api/items/${id}/copy`]: pending() } },
  play: async (context) => {
    await ready(context);
    const element = await dialog(context.canvasElement);
    await userEvent.click(within(element).getByRole('button', { name: 'Make a copy' }));
    await expect(within(element).getByRole('button', { name: 'Making a copy…' })).toBeDisabled();
    await expect(within(element).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(within(element).getByRole('button', { name: 'Close dialog' })).toBeDisabled();
  },
};
export const SourceChanged: Story = {
  parameters: {
    api: {
      ...api,
      [`POST /api/items/${id}/copy`]: failure(
        'This document changed while the copy was being prepared. Try again.',
        409,
      ),
    },
  },
  play: async (context) => {
    await ready(context);
    const element = await dialog(context.canvasElement);
    await userEvent.click(within(element).getByRole('button', { name: 'Make a copy' }));
    await expect(await within(element).findByRole('alert')).toHaveTextContent(
      'This document changed',
    );
    await expect(within(element).getByRole('button', { name: 'Make a copy' })).toBeEnabled();
    await assertDialogControls(element);
  },
};
export const AccessLost: Story = {
  parameters: {
    api: { [`GET /api/items/${id}/copy-options`]: failure('This document is not available.', 404) },
  },
  play: async ({ canvasElement }) => {
    const element = await dialog(canvasElement);
    await expect(await within(element).findByRole('alert')).toHaveTextContent(
      'This document is not available.',
    );
    await expect(within(element).queryByLabelText('Name')).not.toBeInTheDocument();
    await assertDialogControls(element);
  },
};
