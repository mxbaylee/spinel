import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { fillPresets } from './palette.ts';
import { FillPresets } from './FillPresets.tsx';

const meta = {
  title: 'Editor/FillPresets',
  component: FillPresets,
  args: { apply: async () => {}, disabled: false },
  decorators: [
    (Story) => {
      // Stories show the palette open; the editor starts it closed.
      setTimeout(() => document.querySelector('details.fill-presets')?.setAttribute('open', ''));
      return <Story />;
    },
  ],
} satisfies Meta<typeof FillPresets>;
export default meta;
type Story = StoryObj<typeof meta>;

// Open the palette, as the decorator does, before clicking the first swatch.
const applyFirst = async (canvasElement: HTMLElement) => {
  canvasElement.querySelector('details.fill-presets')?.setAttribute('open', '');
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: `Apply ${fillPresets[0].label} fill` }),
  );
};

export const Default: Story = {};
/** Viewers see the palette but cannot apply it. */
export const Disabled: Story = { args: { disabled: true } };
/** Every swatch is disabled until the editor accepts the change. */
export const Applying: Story = {
  args: { apply: () => new Promise(() => {}) },
  play: async ({ canvasElement }) => {
    await applyFirst(canvasElement);
    for (const swatch of canvasElement.querySelectorAll('.fill-palette button'))
      await expect(swatch).toBeDisabled();
  },
};
/** The editor refused the change; the swatches work again and an alert says why. */
export const Failed: Story = {
  args: {
    apply: async () => {
      throw new Error('Could not apply this fill. Try again.');
    },
  },
  play: async ({ canvasElement }) => {
    await applyFirst(canvasElement);
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'Could not apply this fill. Try again.',
    );
  },
};
