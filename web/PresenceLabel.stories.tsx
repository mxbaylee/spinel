import type { Meta, StoryObj } from '@storybook/react-vite';
import { PresenceLabel } from './PresenceLabel.tsx';

const meta = {
  title: 'Editor/Profile cursor label',
  component: PresenceLabel,
} satisfies Meta<typeof PresenceLabel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Flower: Story = {
  args: {
    name: 'Iris',
    icon: 'lucide:flower',
    color: 'var(--fill-info-strong-bg)',
    foreground: 'var(--fill-info-strong-fg)',
  },
};
export const Cat: Story = {
  args: {
    name: 'Moss',
    icon: 'lucide:cat',
    color: 'var(--fill-success-strong-bg)',
    foreground: 'var(--fill-success-strong-fg)',
  },
};
