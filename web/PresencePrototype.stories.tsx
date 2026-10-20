import type { Meta, StoryObj } from '@storybook/react-vite';
import { PrototypeLabel } from './PresencePrototype.tsx';

const meta = {
  title: 'Experiments/Profile cursor label',
  component: PrototypeLabel,
} satisfies Meta<typeof PrototypeLabel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Flower: Story = { args: { name: 'Iris' } };
export const Cat: Story = { args: { name: 'Moss', alternate: true } };
