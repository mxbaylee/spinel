import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ActionMenu, Button, Choice, DetailsPopover, Modal } from './Controls.tsx';
import './mockups.css';
import { AppearanceChoice } from './ThemeMenu.tsx';
function Controls({ disabled = false, error = false }: { disabled?: boolean; error?: boolean }) {
  const [value, setValue] = useState('system');
  const [kind, setKind] = useState('doc');
  const [message, setMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [folder, setFolder] = useState('household');
  return (
    <div className="sp-ui rd-dialog-stage">
      <section className="rd-dialog-example">
        <h1>Quiet, familiar controls</h1>
        <p className="sp-muted">One emphasis. Clear labels. Room to touch.</p>
        <div className="rd-form">
          <Button
            primary
            disabled={disabled}
            onClick={() => setMessage(error ? 'Could not save. Try again.' : 'Saved.')}
          >
            Save changes
          </Button>
          <Choice
            label="File type"
            value={kind}
            onChange={setKind}
            disabled={disabled}
            options={[
              { value: 'doc', label: 'Doc' },
              { value: 'sheet', label: 'Sheet' },
              { value: 'space', label: 'Space' },
            ]}
          />
          <AppearanceChoice value={value} onChange={setValue} disabled={disabled} />
          <ActionMenu
            label="File actions"
            actions={[
              { label: 'Rename', onClick: () => setMessage('Rename selected.') },
              { label: 'Move', disabled },
              { label: 'Trash', destructive: true, onClick: () => setMessage('Moved to Trash.') },
            ]}
          >
            File actions ⌄
          </ActionMenu>
          <Modal
            icon="folder"
            trigger="Open confirmation"
            title="Move this file?"
            description="Choose the folder where this file belongs."
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
          >
            <Choice
              label="Destination folder"
              value={folder}
              onChange={setFolder}
              options={[
                { value: 'household', label: 'Household' },
                { value: 'work', label: 'Work' },
              ]}
            />
            <div className="sp-actions">
              <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button
                primary
                onClick={() => {
                  setMessage(`Moved to ${folder === 'household' ? 'Household' : 'Work'}.`);
                  setConfirmOpen(false);
                }}
              >
                Move file
              </Button>
            </div>
          </Modal>
          <DetailsPopover label={error ? 'Not saved' : disabled ? 'Loading…' : '✓ Saved'}>
            <p>
              {error
                ? 'Could not save. Try again.'
                : disabled
                  ? 'Wait for the document to finish loading.'
                  : 'All changes are saved. You’re connected.'}
            </p>
          </DetailsPopover>
          {disabled && <p className="sp-muted">Wait for the document to finish loading.</p>}
          {error && <p role="alert">Could not save. Try again.</p>}
          <p role="status">{message}</p>
        </div>
      </section>
    </div>
  );
}
const meta = {
  id: 'redesign-controls',
  title: 'Current production/Controls',
  component: Controls,
  parameters: { shell: 'none' },
} satisfies Meta<typeof Controls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Error: Story = { args: { error: true } };

export const LongModalTitle: Story = {
  render: () => (
    <div className="sp-ui rd-dialog-stage">
      <Modal
        icon="trash"
        trigger="Open removal dialog"
        title="Delete the household planning folder and all its contents permanently?"
        description="This is a layout example. Nothing will be deleted."
      >
        <p>Long titles wrap beside the icon while the close button stays available.</p>
      </Modal>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = page.getByRole('button', { name: 'Open removal dialog' });
    await userEvent.click(trigger);
    const title = 'Delete the household planning folder and all its contents permanently?';
    const dialog = await page.findByRole('dialog', { name: title });
    await expect(within(dialog).getByRole('heading', { name: title })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    // Base UI returns focus after its closing transition has completed.
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
  },
};
