import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ActionMenu } from './Controls.tsx';
import './mockups.css';

// Only the pending SPN-066 panel survives; retired account mocks are not reachable.
function GuestLinksProposal() {
  const [notice, setNotice] = useState('');
  return (
    <section
      className="sp-ui"
      aria-label="Guest links proposal"
      style={{ padding: 24, maxWidth: 760 }}
    >
      <h1>Guest links</h1>
      <p className="sp-muted">
        Planned · Only links on files you own appear here. Secret addresses are never listed.
      </p>
      <div className="rd-setting-row">
        <span>
          <strong>Autumn plans</strong>
          <small>Doc · Can view · Enabled Oct 18 · Expires Oct 25</small>
        </span>
        <ActionMenu
          label="Autumn plans guest link actions"
          actions={[
            {
              label: 'Change expiry…',
              onClick: () =>
                setNotice(
                  'Expiry options: never, one day, seven days or 30 days. Changing expiry keeps the same link.',
                ),
            },
            {
              label: 'Turn off link',
              destructive: true,
              onClick: () => setNotice('Guest link turned off in this preview.'),
            },
          ]}
        />
      </div>
      <p role="status">{notice}</p>
    </section>
  );
}
const meta = {
  title: 'Redesign/SPN-066 Guest links',
  component: GuestLinksProposal,
  parameters: {
    shell: 'none',
    redesignTicket: 'SPN-066',
    docs: { description: { component: 'Pending SPN-066 proposal using local sample state.' } },
  },
} satisfies Meta<typeof GuestLinksProposal>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('navigation')).not.toBeInTheDocument();
    for (const name of ['Profile', 'Passkeys', 'This device', 'Connected assistants'])
      await expect(canvas.queryByRole('button', { name })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Autumn plans guest link actions' }));
    await userEvent.click(within(document.body).getByRole('menuitem', { name: 'Change expiry…' }));
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Changing expiry keeps the same link.',
    );
  },
};
