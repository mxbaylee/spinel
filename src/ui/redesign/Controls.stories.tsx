import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ActionMenu, Button, Choice, DetailsPopover, Modal } from './Controls.tsx';
import './mockups.css';
import { AppearanceChoice } from './Mockups.tsx';
function Controls({ disabled = false, error = false }: { disabled?: boolean; error?: boolean }) {
  const [value, setValue] = useState('system');
  const [message, setMessage] = useState('');
  return (
    <div className="sp-ui rd-dialog-stage">
      <section className="rd-dialog-example">
        <h1>Quiet, familiar controls</h1>
        <p className="sp-muted">One emphasis. Clear labels. Room to touch.</p>
        <div className="rd-form">
          <Button primary disabled={disabled} onClick={() => setMessage('Saved.')}>
            Save changes
          </Button>
          <Choice
            label="Appearance"
            value={value}
            onChange={setValue}
            disabled={disabled}
            options={[
              { value: 'system', label: 'Follow system' },
              { value: 'light', label: 'Vintage · Light' },
              { value: 'dark', label: 'Modern · Dark' },
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
            trigger="Open confirmation"
            title="Move this file to Trash?"
            description="You can restore it later."
          >
            <Choice
              label="Example nested selector"
              value={value}
              onChange={setValue}
              options={[
                { value: 'system', label: 'Follow system' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
            <p>Focus stays in this dialog. Escape closes it.</p>
          </Modal>
          <DetailsPopover label="✓ Saved">
            <p>All changes are saved. You’re connected.</p>
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
  title: 'Redesign/Controls',
  component: Controls,
  parameters: { shell: 'none' },
} satisfies Meta<typeof Controls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Error: Story = { args: { error: true } };
