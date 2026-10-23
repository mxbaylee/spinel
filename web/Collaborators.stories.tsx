import type { Meta, StoryObj } from '@storybook/react-vite';
import { Collaborators, collaboratorColor } from './Collaborators.tsx';
import type { Collaborator } from './Collaborators.tsx';

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
