import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { emptySearch } from '../src/shared/search.ts';
import type { SearchItem } from '../src/shared/search.ts';
import type { FileItem, ItemKind } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { SearchPanel } from './SearchPanel.tsx';

const now = Date.now();
const hour = 3_600_000;
const entry = (
  n: number,
  name: string,
  kind: ItemKind,
  age: number,
  extra: Partial<SearchItem> = {},
): SearchItem => ({
  access: 'owner',
  id: `00000000-0000-4000-8000-0000000000${40 + n}`,
  parentId: null,
  kind,
  name,
  createdAt: now - 60 * 24 * hour,
  updatedAt: now - age * hour,
  tags: [],
  paths: [],
  ...extra,
});
const results = [
  entry(1, 'Quarterly budget', 'sheet', 3, {
    tags: ['budget', 'q4'],
    paths: ['Household / Finance'],
  }),
  entry(2, 'Budget notes', 'doc', 30, { paths: ['Work'] }),
  entry(3, 'Team budget', 'sheet', 80, {
    access: 'viewer',
    ownerName: 'Alex Kim',
    sharedAt: now - 90 * hour,
    placementParentId: null,
  }),
  entry(4, 'Budget kickoff', 'doc', 200, {
    access: 'editor',
    ownerName: 'Alex Kim',
    sharedAt: now - 300 * hour,
  }),
];
const loaded: FileItem[] = results.map(({ paths: _paths, ...rest }) => rest);

const meta = {
  id: 'dashboard-searchpanel',
  title: 'Current production/Dashboard/SearchPanel',
  component: SearchPanel,
  args: {
    query: { ...emptySearch },
    onChange: () => {},
    loadedItems: loaded,
    onOpen: () => {},
  },
  // The dashboard owns the query; hold it here so typing and filters work.
  render: ({ query: initial, ...args }) => {
    const [query, setQuery] = useState(initial);
    return <SearchPanel {...args} query={query} onChange={setQuery} />;
  },
} satisfies Meta<typeof SearchPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No query or filter: only the controls show, with no results section. */
export const EmptyQuery: Story = {};
export const Results: Story = {
  args: { query: { ...emptySearch, q: 'budget' } },
  parameters: { api: { 'GET /api/items/search': { items: results } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('4 results', { exact: true });
    await expect(await canvas.findByText('Household / Finance', { exact: true })).toBeVisible();
  },
};
export const NoResults: Story = {
  args: { query: { ...emptySearch, q: 'passport' } },
  parameters: { api: { 'GET /api/items/search': { items: [] } } },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(
        'No matching files. Try another search or clear a filter.',
        { exact: true },
      ),
    ).toBeVisible();
  },
};
/** While the server answers, matches among already-loaded items stand in. */
export const Loading: Story = {
  args: { query: { ...emptySearch, q: 'budget' } },
  parameters: { api: { 'GET /api/items/search': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Searching…', { exact: true })).toBeVisible();
    // Local matches intentionally remain available while the server is pending.
    await expect(canvas.getAllByRole('button', { name: /^Open result / })).toHaveLength(4);
  },
};
export const Failed: Story = {
  args: { query: { ...emptySearch, q: 'budget' } },
  parameters: { api: { 'GET /api/items/search': failure('Could not search. Try again.', 500) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Could not search. Try again.',
    );
    await expect(canvas.queryAllByRole('button', { name: /^Open result / })).toHaveLength(0);
    await expect(canvas.getByRole('button', { name: /^Retry search$/ })).toBeVisible();
  },
};
const spaceResult: SearchItem<FileItem> = {
  ...results[0],
  id: '00000000-0000-4000-8000-000000000049',
  kind: 'space',
  name: 'Budget Space',
  paths: ['Household'],
  tags: ['budget'],
};
export const SpaceRootsOnly: Story = {
  args: {
    query: { ...emptySearch, type: 'space' },
    loadedItems: [spaceResult],
    spacesEnabled: true,
  },
  parameters: { api: { 'GET /api/items/search': { items: [spaceResult] } } },
};
