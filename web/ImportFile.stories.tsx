import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { ImportFile } from './ImportFile.tsx';

const meta = {
  title: 'Dashboard/ImportFile',
  component: ImportFile,
  // Dropping a file anywhere in the folder also imports; stories use the picker.
  args: { parentId: null, dropTarget: { current: null }, enabled: true, onImported: () => {} },
} satisfies Meta<typeof ImportFile>;
export default meta;
type Story = StoryObj<typeof meta>;

const pick = async (canvasElement: HTMLElement, ...files: File[]) => {
  const input = within(canvasElement).getByLabelText<HTMLInputElement>('Univer file', {
    selector: 'input',
  });
  // The picker takes one file, but a drop can carry several. Let the test send more than one.
  input.multiple = files.length > 1;
  await userEvent.upload(input, files, { applyAccept: false });
};
const snapshot = JSON.stringify({ id: 'sheet-1', sheets: {} });
const univerFile = () => new File([snapshot], 'budget.univer.json', { type: 'application/json' });

export const Default: Story = {};
/** The limits disclosure is closed by default. */
export const LimitsOpen: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector('details')?.setAttribute('open', '');
  },
};
export const UnsupportedFile: Story = {
  play: ({ canvasElement }) => pick(canvasElement, new File(['%PDF'], 'budget.pdf')),
};
export const NotJson: Story = {
  play: ({ canvasElement }) => pick(canvasElement, new File(['not json'], 'budget.json')),
};
export const TooManyFiles: Story = {
  play: ({ canvasElement }) =>
    pick(canvasElement, univerFile(), new File([snapshot], 'trip.univer.json')),
};
/** The picker and button stay disabled while the server reads the file. */
export const Importing: Story = {
  parameters: { api: { 'POST /api/items/import': pending() } },
  play: ({ canvasElement }) => pick(canvasElement, univerFile()),
};
export const ImportFailed: Story = {
  parameters: {
    api: { 'POST /api/items/import': failure('This file is not a Spinel-compatible Univer file.') },
  },
  play: ({ canvasElement }) => pick(canvasElement, univerFile()),
};
