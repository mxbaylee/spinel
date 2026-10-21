import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from './Controls.tsx';
import { ImportDialog } from './ImportReview.tsx';
import type { ImportReviewState } from './ImportReview.tsx';
import './mockups.css';

function Preview({ state = 'ready' }: { state?: ImportReviewState }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="sp-ui rd-dialog-stage">
      <Button onClick={() => setOpen(true)}>Import file…</Button>
      <ImportDialog open={open} onOpenChange={setOpen} destination="Household" state={state} />
    </div>
  );
}
const meta = {
  title: 'Redesign/Import file',
  component: Preview,
  parameters: { shell: 'none', layout: 'fullscreen' },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const LimitsOpen: Story = { args: { state: 'limits-open' } };
export const UnsupportedFile: Story = { args: { state: 'unsupported-file' } };
export const NotJson: Story = { args: { state: 'not-json' } };
export const TooManyFiles: Story = { args: { state: 'too-many-files' } };
export const Importing: Story = {
  args: { state: 'importing' },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', {
      name: 'Import a Univer file',
    });
    await expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    await expect(within(dialog).getByRole('button', { name: /^Close$/ })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByRole('status')).toHaveTextContent('Keep this dialog open.');
  },
};
export const ImportFailed: Story = { args: { state: 'import-failed' } };
/** A completed sample import; no file is sent to a server by this fixture. */
export const Completed: Story = { args: { state: 'completed' } };
