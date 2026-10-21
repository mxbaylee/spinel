import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { useState } from 'react';
import { GemLogo, replayGemWiggle } from './GemLogo.tsx';

const meta = {
  id: 'shell-gemlogo',
  title: 'Current production/Shell/GemLogo',
  component: GemLogo,
  args: { size: 36 },
} satisfies Meta<typeof GemLogo>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Rail size. Points down in Vintage and flips in Modern. */
export const Rail: Story = {};
export const Large: Story = { args: { size: 96 } };

function TapReplayExample() {
  const [visits, setVisits] = useState(0);
  return (
    <div>
      <button
        className="brand"
        aria-label="Spinel home"
        onClick={(event) => {
          replayGemWiggle(event.currentTarget);
          setVisits((count) => count + 1);
        }}
      >
        <span className="wiggle">
          <GemLogo />
        </span>
      </button>
      <p>Home activations: {visits}</p>
    </div>
  );
}

/** Repeated activation keeps navigation working without requiring pointer exit or blur. */
export const TapReplay: Story = {
  render: () => <TapReplayExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Spinel home' });
    const gem = canvas.getByRole('img', { name: 'Spinel' });
    const wrapper = gem.parentElement!;
    await userEvent.click(button);
    const first = wrapper.getAnimations()[0];
    await userEvent.click(button);
    await expect(canvas.getByText('Home activations: 2')).toBeVisible();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await expect(wrapper.getAnimations()).toHaveLength(0);
    } else {
      const second = wrapper.getAnimations()[0];
      await expect(first).toBeDefined();
      await expect(second).toBeDefined();
      await expect(second).not.toBe(first);
      await expect(first.playState).toBe('idle');
      await expect((second.effect as KeyframeEffect).target).toBe(wrapper);
    }
    // The SVG's theme rotation is never replaced by an inline animation or transform.
    await expect(gem.style.transform).toBe('');
    await expect(gem.style.animation).toBe('');
  },
};
