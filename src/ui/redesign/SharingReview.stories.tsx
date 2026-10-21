import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SharingReview } from './SharingReview.tsx';
import './mockups.css';

const meta = {
  title: 'Redesign/Sharing access',
  component: SharingReview,
  args: { kind: 'doc' },
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'Direct access and guest-link state proposals. All mutations are local fixtures. Existing confirmed permissions remain visible during pending and failed requests.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="sp-ui rd-dialog-stage">
        <section className="rd-dialog-example">
          <h1>Share Autumn plans</h1>
          <Story />
        </section>
      </div>
    ),
  ],
} satisfies Meta<typeof SharingReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WithPeople: Story = {};
export const Loading: Story = { args: { state: 'loading' } };
export const LoadFailed: Story = { args: { state: 'load-error' } };
export const OwnerOnly: Story = { args: { state: 'owner-only' } };
export const DisabledAccount: Story = { args: { state: 'disabled-account' } };
export const UpdatingAccess: Story = { args: { state: 'access-saving' } };
export const AccessFailed: Story = { args: { state: 'error' } };
export const Folder: Story = {
  args: { kind: 'folder' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('region', { name: 'Guest link' })).toBeNull();
    await expect(canvas.getByRole('combobox', { name: 'Alex’s direct access' })).toBeVisible();
  },
};
export const LinkLoading: Story = { args: { state: 'link-loading' } };
export const LinkLoadFailed: Story = { args: { state: 'link-load-error' } };
export const LinkOnViewOnly: Story = { args: { state: 'existing' } };
export const LinkOnCanEdit: Story = { args: { state: 'created' } };
export const CreatingLink: Story = { args: { state: 'creating' } };
export const CreateFailed: Story = { args: { state: 'create-error' } };
export const ReplacingLink: Story = { args: { state: 'replacing' } };
export const ReplaceFailed: Story = { args: { state: 'replace-error' } };
export const RevokingLink: Story = { args: { state: 'revoking' } };
export const RevokeFailed: Story = { args: { state: 'revoke-error' } };
export const RetryAccess: Story = {
  args: { state: 'error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Alex still has Can edit access');
    await expect(canvas.getByRole('combobox', { name: 'Alex’s direct access' })).toHaveTextContent(
      'Can view',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Retry access update' }));
    await expect(
      await canvas.findByText('Can edit through a folder. Direct access: can view.'),
    ).toBeVisible();
    await expect(canvas.queryByRole('alert')).toBeNull();
  },
};
export const RetryRevoke: Story = {
  args: { state: 'revoke-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Guests can view.')).toBeVisible();
    await expect(canvas.getByRole('alert')).toHaveTextContent('still have access');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(
      await canvas.findByText('Off. Only people with access can open this file.'),
    ).toBeVisible();
    await expect(canvas.queryByRole('alert')).toBeNull();
  },
};
export const RetryReplace: Story = {
  args: { state: 'replace-error' },
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    const dialog = await portal.findByRole('dialog', { name: 'Replace the link?' });
    await expect(within(dialog).getByRole('alert')).toHaveTextContent('existing link still works');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await expect(
      await within(canvasElement).findByRole('textbox', { name: 'Guest address' }),
    ).toBeVisible();
  },
};
