import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SpaceTrash } from './SpaceTrash.tsx';

const now = Date.now();
const held = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'doc' as const,
  name: 'Recovered notes',
  trashedAt: now - 90 * 86_400_000,
  expiresAt: now - 60 * 86_400_000,
  heldAfterRecovery: true as const,
  descendantCount: 2,
  originalLocation: null,
};
const meta = {
  title: 'Current production/Spaces/Recovery holds',
  component: SpaceTrash,
  args: {
    listing: { access: 'owner', items: [held] },
    spaceName: 'Project Atlas',
    disabled: false,
    busy: false,
    error: '',
    notice: '',
    preview: null,
    onReload: fn(),
    onRestore: fn(),
    onPreviewDelete: fn(),
    onCancelDelete: fn(),
    onConfirmDelete: fn(),
  },
} satisfies Meta<typeof SpaceTrash>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HeldAfterRecovery: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Held after workspace recovery/)).toBeVisible();
    await expect(canvas.queryByText(/Recovery ended/)).not.toBeInTheDocument();
    await expect(canvas.getByText(/Restores to Project Atlas/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Restore Recovered notes' }));
    await expect(args.onRestore).toHaveBeenCalledWith(held);
  },
};
export const Editor: Story = {
  args: { listing: { access: 'editor', items: [held] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Restore Recovered notes' })).toBeEnabled();
    await expect(
      canvas.queryByRole('button', { name: 'Actions for deleted Recovered notes' }),
    ).not.toBeInTheDocument();
  },
};
export const Offline: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Restore Recovered notes' }),
    ).toBeDisabled();
  },
};
