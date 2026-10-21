import { userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProfileSettings } from './ProfileSettings.tsx';
import { pending, failure } from '../.storybook/api.ts';
const profile = { name: 'Bee', icon: 'lucide:flower', color: 'info-strong' };
const meta = {
  id: 'account-profile',
  title: 'Current production/Account/Profile',
  component: ProfileSettings,
} satisfies Meta<typeof ProfileSettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  parameters: { api: { 'GET /api/auth/profile': profile, 'POST /api/auth/profile': profile } },
};
export const Loading: Story = { parameters: { api: { 'GET /api/auth/profile': pending() } } };
export const LoadError: Story = {
  parameters: { api: { 'GET /api/auth/profile': failure('Could not load profile.') } },
};
export const SaveError: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Save profile' }),
    );
  },
  parameters: {
    api: {
      'GET /api/auth/profile': profile,
      'POST /api/auth/profile': failure('Could not save profile.'),
    },
  },
};
export const Saving: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Save profile' }),
    );
  },
  parameters: { api: { 'GET /api/auth/profile': profile, 'POST /api/auth/profile': pending() } },
};
