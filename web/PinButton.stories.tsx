import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { PinButton, PinsProvider } from './Pins.tsx';

const item: WorkspaceItem = {
  access: 'owner',
  id: '00000000-0000-4000-8000-000000000021',
  parentId: null,
  kind: 'sheet',
  name: 'Quarterly budget',
  createdAt: Date.UTC(2026, 8, 1),
  updatedAt: Date.UTC(2026, 9, 12),
  tags: [],
};
// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.
const withPins: Decorator = (Story) => (
  <PinsProvider enabled>
    <Story />
  </PinsProvider>
);

const meta = {
  id: 'dashboard-pinbutton',
  title: 'Current production/Dashboard/PinButton',
  component: PinButton,
  args: { item },
  decorators: [withPins],
} satisfies Meta<typeof PinButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Unpinned: Story = { parameters: { api: { 'GET /api/items/pins': { items: [] } } } };
export const Pinned: Story = { parameters: { api: { 'GET /api/items/pins': { items: [item] } } } };
/** Disabled until the pin list has loaded. */
export const Loading: Story = { parameters: { api: { 'GET /api/items/pins': pending() } } };
/** Disabled when the pin list failed to load, since pin state is unknown. */
export const LoadFailed: Story = {
  parameters: { api: { 'GET /api/items/pins': failure('Could not load pins.', 500) } },
};
