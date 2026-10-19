import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { failure } from '../.storybook/api.ts';
import { FileExports } from './FileExports.tsx';

const id = '00000000-0000-4000-8000-000000000061';
const meta = {
  title: 'Editor/FileExports',
  component: FileExports,
  args: { id, name: 'Quarterly budget', saved: true, print: async () => {} },
  // The menu is a closed disclosure in the editor toolbar; stories show it open.
  play: ({ canvasElement }) => {
    canvasElement.querySelector('details')?.setAttribute('open', '');
  },
} satisfies Meta<typeof FileExports>;
export default meta;
type Story = StoryObj<typeof meta>;

const click = async (canvasElement: HTMLElement, name: string) => {
  canvasElement.querySelector('details')?.setAttribute('open', '');
  await userEvent.click(within(canvasElement).getByRole('button', { name }));
};

export const Saved: Story = {};
/** Both actions are disabled until pending changes have saved. */
export const Unsaved: Story = { args: { saved: false } };
export const DownloadFailed: Story = {
  parameters: {
    api: { [`GET /api/items/${id}/export`]: failure('This file is too large to export.', 413) },
  },
  play: ({ canvasElement }) => click(canvasElement, 'Download Univer file'),
};
export const PrintFailed: Story = {
  args: {
    print: async () => {
      throw new Error('Could not open printing.');
    },
  },
  play: ({ canvasElement }) => click(canvasElement, 'Print / save PDF'),
};
