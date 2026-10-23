import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, within } from 'storybook/test';
import { emptySearch } from '../src/shared/search.ts';
import type { SearchItem } from '../src/shared/search.ts';
import type { FileItem, ItemKind } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { SearchPanel } from './SearchPanel.tsx';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';

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
/** Until a fresh authorized catalog arrives, no stale loaded matches are shown. */
export const Loading: Story = {
  args: { query: { ...emptySearch, q: 'budget' } },
  parameters: { api: { 'GET /api/items/search': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Searching…', { exact: true })).toBeVisible();
    // Loaded items cannot establish current access or complete scoped ancestry.
    await expect(canvas.queryAllByRole('button', { name: /^Open result / })).toHaveLength(0);
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

export const ActiveFilters: Story = {
  args: {
    query: {
      ...emptySearch,
      q: 'budget',
      type: 'sheet',
      owner: 'shared',
      tag: 'travel',
      modified: 'week',
    },
  },
  parameters: { api: { 'GET /api/items/search': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const remove = canvas.getByRole('button', { name: 'Remove Tag: travel' });
    remove.focus();
    await userEvent.keyboard('{Enter}');
    await expect(
      canvas.queryByRole('button', { name: 'Remove Tag: travel' }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole('searchbox')).toHaveValue(
      'budget type:sheet owner:shared modified:week',
    );
    await expect(
      canvas.getByRole('button', { name: 'Remove Ownership: Shared with me' }),
    ).toBeEnabled();
  },
};

export const InvalidDraft: Story = {
  args: { query: { ...emptySearch, type: 'sheet', owner: 'shared' } },
  parameters: { api: { 'GET /api/items/search': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Paste is atomic: no transient valid prefix should replace the applied filters.
    fireEvent.change(canvas.getByRole('searchbox'), { target: { value: 'type:doc type:sheet' } });
    await expect(canvas.getByRole('searchbox')).toHaveAttribute('aria-invalid', 'true');
    await expect(canvas.getByText('Last valid filters — results paused:')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Search options' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Remove Type: Sheet' })).toBeDisabled();
    await expect(canvas.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Search this as plain text' }));
    await expect(canvas.getByRole('searchbox')).toHaveValue(
      '"type:doc type:sheet" type:sheet owner:shared',
    );
    await expect(canvas.getByRole('searchbox')).toHaveAttribute('aria-invalid', 'false');
    await expect(
      canvas.getByRole('button', { name: 'Remove Ownership: Shared with me' }),
    ).toBeEnabled();
  },
};

export const LongInvalidDraft: Story = {
  parameters: { api: { 'GET /api/items/search': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const text = 'x'.repeat(201);
    fireEvent.change(canvas.getByRole('searchbox'), { target: { value: text } });
    await expect(canvas.getByRole('searchbox')).toHaveValue(text);
    await expect(canvas.getByRole('button', { name: 'Search this as plain text' })).toBeDisabled();
    await expect(canvas.getByText(/Shorten the text first/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search and filters' }));
    await expect(canvas.getByRole('searchbox')).toHaveValue('');
    await expect(canvas.getByRole('searchbox')).toHaveAttribute('aria-invalid', 'false');
    await expect(canvas.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument();
  },
};

export const SearchOptions: Story = {
  args: { query: { ...emptySearch, q: 'type:sheet', owner: 'shared' } },
  parameters: { api: { 'GET /api/items/search': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Search options' }));
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Search options',
      }),
    );
    await expect(dialog.getByRole('textbox', { name: 'Search words' })).toHaveValue('type:sheet');
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'File type' }), 'doc');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Search words' }), {
      target: { value: 'x'.repeat(201) },
    });
    await expect(dialog.getByRole('textbox', { name: 'Search words' })).toHaveValue(
      'x'.repeat(201),
    );
    await expect(dialog.getByRole('button', { name: 'Apply search' })).toBeDisabled();
    await assertDialogControls(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Search options',
      }),
    );
    fireEvent.change(dialog.getByRole('textbox', { name: 'Search words' }), {
      target: { value: 'type:sheet' },
    });
    await userEvent.type(dialog.getByRole('combobox', { name: 'Tag' }), 'summer travel');
    await userEvent.click(dialog.getByRole('button', { name: 'Apply search' }));
    await expect(canvas.getByRole('searchbox')).toHaveValue(
      '"type:sheet" type:doc owner:shared tag:"summer travel"',
    );
    await expect(canvas.getByRole('button', { name: 'Remove Type: Doc' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Remove Tag: summer travel' })).toBeVisible();
  },
};
