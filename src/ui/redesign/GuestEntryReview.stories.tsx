import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { GuestEntryReview } from './GuestEntryReview.tsx';

const meta = {
  title: 'Redesign/Guest entry',
  component: GuestEntryReview,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Shared document' })).toBeVisible();
    if (args.state === 'unsupported-browser') {
      await expect(canvas.getByRole('alert')).toHaveTextContent(
        'This browser is missing a feature Spinel needs. Update your browser or open this link in another current browser.',
      );
      await expect(canvas.queryByRole('status')).not.toBeInTheDocument();
    } else {
      await expect(canvas.getByRole('status')).toHaveTextContent('Opening shared document…');
      await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
    }
    await expect(canvas.queryByRole('navigation')).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('button', { name: /profile|My files|sign in/i }),
    ).not.toBeInTheDocument();
    await expect(canvasElement.querySelector('.rd-native-editor')).toBeNull();
    await expect(
      canvas.queryByText(/Quarterly budget|Autumn plans|Alex Kim|Alex Baylee/),
    ).not.toBeInTheDocument();
  },
} satisfies Meta<typeof GuestEntryReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AuthLoading: Story = { args: { state: 'loading' } };
export const UnsupportedBrowser: Story = { args: { state: 'unsupported-browser' } };
