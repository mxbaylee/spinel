import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { HistoryMockup } from './Mockups.tsx';

const meta = {
  title: 'Redesign/History actions',
  component: HistoryMockup,
  parameters: { shell: 'none', layout: 'fullscreen' },
} satisfies Meta<typeof HistoryMockup>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openCheckpointActions(canvasElement: HTMLElement) {
  const disclosure = canvasElement.querySelector<HTMLDetailsElement>('.rd-history-disclosure')!;
  if (getComputedStyle(disclosure).display !== 'none' && !disclosure.open)
    await userEvent.click(disclosure.querySelector('summary')!);
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Actions for Ready for the trip' }),
  );
}

export const RenameCheckpoint: Story = {
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    await openCheckpointActions(canvasElement);
    await userEvent.click(portal.getByRole('menuitem', { name: 'Rename version' }));
    const dialog = await portal.findByRole('dialog', { name: 'Rename version' });
    await expect(within(dialog).getByRole('textbox', { name: 'Version name' })).toHaveValue(
      'Ready for the trip',
    );
  },
};

export const RenamedCheckpoint: Story = {
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    await openCheckpointActions(canvasElement);
    await userEvent.click(portal.getByRole('menuitem', { name: 'Rename version' }));
    const dialog = await portal.findByRole('dialog', { name: 'Rename version' });
    const input = within(dialog).getByRole('textbox', { name: 'Version name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Booked and confirmed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));
    await expect(
      within(canvasElement).getByRole('button', { name: 'Booked and confirmed Preview version' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(canvasElement.querySelector('.rd-history-selection')).toHaveTextContent(
      'Booked and confirmed',
    );
  },
};

export const RemoveCheckpointName: Story = {
  play: async ({ canvasElement }) => {
    const portal = within(canvasElement.ownerDocument.body);
    await openCheckpointActions(canvasElement);
    await userEvent.click(portal.getByRole('menuitem', { name: 'Remove name' }));
    const dialog = await portal.findByRole('dialog', { name: 'Remove this version’s name?' });
    await expect(
      within(dialog).getByText(
        'The version becomes unnamed and follows regular history retention. Its content is unchanged.',
      ),
    ).toBeVisible();
  },
};

export const OlderNamesWhileUnsaved: Story = {
  args: { saveState: 'saving' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Name current version…' }),
    ).toBeDisabled();
    await openCheckpointActions(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(portal.getByRole('menuitem', { name: 'Rename version' }));
    const dialog = await portal.findByRole('dialog', { name: 'Rename version' });
    await expect(within(dialog).getByRole('button', { name: 'Save name' })).toBeEnabled();
  },
};
