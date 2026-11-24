import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { checkLoadingRunner } from '../../../.storybook/loadingChecks.ts';
import { LoadingReview } from './LoadingReview.tsx';

const meta = {
  title: 'Current production/Loading',
  component: LoadingReview,
  args: { label: 'Opening document…' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('status')).toHaveLength(1);
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Opening document…');
    await checkLoadingRunner(canvasElement);
  },
} satisfies Meta<typeof LoadingReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Page: Story = {};
export const Compact: Story = { args: { size: 'compact' } };
export const Still: Story = { args: { motion: 'still' } };
