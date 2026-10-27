import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProfileMockup } from './Mockups.tsx';

// Pending proposal owned by SPN-066; replace with its production component when landed.
const meta = {
  title: 'Redesign/SPN-066 Guest links',
  component: ProfileMockup,
  args: { section: 'links' },
  parameters: {
    shell: 'none',
    redesignTicket: 'SPN-066',
    docs: { description: { component: 'Pending SPN-066 proposal using local sample state.' } },
  },
} satisfies Meta<typeof ProfileMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preview: Story = {};
