import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { FileItem } from '../src/shared/workspace.ts';
import { canAdminister } from '../src/shared/workspace.ts';
import { DashboardFiles } from './DashboardFiles.tsx';
import type { DashboardFilesProps, DashboardOfflineState } from './DashboardFiles.tsx';

const changed = Date.UTC(2026, 9, 20, 12);
const items: FileItem[] = [
  {
    id: 'folder',
    name: 'Household',
    kind: 'folder',
    access: 'owner',
    parentId: null,
    createdAt: changed,
    updatedAt: changed,
    tags: [],
  },
  {
    id: 'budget',
    name: 'Quarterly budget',
    kind: 'sheet',
    access: 'owner',
    parentId: null,
    createdAt: changed,
    updatedAt: changed,
    tags: ['home', 'budget', 'planning'],
  },
  {
    id: 'notes',
    name: 'Notes for next week',
    kind: 'doc',
    access: 'editor',
    parentId: null,
    ownerName: 'Alex Kim',
    sharedAt: changed,
    createdAt: changed,
    updatedAt: changed,
    tags: ['work'],
  },
  {
    id: 'reading',
    name: 'Reading list',
    kind: 'sheet',
    access: 'viewer',
    parentId: null,
    ownerName: 'Alex Kim',
    sharedAt: changed,
    createdAt: changed,
    updatedAt: changed,
    tags: [],
  },
  {
    id: 'space',
    name: 'Autumn plans',
    kind: 'space',
    access: 'admin',
    parentId: null,
    ownerName: 'Alex Kim',
    sharedAt: changed,
    createdAt: changed,
    updatedAt: changed,
    tags: ['travel'],
  },
];
const action = fn();
// Fixtures model capabilities supplied by the controller, including File admin.
const actionsFor: NonNullable<DashboardFilesProps['actionsFor']> = (item) => [
  { label: 'Tags…', onClick: action },
  ...(canAdminister(item.access)
    ? [
        { label: 'Share…', onClick: action },
        { label: 'Rename…', onClick: action },
        { label: 'Move…', onClick: action },
        { label: 'Trash', onClick: action, destructive: true },
      ]
    : [{ label: 'File into folder…', onClick: action }]),
];

const meta = {
  id: 'dashboard-files',
  title: 'Current production/Dashboard/File list',
  component: DashboardFiles,
  args: {
    items,
    layout: 'list',
    onOpen: fn(),
    actionsFor,
    onOpenTrash: fn(),
    offlineState: (item: FileItem): DashboardOfflineState =>
      item.id === 'budget' ? 'available' : null,
  },
} satisfies Meta<typeof DashboardFiles<FileItem>>;
export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Grid: Story = { args: { layout: 'grid' } };
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
export const GridPhone: Story = { ...Phone, args: { layout: 'grid' } };
export const Shared: Story = {
  args: {
    items: items.filter((item) => item.access !== 'owner'),
    dateMode: 'shared',
    onOpenTrash: undefined,
    label: 'Shared with me',
  },
};
export const SearchResults: Story = {
  args: {
    items: items.slice(1),
    onOpenTrash: undefined,
    label: 'Search results',
    openLabel: (item: FileItem) => `Open result ${item.name}`,
    details: (item: FileItem) =>
      item.access === 'owner' ? 'My files / Household' : 'Shared with me',
  },
};
export const Empty: Story = {
  args: { items: [], onOpenTrash: undefined },
};
export const NoSearchResults: Story = {
  args: {
    items: [],
    onOpenTrash: undefined,
    emptyMessage: 'No matching files. Try another search or clear a filter.',
  },
};
export const Loading: Story = { args: { loading: true } };
export const Error: Story = {
  args: { error: 'Could not load your files. Try again.', onRetry: fn() },
};
export const Busy: Story = { args: { busy: true } };
export const Offline: Story = {
  args: {
    actionsFor: () => [],
    offlineState: (item: FileItem) =>
      item.kind === 'folder' ? null : item.id === 'budget' ? 'available' : 'needs-connection',
    onOpenTrash: undefined,
  },
};
export const LongNames: Story = {
  args: {
    items: [
      {
        ...items[1],
        name: 'A very long document name that remains readable on a small phone screen',
        tags: ['a-long-personal-tag', 'travel'],
      },
    ],
  },
  globals: { viewport: { value: 'phone', isRotated: false } },
};
export const OwnerMenu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for Quarterly budget' }),
    );
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Trash' }),
    ).toBeVisible();
  },
};
export const ViewerMenu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for Reading list' }),
    );
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findByRole('menuitem', { name: 'File into folder…' })).toBeVisible();
    await expect(page.queryByRole('menuitem', { name: 'Trash' })).not.toBeInTheDocument();
  },
};
export const FileAdminMenu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for Autumn plans' }),
    );
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Share…' }),
    ).toBeVisible();
  },
};
