import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { ShareLink } from './ShareLink.tsx';

const id = '00000000-0000-4000-8000-000000000071';
const link = `GET /api/items/${id}/link`;
const url =
  'https://spinel.example.com/share/00000000-0000-4000-8000-000000000071?preview=public-title-preview#k3Yq9mZpV2xT';

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  id: 'sharing-sharelink',
  title: 'Current production/Sharing/ShareLink',
  component: ShareLink,
  args: { id },
} satisfies Meta<typeof ShareLink>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Controls are disabled until the current link state arrives. */
export const Loading: Story = { parameters: { api: { [link]: pending() } } };
export const LinkOff: Story = {
  parameters: { api: { [link]: { enabled: false, role: 'viewer' } } },
};
export const LinkOnViewOnly: Story = {
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url } } },
};
export const LinkOnCanEdit: Story = {
  parameters: { api: { [link]: { enabled: true, role: 'editor', url } } },
};
/** The address is only shown when the link is created; later visits cannot recover it. */
export const LinkOnWithoutUrl: Story = {
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url: null } } },
};
export const Failed: Story = {
  parameters: { api: { [link]: failure('Only the owner can manage the guest link.', 403) } },
};
export const SpaceViewLink: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url } } },
};
export const SpaceEditLink: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: true, role: 'editor', url } } },
};
export const ConfirmWholeSpace: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: false, role: 'viewer' } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Create guest link' }),
    );
  },
};
export const ConfirmReplacementEditLink: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(await canvas.findByLabelText('Link access'), 'editor');
    await userEvent.click(canvas.getByRole('button', { name: 'Create replacement link' }));
  },
};
export const ConfirmTurnOffSpaceLink: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: true, role: 'editor', url } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Turn link off' }),
    );
  },
};
