import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';
import { MobileSheetCellBar } from './MobileSheetCellBar.tsx';
import type { MobileSheetCell } from './mobileSheetCell.ts';
import './space.css';

function Example({
  text = '=SUM(A:A)',
  editable = true,
  viewable = true,
  editing = false,
  space = false,
}: {
  text?: string;
  editable?: boolean;
  viewable?: boolean;
  editing?: boolean;
  space?: boolean;
}) {
  const [activated, setActivated] = useState(false);
  const cell: MobileSheetCell = {
    identity: 'fixture/B5',
    address: 'B5',
    text,
    editable,
    viewable,
    editing,
  };
  const content = (
    <section className="sheet-editor" data-cell-bar="true">
      <MobileSheetCellBar cell={cell} onEdit={() => setActivated(true)} />
      {activated && <p role="status">Native editing requested</p>}
    </section>
  );
  return (
    <div style={{ width: '100%', maxWidth: 390 }}>
      {space ? <div className="space-native-editor">{content}</div> : content}
    </div>
  );
}

const meta = {
  title: 'Editor/Mobile Sheet cell',
  component: Example,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Formula: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Read B5' })).toHaveTextContent('=SUM(A:A)');
    await userEvent.click(canvas.getByRole('button', { name: 'Edit B5' }));
    await expect(canvas.getByRole('status')).toHaveTextContent('Native editing requested');
  },
};
export const Empty: Story = { args: { text: '' } };
export const Literal: Story = { args: { text: '71' } };
export const Space: Story = {
  args: { space: true },
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector('.sheet-editor')!.getBoundingClientRect();
    const bar = canvasElement.querySelector('.mobile-sheet-cell-slot')!.getBoundingClientRect();
    await expect(bar.left).toBe(host.left);
    await expect(bar.width).toBe(host.width);
  },
};
export const NativeEditing: Story = {
  args: { editing: true },
  play: async ({ canvasElement }) => {
    // The native editor occupies the reserved slot in the real Sheet. This
    // component must not leave a competing entry point or input underneath it.
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
    await expect(canvasElement.querySelector('.mobile-sheet-cell-slot')).toHaveStyle({
      height: '52px',
    });
  },
};
export const LongText: Story = {
  args: { text: 'A long note stays readable without widening the Sheet. '.repeat(12) },
};
export const LongTextOpen: Story = {
  args: LongText.args,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Read B5' }));
    const popup = within(canvasElement.ownerDocument.body);
    await expect(popup.getByRole('heading', { name: 'B5' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Close' })).toBeVisible();
  },
};
export const ViewOnly: Story = {
  args: { editable: false, text: 'A long view-only note remains available in full. '.repeat(8) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Edit B5' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Read B5' }));
    const popup = within(canvasElement.ownerDocument.body);
    await expect(popup.getByRole('heading', { name: 'B5' })).toBeVisible();
    await userEvent.click(popup.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Read B5' })).toHaveFocus());
  },
};
export const Protected: Story = {
  args: { editable: false, viewable: false, text: 'Private fixture content' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Private fixture content')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};
