import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { Collaborator } from '../../../web/Collaborators.tsx';
import { PresenceLabel } from '../../../web/PresenceLabel.tsx';
import { PresenceReview } from './PresenceReview.tsx';
import { EditorMockup } from './Mockups.tsx';

const jump = fn();
const self: Collaborator = {
  id: 'self',
  name: 'Alex Baylee',
  icon: 'lucide:flower',
  color: 'var(--fill-info-strong-bg)',
  foreground: 'var(--fill-info-strong-fg)',
};
const peer: Collaborator = {
  id: 'peer',
  name: 'Alex Kim',
  icon: 'lucide:cat',
  color: 'var(--fill-success-strong-bg)',
  foreground: 'var(--fill-success-strong-fg)',
  selection: 'A16',
  jump,
};
const many = [
  self,
  peer,
  ...[
    'Sam Rivera',
    'Jordan Lee',
    'Priya Patel',
    'Morgan Ellis',
    'Taylor Brooks',
    'Casey Nakamura-Fernandez',
  ].map((name, index) => ({
    ...peer,
    id: `person-${index}`,
    name,
    selection: index % 2 ? undefined : `B${index + 1}`,
    jump: index % 2 ? undefined : jump,
  })),
];
const openPeople = async (canvasElement: HTMLElement) => {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: /^People in this document/ }),
  );
};
const meta = {
  title: 'Redesign/Presence',
  component: PresenceReview,
  args: { people: [self, peer], selfId: 'self' },
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'Compact presence with accessible people list. Story callbacks are simulations, not native collaboration.',
      },
    },
  },
  decorators: [
    (Story, context) =>
      context.parameters.presenceFull ? (
        <Story />
      ) : (
        <div className="sp-ui rd-presence-stage">
          <Story />
        </div>
      ),
  ],
} satisfies Meta<typeof PresenceReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { args: { people: [] } };
export const Alone: Story = { args: { people: [self] } };
export const TwoPeople: Story = {};
export const PeopleOpen: Story = { play: ({ canvasElement }) => openPeople(canvasElement) };
export const AloneOpen: Story = {
  args: { people: [self] },
  play: ({ canvasElement }) => openPeople(canvasElement),
};
export const GuestLabels: Story = {
  args: {
    people: [
      { ...self, name: 'Guest', icon: 'lucide:user-round' },
      { ...peer, name: 'Collaborator', icon: 'lucide:user-round' },
      {
        ...peer,
        id: 'guest-2',
        name: 'Guest',
        icon: 'lucide:user-round',
        jump: undefined,
        selection: undefined,
      },
    ],
  },
  play: ({ canvasElement }) => openPeople(canvasElement),
};
export const Many: Story = { args: { people: many } };
export const ManyOpen: Story = {
  args: { people: many },
  play: ({ canvasElement }) => openPeople(canvasElement),
};
export const LongName: Story = {
  args: {
    people: [
      self,
      {
        ...peer,
        name: 'Alexandra Nakamura-Fernandez with a long display name for a shared household workspace',
      },
    ],
  },
  play: ({ canvasElement }) => openPeople(canvasElement),
};
export const JumpToPerson: Story = {
  play: async ({ canvasElement }) => {
    jump.mockClear();
    await openPeople(canvasElement);
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('button', { name: 'Go to Alex Kim' }),
    );
    await expect(jump).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole('button', { name: 'People in this document (2)' }),
      ).toHaveFocus(),
    );
  },
};
export const NoSharedPosition: Story = {
  args: { people: [self, { ...peer, jump: undefined, selection: undefined }] },
  play: async ({ canvasElement }) => {
    await openPeople(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByText('No shared cursor position')).toBeVisible();
    await expect(page.queryByRole('button', { name: /^Go to/ })).not.toBeInTheDocument();
  },
};
export const CursorLabelsInContext: Story = {
  render: () => (
    <div>
      <PresenceReview people={[self, peer]} selfId="self" />
      <div className="rd-presence-canvas" aria-label="Cursor label placement example">
        <div>
          <PresenceLabel
            name="Iris"
            icon={self.icon}
            color={self.color}
            foreground={self.foreground}
          />
        </div>
        <div>
          <PresenceLabel
            name="Moss"
            icon={peer.icon}
            color={peer.color}
            foreground={peer.foreground}
          />
        </div>
      </div>
    </div>
  ),
};
export const EditorHeader: Story = {
  parameters: { presenceFull: true },
  render: () => <EditorMockup />,
};
export const EditorPeopleOpen: Story = {
  parameters: { presenceFull: true },
  render: () => <EditorMockup />,
  play: ({ canvasElement }) => openPeople(canvasElement),
};
export const GuestHeader: Story = {
  parameters: { presenceFull: true },
  render: () => <EditorMockup guest viewOnly />,
};
export const SimulatedEditorJump: Story = {
  parameters: { presenceFull: true },
  render: () => <EditorMockup />,
  play: async ({ canvasElement }) => {
    await openPeople(canvasElement);
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('button', { name: 'Go to Alex Kim' }),
    );
    await expect(
      within(canvasElement).getByText('Simulated jump to Alex Kim’s position.'),
    ).toBeVisible();
  },
};
