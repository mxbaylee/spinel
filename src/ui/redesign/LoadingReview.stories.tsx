import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { palettes } from '../palette.ts';
import { LoadingReview } from './LoadingReview.tsx';

const meta = {
  title: 'Redesign/Loading',
  component: LoadingReview,
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'Proposed running silhouette. Both themes share one run cycle. System reduced-motion preferences produce a still pose; loading remains visible and announced.',
      },
    },
  },
} satisfies Meta<typeof LoadingReview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Page: Story = { args: { label: 'Loading your files…' } };
export const Compact: Story = {
  args: { label: 'Opening document…', size: 'compact' },
};
export const ReducedMotion: Story = {
  args: { label: 'Loading your files…', motion: 'still' },
  play: async ({ canvasElement }) => {
    const status = within(canvasElement).getByRole('status');
    await expect(status).toHaveTextContent('Loading your files…');
    await expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(getComputedStyle(status.querySelector('.rd-runner-leg')!).animationName).toBe(
      'none',
    );
  },
};
export const BothThemes: Story = {
  render: () => (
    <div className="rd-loading-comparison">
      {(['light', 'dark'] as const).map((scheme) => (
        <section
          className="rd-loading-specimen"
          key={scheme}
          style={
            Object.fromEntries(
              Object.entries(palettes[scheme]).map(([key, value]) => [`--${key}`, value]),
            ) as CSSProperties
          }
        >
          <h2>{scheme === 'light' ? 'Light' : 'Dark'}</h2>
          <LoadingReview scheme={scheme} label="Loading your files…" />
        </section>
      ))}
    </div>
  ),
};
export const LoadingContext: Story = {
  render: () => (
    <section className="rd-loading-specimen" aria-label="My files">
      <h2>My files</h2>
      <LoadingReview label="Loading your files…" />
    </section>
  ),
};
