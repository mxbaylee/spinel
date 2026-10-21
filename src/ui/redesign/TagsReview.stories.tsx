import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { TagsReview } from './TagsReview.tsx';
import './mockups.css';

const meta = {
  title: 'Redesign/Personal tags',
  component: TagsReview,
  parameters: { shell: 'none' },
  decorators: [
    (Story) => (
      <div className="sp-ui rd-dialog-stage">
        <div className="rd-dialog-example">
          <h2>Your tags</h2>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof TagsReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NoTags: Story = {};
export const SeveralTags: Story = { args: { initialTags: ['budget', 'q4', 'needs-review'] } };
export const SuggestionsLoading: Story = { args: { state: 'suggestions-loading' } };
export const SuggestionsFailed: Story = { args: { state: 'suggestions-failed' } };
export const Adding: Story = { args: { state: 'adding' } };
export const AddFailed: Story = { args: { state: 'add-failed' } };
export const Removing: Story = { args: { state: 'removing', initialTags: ['budget', 'q4'] } };
export const RemoveFailed: Story = {
  args: { state: 'remove-failed', initialTags: ['budget', 'q4'] },
};
export const LongAndMany: Story = {
  args: {
    initialTags: [
      'a-long-personal-tag-for-organizing-household-planning-and-budget',
      'q4',
      'needs-review',
      'finance',
      'home, work',
    ],
  },
};
export const RetryAdd: Story = {
  args: { state: 'add-failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Tag' })).toHaveValue('budget');
    await expect(canvas.queryByRole('list', { name: 'Your tags' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Remove #budget' })).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Tag' })).toHaveValue('');
  },
};
export const TypeWithoutSuggestions: Story = {
  args: { state: 'suggestions-failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Tag' }), ' #Travel ');
    await userEvent.click(canvas.getByRole('button', { name: 'Add tag' }));
    await expect(canvas.getByRole('button', { name: 'Remove #travel' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry suggestions' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getByRole('group', { name: 'Your tag suggestions' })).toBeVisible();
  },
};
export const RetryRemove: Story = {
  args: { state: 'remove-failed', initialTags: ['budget', 'q4'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('It is still on this file');
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(canvas.getByRole('button', { name: 'Retry removing #budget' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(1);
    await expect(canvas.getByRole('button', { name: 'Remove #q4' })).toBeVisible();
  },
};
export const ValidationKeepsDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox', { name: 'Tag' });
    await userEvent.type(field, 'x'.repeat(65));
    await userEvent.click(canvas.getByRole('button', { name: 'Add tag' }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('1–64 characters');
    await expect(field).toHaveValue('x'.repeat(65));
    await expect(canvas.queryByRole('list', { name: 'Your tags' })).toBeNull();
  },
};
