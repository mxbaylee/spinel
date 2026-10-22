import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, userEvent, within } from 'storybook/test';
import type { FileItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { DocumentTags } from './DocumentTags.tsx';

const id = '00000000-0000-4000-8000-000000000011';
const item = (tags: string[]): FileItem => ({
  access: 'owner',
  id,
  parentId: null,
  kind: 'doc',
  name: 'Quarterly budget',
  createdAt: Date.UTC(2026, 8, 1),
  updatedAt: Date.UTC(2026, 9, 12),
  tags,
});
// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.
const suggestions = { 'GET /api/items/tags': { tags: ['budget', 'finance', 'q4', 'travel'] } };

const meta = {
  id: 'dashboard-documenttags',
  title: 'Current production/Dashboard/DocumentTags',
  component: DocumentTags,
  args: { item: item([]), onChanged: () => {}, onClose: () => {} },
  // The dialog keeps the item in the dashboard; hold it here so adding a tag shows up.
  render: ({ item: initial, ...args }) => {
    const [current, setCurrent] = useState(initial);
    return <DocumentTags {...args} item={current} onChanged={setCurrent} />;
  },
} satisfies Meta<typeof DocumentTags>;
export default meta;
type Story = StoryObj<typeof meta>;

const addTag = async (canvasElement: HTMLElement) => {
  // The tags dialog is modal and rendered in the canvas.
  const dialog = within(canvasElement).getByRole('dialog', { hidden: true });
  // The field is focused when the dialog opens, which userEvent.type does not
  // register with React, so set the value with a change event instead.
  fireEvent.change(within(dialog).getByLabelText('Tag'), { target: { value: 'budget' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add tag' }));
};

/** A document with no tags yet; the datalist suggests tags used elsewhere. */
export const NoTags: Story = { parameters: { api: suggestions } };
export const SeveralTags: Story = {
  args: { item: item(['budget', 'q4', 'needs-review']) },
  parameters: {
    api: {
      ...suggestions,
      [`POST /api/items/${id}/tags`]: { item: item(['budget', 'q4', 'needs-review', 'finance']) },
    },
  },
};
/** The suggestion list could not be loaded; adding tags by typing still works. */
export const SuggestionsFailed: Story = {
  parameters: {
    api: { 'GET /api/items/tags': failure('Could not load your tags. Try again.', 500) },
  },
};
/** Every control is disabled while the add request is in flight. */
export const Adding: Story = {
  parameters: { api: { ...suggestions, [`POST /api/items/${id}/tags`]: pending() } },
  play: ({ canvasElement }) => addTag(canvasElement),
};
export const AddFailed: Story = {
  parameters: {
    api: {
      ...suggestions,
      [`POST /api/items/${id}/tags`]: failure('Tags can be at most 40 characters.'),
    },
  },
  play: ({ canvasElement }) => addTag(canvasElement),
};
export const PersonalSpaceTags: Story = {
  args: {
    item: {
      ...item(['research', 'travel']),
      kind: 'space',
      name: 'Research Space',
      access: 'viewer',
      ownerName: 'Alex Kim',
    },
  },
  parameters: { api: suggestions },
};
