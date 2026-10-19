import type { Meta, StoryObj } from '@storybook/react-vite';
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

export const Default: Story = {};
/** Viewers see the palette but cannot apply it. */
export const Disabled: Story = { args: { disabled: true } };
/** Applying stays busy until the change is accepted. */
export const Applying: Story = { args: { apply: () => new Promise(() => {}) } };
export const Failed: Story = {
  args: {
    apply: async () => {
      throw new Error('Could not apply this fill. Try again.');
    },
  },
};
