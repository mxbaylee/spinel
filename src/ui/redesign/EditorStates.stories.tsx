import type { Meta, StoryObj } from '@storybook/react-vite';
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
