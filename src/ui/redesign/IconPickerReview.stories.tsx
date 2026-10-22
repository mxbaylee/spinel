import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { ProfileMockup } from './Mockups.tsx';

const meta = {
  title: 'Redesign/Profile icon picker',
  component: ProfileMockup,
  args: { initialPicker: 'icon' },
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'The actual IconPicker in the proposed settings flow. Selection changes the local profile draft; no account API is called.',
      },
    },
  },
} satisfies Meta<typeof ProfileMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
const picker = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('dialog', { name: 'Choose your icon' }));
export const Browse: Story = {};
export const Search: Story = {
  play: async ({ canvasElement }) => {
    const dialog = picker(canvasElement);
    await userEvent.type(dialog.getByRole('textbox', { name: 'Search icons' }), 'cat');
    await expect(dialog.getByRole('button', { name: /^Cat$/ })).toBeVisible();
  },
};
export const NoResults: Story = {
  play: async ({ canvasElement }) => {
    const dialog = picker(canvasElement);
    await userEvent.type(
      dialog.getByRole('textbox', { name: 'Search icons' }),
      'zzyyxxqqnotanicon',
    );
    await expect(dialog.getByRole('status')).toHaveTextContent('0 results');
    await expect(
      dialog.getByText('No icons match. Try another name or description.'),
    ).toBeVisible();
    await expect(dialog.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  },
};
export const Category: Story = {
  play: async ({ canvasElement }) => {
    const dialog = picker(canvasElement);
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Category' }), 'animals');
    await expect(dialog.getByRole('combobox', { name: 'Category' })).toHaveValue('animals');
    await expect(dialog.getByRole('button', { name: /^Cat$/ })).toBeVisible();
    await expect(dialog.queryByRole('button', { name: /^Arrow Down$/ })).not.toBeInTheDocument();
  },
};
export const ShowMore: Story = {
  play: async ({ canvasElement }) => {
    const dialog = picker(canvasElement);
    const grid = dialog.getByLabelText('Icons');
    await expect(within(grid).getAllByRole('button')).toHaveLength(60);
    const initialGridHeight = grid.getBoundingClientRect().height;
    await userEvent.click(dialog.getByRole('button', { name: 'Show more' }));
    await expect(within(grid).getAllByRole('button')).toHaveLength(120);
    // Loading more icons must not push the only touch dismissal out of view.
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    const viewport = canvasElement.ownerDocument.defaultView!;
    await expect(grid.getBoundingClientRect().height).toBeLessThanOrEqual(initialGridHeight + 1);
    await expect(grid.scrollHeight).toBeGreaterThan(grid.clientHeight);
    await expect(cancel.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.innerHeight);
    await expect(cancel.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      grid.getBoundingClientRect().bottom,
    );
    await expect(
      dialog.getByRole('textbox', { name: 'Search icons' }).getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(0);
  },
};
export const ShowMoreCancelAndReturn: Story = {
  play: async (context) => {
    await ShowMore.play?.(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(picker(context.canvasElement).getByRole('button', { name: 'Cancel' }));
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Choose icon' })).toHaveFocus());
  },
};
export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const dialog = picker(canvasElement);
    await userEvent.type(dialog.getByRole('textbox', { name: 'Search icons' }), 'cat');
    await userEvent.keyboard('{ArrowDown}');
    await expect(dialog.getByRole('button', { name: /^Cat$/ })).toHaveFocus();
  },
};
export const SelectedIcon: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    let dialog = picker(canvasElement);
    await userEvent.type(dialog.getByRole('textbox', { name: 'Search icons' }), 'cat');
    await userEvent.click(dialog.getByRole('button', { name: /^Cat$/ }));
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Choose icon' })).toHaveFocus());
    await userEvent.click(canvas.getByRole('button', { name: 'Choose icon' }));
    dialog = picker(canvasElement);
    await userEvent.type(dialog.getByRole('textbox', { name: 'Search icons' }), 'cat');
    await expect(dialog.getByRole('button', { name: /^Cat$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};
export const KeyboardSelectAndReturn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = picker(canvasElement);
    await userEvent.type(dialog.getByRole('textbox', { name: 'Search icons' }), 'cat');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Choose icon' })).toHaveFocus());
  },
};
export const CancelAndReturn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(picker(canvasElement).getByRole('button', { name: 'Cancel' }));
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Choose icon' })).toHaveFocus());
  },
};
// Exercise the native dialog cancel callback. A synthetic Escape key does not
// cause browsers to perform the trusted native dialog dismissal action.
export const NativeCancelAndReturn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(picker(canvasElement).getByRole('textbox', { name: 'Search icons' }));
    fireEvent(
      canvas.getByRole('dialog', { name: 'Choose your icon' }),
      new Event('cancel', { cancelable: true }),
    );
    await waitFor(() => expect(canvas.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Choose icon' })).toHaveFocus());
  },
};
