import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { failure } from '../.storybook/api.ts';
import { FileExports } from './FileExports.tsx';

const id = '00000000-0000-4000-8000-000000000061';
const meta = {
  id: 'editor-fileexports',
  title: 'Current production/Editor/FileExports',
  component: FileExports,
  args: { id, name: 'Quarterly budget', saved: true },
  // The menu is a closed disclosure in the editor toolbar; stories show it open.
  play: ({ canvasElement }) => {
    canvasElement.querySelector('details')?.setAttribute('open', '');
  },
} satisfies Meta<typeof FileExports>;
export default meta;
type Story = StoryObj<typeof meta>;

const click = async (canvasElement: HTMLElement, name: string) => {
  canvasElement.querySelector('details')?.setAttribute('open', '');
  const button = within(canvasElement).getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
};

export const Saved: Story = {
  parameters: { api: { [`GET /api/items/${id}/pdf`]: { kind: 'doc' } } },
};
/** Both actions are disabled until pending changes have saved. */
export const Unsaved: Story = { args: { saved: false } };
export const DownloadFailed: Story = {
  parameters: {
    api: {
      [`GET /api/items/${id}/pdf`]: { kind: 'doc' },
      [`GET /api/items/${id}/export`]: failure('This file is too large to export.', 413),
    },
  },
  play: ({ canvasElement }) => click(canvasElement, 'Download Univer file'),
};
export const PdfFailed: Story = {
  parameters: {
    api: {
      [`GET /api/items/${id}/pdf`]: { kind: 'doc' },
      [`POST /api/items/${id}/pdf`]: failure('Could not export this PDF. Try again.', 422),
    },
  },
  play: ({ canvasElement }) => click(canvasElement, 'Export as PDF'),
};
