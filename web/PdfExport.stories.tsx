import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { failure, fileReply, pending } from '../.storybook/api.ts';
import { PdfExport } from './PdfExport.tsx';

const id = '00000000-0000-4000-8000-000000000075';
const get = `GET /api/items/${id}/pdf`;
const post = `POST /api/items/${id}/pdf`;
const sheets = {
  kind: 'sheet',
  worksheets: [
    { id: 'budget', name: 'Budget' },
    { id: 'planning', name: 'Planning — a longer worksheet name that still fits on a phone' },
    { id: 'archive', name: 'Archive' },
  ],
};
const meta = {
  id: 'editor-pdfexport',
  title: 'Current production/Editor/PdfExport',
  component: PdfExport,
  args: { id, name: 'Quarterly budget', saved: true },
} satisfies Meta<typeof PdfExport>;
export default meta;
type Story = StoryObj<typeof meta>;

async function start(canvasElement: HTMLElement) {
  const button = within(canvasElement).getByRole('button', { name: 'Export as PDF' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

export const Document: Story = { parameters: { api: { [get]: { kind: 'doc' } } } };
export const AllVisibleWorksheets: Story = {
  parameters: { api: { [get]: sheets } },
  play: async ({ canvasElement }) => {
    for (const sheet of sheets.worksheets)
      await expect(
        await within(canvasElement).findByRole('checkbox', { name: sheet.name }),
      ).toBeChecked();
  },
};
export const WorksheetSubset: Story = {
  parameters: { api: { [get]: sheets } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('checkbox', { name: 'Archive' }));
    await expect(
      within(canvasElement).getByRole('checkbox', { name: 'Archive' }),
    ).not.toBeChecked();
    await expect(within(canvasElement).getByRole('checkbox', { name: 'Budget' })).toBeChecked();
  },
};
export const NoWorksheetsSelected: Story = {
  parameters: { api: { [get]: sheets } },
  play: async ({ canvasElement }) => {
    for (const sheet of sheets.worksheets)
      await userEvent.click(
        await within(canvasElement).findByRole('checkbox', { name: sheet.name }),
      );
    await expect(
      within(canvasElement).getByRole('button', { name: 'Export as PDF' }),
    ).toBeDisabled();
  },
};
export const NoVisibleWorksheets: Story = {
  parameters: { api: { [get]: { kind: 'sheet', worksheets: [] } } },
};
export const WaitingForSave: Story = { args: { saved: false } };
export const LoadingOptions: Story = { parameters: { api: { [get]: pending() } } };
export const OptionsFailed: Story = {
  parameters: { api: { [get]: failure('Could not load PDF options. Try again.', 503) } },
};
export const Preparing: Story = {
  parameters: { api: { [get]: sheets, [post]: pending() } },
  play: async ({ canvasElement }) => {
    await start(canvasElement);
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Preparing PDF…');
    await expect(
      within(canvasElement).getByRole('button', { name: 'Cancel export' }),
    ).toBeEnabled();
  },
};
export const Cancelled: Story = {
  parameters: { api: { [get]: sheets, [post]: pending() } },
  play: async ({ canvasElement }) => {
    await start(canvasElement);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Cancel export' }));
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Export cancelled.');
    await expect(
      within(canvasElement).getByRole('button', { name: 'Export as PDF' }),
    ).toBeEnabled();
  },
};
export const ExportFailed: Story = {
  parameters: {
    api: {
      [get]: sheets,
      [post]: failure('This PDF exceeds the export limit. Try fewer worksheets.', 413),
    },
  },
  play: ({ canvasElement }) => start(canvasElement),
};
export const DownloadStarted: Story = {
  parameters: {
    api: {
      [get]: { kind: 'doc' },
      [post]: fileReply('%PDF-1.7\n%%EOF', 'application/pdf', 'Quarterly budget.pdf'),
    },
  },
  play: async ({ canvasElement }) => {
    await start(canvasElement);
    await waitFor(() =>
      expect(within(canvasElement).getByRole('status')).toHaveTextContent('PDF download started.'),
    );
  },
};
