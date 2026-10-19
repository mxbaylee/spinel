import type { Meta, StoryObj } from '@storybook/react-vite';
import { GemLogo } from './GemLogo.tsx';

const meta = {
  title: 'Shell/GemLogo',
  component: GemLogo,
  args: { size: 36 },
} satisfies Meta<typeof GemLogo>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Rail size. Points down in Vintage and flips in Modern. */
export const Rail: Story = {};
export const Large: Story = { args: { size: 96 } };
