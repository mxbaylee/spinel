import type { Meta, StoryObj } from '@storybook/react-vite';
import { Collaborators, collaboratorColor } from './Collaborators.tsx';
import type { Collaborator } from './Collaborators.tsx';
import { expect, userEvent, within } from 'storybook/test';

const person = (id: string, name: string, jump?: () => void): Collaborator => ({
  id,
  name,
  color: collaboratorColor(id),
  selection: jump ? 'A1' : undefined,
  jump,
});

const meta = {
  id: 'editor-collaborators',
  title: 'Current production/Editor/Collaborators',
  component: Collaborators,
} satisfies Meta<typeof Collaborators>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nobody has joined yet; the count opens an explicit empty people dialog. */
export const Empty: Story = { args: { people: [] } };
/** Only you are in the document; your own badge never jumps anywhere. */
export const Alone: Story = { args: { people: [person('u-sam', 'Sam Rivera')] } };
/** Alex has a cursor to jump to; Sam, who is you, has none. */
export const TwoPeople: Story = {
  args: { people: [person('u-sam', 'Sam Rivera'), person('u-alex', 'Alex Kim', () => {})] },
};
/**
 * In a room with an active guest link the server names guests "Guest" and
 * signed-in members "Collaborator", with an empty avatar. Colours still come
 * from each user ID, so two guests can share a name but not usually a colour.
 */
export const GuestLabels: Story = {
  args: {
    people: [
      { id: 'm-1', name: 'Collaborator', color: collaboratorColor('u-sam') },
      { id: 'm-2', name: 'Guest', color: collaboratorColor('guest:3f2a'), jump: () => {} },
      { id: 'm-3', name: 'Guest', color: collaboratorColor('guest:9c1d') },
    ],
  },
};
export const Many: Story = {
  args: {
    people: [
      person('u-sam', 'Sam Rivera'),
      person('u-alex', 'Alex Kim', () => {}),
      person('u-jordan', 'Jordan Lee', () => {}),
      person('u-priya', 'Priya Patel'),
      person('u-morgan', 'Morgan Ellis', () => {}),
      person('u-taylor', 'Taylor Brooks'),
      person('u-casey', 'Casey Nakamura-Fernandez', () => {}),
      person('u-riley', 'Riley Okafor'),
    ],
  },
};
export const ManyPhone: Story = {
  ...Many,
  globals: { viewport: { value: 'phone', isRotated: false } },
};

async function openPeople(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'People in this document' }),
  );
  const dialog = await within(document.body).findByRole('dialog', {
    name: 'People in this document',
  });
  for (const button of within(dialog).getAllByRole('button')) {
    const box = button.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    if (window.innerWidth <= 640 || matchMedia('(pointer: coarse)').matches) {
      await expect(box.width).toBeGreaterThanOrEqual(44);
      await expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  return within(dialog);
}

/** These finish open so screenshot capture includes the actual people state. */
export const EmptyOpen: Story = {
  ...Empty,
  play: async ({ canvasElement }) => {
    const dialog = await openPeople(canvasElement);
    await expect(dialog.getByText('No one is connected yet.')).toBeVisible();
  },
};
export const GuestLabelsOpen: Story = {
  ...GuestLabels,
  play: async ({ canvasElement }) => {
    const dialog = await openPeople(canvasElement);
    await expect(dialog.getByText('Collaborator')).toBeVisible();
    await expect(dialog.getAllByText('Guest')).toHaveLength(2);
    await expect(dialog.queryByText('Sam Rivera')).not.toBeInTheDocument();
  },
};
export const LongNamesOpen: Story = {
  args: {
    people: [
      person('long', 'Alexandria Nakamura-Fernandez — a long collaborator name', () => {}),
      person('self', 'Sam Rivera'),
    ],
  },
  play: async ({ canvasElement }) => {
    const dialog = await openPeople(canvasElement);
    await expect(
      dialog.getByText('Alexandria Nakamura-Fernandez — a long collaborator name'),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', {
        name: 'Go to Alexandria Nakamura-Fernandez — a long collaborator name',
      }),
    ).toBeEnabled();
  },
};

export const DocCursorOpen: Story = {
  args: {
    people: [
      { ...person('doc', 'Alex Kim', () => {}), selection: '14:14:1:TEXT::-1' },
      { ...person('segment', 'Sam Rivera'), selection: 'unsupported-segment-token' },
    ],
  },
  play: async ({ canvasElement }) => {
    const dialog = await openPeople(canvasElement);
    await expect(dialog.getByText('Shared text cursor')).toBeVisible();
    await expect(dialog.getByText('Shared cursor position')).toBeVisible();
    await expect(dialog.queryByText('14:14:1:TEXT::-1')).not.toBeInTheDocument();
    await expect(dialog.queryByText('unsupported-segment-token')).not.toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Go to Alex Kim' })).toHaveAttribute(
      'data-selection',
      '14:14:1:TEXT::-1',
    );
  },
};

export const SheetCursorOpen: Story = {
  args: {
    people: [{ ...person('sheet', 'Alex Kim', () => {}), selection: 'internal-sheet-id!A1:B3' }],
  },
  play: async ({ canvasElement }) => {
    const dialog = await openPeople(canvasElement);
    await expect(dialog.getByText('A1:B3')).toBeVisible();
    await expect(dialog.queryByText(/internal-sheet-id/)).not.toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Go to Alex Kim' })).toHaveAttribute(
      'data-selection',
      'internal-sheet-id!A1:B3',
    );
  },
};
