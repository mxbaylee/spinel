import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProfileSettings } from './ProfileSettings.tsx';
import { pending, failure } from '../.storybook/api.ts';
import { assertDialogTitle } from '../.storybook/dialogBounds.ts';
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

export const ColorPicker: Story = {
  parameters: { api: { 'GET /api/auth/profile': profile } },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Choose color' }),
    );
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Choose your color',
    });
    await assertDialogTitle(dialog, 'Choose your color');
  },
};

export const IconPicker: Story = {
  parameters: { api: { 'GET /api/auth/profile': profile } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = await page.findByRole('button', { name: 'Choose icon' });
    await userEvent.click(trigger);
    const dialog = await page.findByRole('dialog', { name: 'Choose your icon' });
    await assertDialogTitle(dialog, 'Choose your icon');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await assertDialogTitle(
      await page.findByRole('dialog', { name: 'Choose your icon' }),
      'Choose your icon',
    );
  },
};
