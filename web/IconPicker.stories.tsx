import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconPicker } from './ProfileSettings.tsx';
const meta = {
  id: 'account-icon-picker',
  title: 'Current production/Account/Icon picker',
  component: IconPicker,
  args: { value: 'lucide:user-round', choose: () => {}, close: () => {} },
} satisfies Meta<typeof IconPicker>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Browse: Story = {};
