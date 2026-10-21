import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { EditorMockup, HistoryMockup } from './Mockups.tsx';

const meta = {
  title: 'Redesign/Editor recovery',
  parameters: { shell: 'none', layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const HistoryLoading: Story = { render: () => <HistoryMockup state="loading" /> };
export const HistoryEmpty: Story = { render: () => <HistoryMockup state="empty" /> };
export const HistoryError: Story = { render: () => <HistoryMockup state="error" /> };
export const ExportPreparing: Story = { render: () => <EditorMockup exportState="loading" /> };
export const ExportFailed: Story = { render: () => <EditorMockup exportState="error" /> };
export const ExportPdfFailed: Story = { render: () => <EditorMockup exportState="print-error" /> };
export const ExportUnsaved: Story = {
  render: () => <EditorMockup exportState="open" saveState="saving" />,
  play: async ({ canvasElement }) => {
    for (const name of ['Univer file', 'PDF'])
      await expect(within(canvasElement).getByRole('button', { name })).toBeDisabled();
  },
};
export const ExportOffline: Story = { render: () => <EditorMockup exportState="open" offline /> };
export const ExportPdfRetry: Story = {
  render: () => <EditorMockup exportState="print-error" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'PDF' }));
    await expect(canvas.getByText('PDF export requested in this preview.')).toBeVisible();
    await expect(canvas.queryByText(/Could not open the PDF print dialog/)).not.toBeInTheDocument();
  },
};

export const OfflineSaveFailed: Story = {
  render: () => <EditorMockup offline saveState="failed" />,
};
