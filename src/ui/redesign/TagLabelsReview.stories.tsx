import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { TagLabelsReview } from './TagsReview.tsx';
import './mockups.css';

const meta = {
  title: 'Redesign/Tag labels',
  component: TagLabelsReview,
  parameters: { shell: 'none' },
  decorators: [
    (Story) => (
      <div className="sp-ui rd-dialog-stage">
        <div className="rd-dialog-example">
          <p>Quarterly budget</p>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof TagLabelsReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const None: Story = { args: { tags: [] } };
export const One: Story = { args: { tags: ['budget'] } };
export const Several: Story = {
  args: { tags: ['budget', 'q4', 'needs-review', 'finance'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('+2')).toBeVisible();
    await expect(
      canvas.getByText('Your tags: budget, q4, needs-review, finance'),
    ).toBeInTheDocument();
  },
};
export const Long: Story = {
  args: {
    tags: [
      'a-long-personal-tag-for-organizing-household-planning-and-budget',
      'another-long-tag-for-all-of-the-research-we-want-to-keep',
      'q4',
    ],
  },
};
