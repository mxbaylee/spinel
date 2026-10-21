import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { useState } from 'react';
import { VersionNamesReview } from './VersionNamesReview.tsx';
import './mockups.css';

const meta = {
  title: 'Redesign/Version names',
  component: VersionNamesReview,
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'Local version-name fixtures. Naming, renaming, and removing names update this preview only. Embedded mode shares controlled names with the history timeline.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="sp-ui rd-dialog-stage">
        <div className="rd-dialog-example">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof VersionNamesReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Viewer: Story = { args: { readOnly: true } };
export const Empty: Story = { args: { state: 'empty' } };
export const Loading: Story = { args: { state: 'loading' } };
export const LoadError: Story = { args: { state: 'load-error' } };
export const NameCurrent: Story = { args: { state: 'name-current' } };
export const NameOlder: Story = { args: { state: 'name-older' } };
export const Rename: Story = { args: { state: 'rename' } };
export const Remove: Story = { args: { state: 'remove' } };
export const Removing: Story = { args: { state: 'removing' } };
export const RemoveError: Story = { args: { state: 'remove-error' } };
export const Saving: Story = { args: { state: 'saving' } };
export const SaveError: Story = { args: { state: 'save-error' } };
export const Unsaved: Story = { args: { saved: false } };
export const UnsavedDraft: Story = { args: { saved: false, state: 'save-error' } };
export const Offline: Story = { args: { offline: true } };
function EmbeddedNames() {
  const [versions, setVersions] = useState([
    {
      id: 'trip',
      capturedAt: Date.UTC(2026, 9, 20, 17),
      name: 'Ready for the trip' as string | null,
    },
    { id: 'older', capturedAt: Date.UTC(2026, 9, 19, 17), name: null as string | null },
  ]);
  const [selected, setSelected] = useState('trip');
  return (
    <VersionNamesReview
      compact
      showCurrentAction={false}
      versions={versions}
      selectedId={selected}
      onSelect={setSelected}
      onName={(id, name) =>
        setVersions((items) => items.map((item) => (item.id === id ? { ...item, name } : item)))
      }
    />
  );
}
export const Embedded: Story = { render: () => <EmbeddedNames /> };
export const EmbeddedRename: Story = {
  render: () => <EmbeddedNames />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Actions for Ready for the trip' }),
    );
    await userEvent.click(page.getByRole('menuitem', { name: 'Rename version' }));
    const input = page.getByRole('textbox', { name: 'Version name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Trip checked');
    await userEvent.click(page.getByRole('button', { name: 'Save name' }));
    await expect(
      within(canvasElement).getByRole('button', { name: 'Trip checked Preview version' }),
    ).toHaveAttribute('aria-pressed', 'true');
  },
};
export const LongName: Story = {
  args: {
    versions: [
      {
        id: 'long',
        capturedAt: Date.UTC(2026, 9, 20, 17),
        name: 'Ready for the autumn trip with the accessible routes, reservations, and budget all checked together',
      },
    ],
  },
};
export const RetrySave: Story = {
  args: { state: 'save-error' },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByRole('textbox', { name: 'Version name' })).toHaveValue(
      'Ready for the trip',
    );
    await userEvent.click(page.getByRole('button', { name: /^Try again$/ }));
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Version named “Ready for the trip”.',
    );
  },
};
export const RetryLoad: Story = {
  args: { state: 'load-error' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
    await expect(within(canvasElement).getByText('Sent to accountant')).toBeVisible();
  },
};
export const Removed: Story = {
  args: { state: 'remove' },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('button', {
        name: /^Remove name$/,
      }),
    );
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Name removed.');
  },
};
