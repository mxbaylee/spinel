import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import type { HistoryVersion } from '../src/shared/historyNavigation.ts';
import { failure, pending } from '../.storybook/api.ts';
import { VersionNames } from './VersionNames.tsx';

const id = '00000000-0000-4000-8000-000000000091';
const history = `GET /api/items/${id}/history`;
const versions: HistoryVersion[] = [
  { id: 'v4', capturedAt: Date.UTC(2026, 9, 14, 16, 5), name: null },
  { id: 'v3', capturedAt: Date.UTC(2026, 9, 14, 9, 30), name: 'Sent to accountant' },
  { id: 'v2', capturedAt: Date.UTC(2026, 9, 13, 18, 45), name: null, beforeRestore: true },
  { id: 'v1', capturedAt: Date.UTC(2026, 9, 12, 11, 0), name: null },
];

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.
const loaded = { [history]: { versions, canName: true } };

const meta = {
  id: 'editor-versionnames',
  title: 'Current production/Editor/VersionNames',
  component: VersionNames,
  args: { id, saved: true },
} satisfies Meta<typeof VersionNames>;
export default meta;
type Story = StoryObj<typeof meta>;

const open = async (canvasElement: HTMLElement) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Versions' }));
  await within(canvasElement).findByRole('region', { name: 'Version names' });
};

/** Collapsed, as it sits beside the editor toolbar. */
export const Closed: Story = { parameters: { api: loaded } };
/** The owner or an editor can name versions, rename them or remove their names. */
export const Open: Story = {
  parameters: { api: loaded },
  play: ({ canvasElement }) => open(canvasElement),
};
/** Viewers can browse and preview versions but cannot name them. */
export const ViewerOpen: Story = {
  parameters: { api: { [history]: { versions, canName: false } } },
  play: ({ canvasElement }) => open(canvasElement),
};
export const NoVersions: Story = {
  parameters: { api: { [history]: { versions: [], canName: true } } },
  play: ({ canvasElement }) => open(canvasElement),
};
/** Naming the current version waits until edits have saved. */
export const UnsavedChanges: Story = {
  args: { saved: false },
  parameters: { api: loaded },
  play: ({ canvasElement }) => open(canvasElement),
};
/** Every control is disabled while the list loads. */
export const Loading: Story = {
  parameters: { api: { [history]: pending() } },
  play: ({ canvasElement }) => open(canvasElement),
};
export const LoadFailed: Story = {
  parameters: { api: { [history]: failure('Could not load versions. Try again.', 500) } },
  play: ({ canvasElement }) => open(canvasElement),
};
/** The inline form for naming the current version. */
export const NamingVersion: Story = {
  parameters: { api: loaded },
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Name this version' }),
    );
  },
};
