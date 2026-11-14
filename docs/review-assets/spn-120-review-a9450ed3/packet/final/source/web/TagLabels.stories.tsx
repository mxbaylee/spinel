import type { Meta, StoryObj } from '@storybook/react-vite';
import { TagLabels } from './DocumentTags.tsx';

const meta = {
  id: 'dashboard-taglabels',
  title: 'Current production/Dashboard/TagLabels',
  component: TagLabels,
} satisfies Meta<typeof TagLabels>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Renders nothing when an item has no tags. */
export const None: Story = { args: { tags: [] } };
export const One: Story = { args: { tags: ['budget'] } };
export const Several: Story = { args: { tags: ['budget', 'q4', 'needs-review', 'finance'] } };
