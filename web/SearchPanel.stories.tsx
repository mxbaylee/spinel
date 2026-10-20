import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { emptySearch } from '../src/shared/search.ts';
import type { SearchItem } from '../src/shared/search.ts';
import type { ItemKind, WorkspaceItem } from '../src/shared/workspace.ts';
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
const loaded: WorkspaceItem[] = results.map(({ paths: _paths, ...rest }) => rest);

const meta = {
  title: 'Dashboard/SearchPanel',
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
};
export const NoResults: Story = {
  args: { query: { ...emptySearch, q: 'passport' } },
  parameters: { api: { 'GET /api/items/search': { items: [] } } },
};
/** While the server answers, matches among already-loaded items stand in. */
export const Loading: Story = {
  args: { query: { ...emptySearch, q: 'budget' } },
  parameters: { api: { 'GET /api/items/search': pending() } },
};
export const Failed: Story = {
  args: { query: { ...emptySearch, q: 'budget' } },
  parameters: { api: { 'GET /api/items/search': failure('Could not search. Try again.', 500) } },
};
