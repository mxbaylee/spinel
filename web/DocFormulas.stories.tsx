import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { FormulaDialog, FormulaResultView } from './DocFormulas.tsx';
import type { FormulaDefinition } from '@spinel/doc-formulas';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sources = `/api/items/${id}/formulas/sources`;
// Keep each source response at story level. Storybook's recursive parameter
// merge would strip the Symbol marker from pending/failure helpers when merging
// them with an inherited successful response, accidentally returning its sources.
const availableSources = {
  [`GET ${sources}`]: {
    sources: [
      { itemId: 'budget', name: 'Budget' },
      { itemId: 'forecast', name: 'Forecast' },
    ],
  },
};
async function sourcesReady(canvasElement: HTMLElement) {
  await waitFor(() =>
    expect(within(canvasElement).getByLabelText('Spreadsheet')).toHaveTextContent('Budget'),
  );
}
const definition: FormulaDefinition = {
  version: 1,
  expression: '=Budget.Summary.A1',
  references: [{ start: 1, end: 18, itemId: 'budget', sheetId: 'summary', range: 'A1' }],
  format: 'currency',
};
const formulaApi = {
  [`GET ${sources}/budget`]: { sheets: [{ sheetId: 'summary', name: 'Summary' }] },
  [`POST /api/items/${id}/formulas/resolve`]: { definition },
  [`POST /api/items/${id}/formulas/evaluate`]: { ok: true, kind: 'scalar', value: 1234.56 },
};
const meta = {
  id: 'docs-formulas',
  title: 'Current production/Docs/Formulas',
  component: FormulaDialog,
  args: { id, onSave: fn(), onClose: fn() },
} satisfies Meta<typeof FormulaDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Insert: Story = {
  parameters: { api: { ...formulaApi, ...availableSources } },
  play: ({ canvasElement }) => sourcesReady(canvasElement),
};
export const Edit: Story = {
  args: { initial: { id: 'formula', start: 0, end: 18, definition } },
  parameters: { api: { ...formulaApi, ...availableSources } },
  play: ({ canvasElement }) => sourcesReady(canvasElement),
};
export const LoadingSources: Story = {
  parameters: { api: { ...formulaApi, [`GET ${sources}`]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Find a cell or range', { exact: true }));
    await expect(await canvas.findByText('Loading spreadsheets…', { exact: true })).toBeVisible();
    await expect(canvas.queryByLabelText('Spreadsheet')).not.toBeInTheDocument();
  },
};
export const NoSources: Story = {
  parameters: { api: { ...formulaApi, [`GET ${sources}`]: { sources: [] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Find a cell or range', { exact: true }));
    await expect(
      await canvas.findByText(
        'No spreadsheets available. You can use numbers and arrays directly.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(within(canvas.getByLabelText('Spreadsheet')).getAllByRole('option')).toHaveLength(
      1,
    );
  },
};
export const SourceError: Story = {
  parameters: { api: { ...formulaApi, [`GET ${sources}`]: failure('Unavailable', 503) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Could not load source suggestions. You can still type a formula.',
    );
    await userEvent.click(canvas.getByText('Find a cell or range', { exact: true }));
    await expect(within(canvas.getByLabelText('Spreadsheet')).getAllByRole('option')).toHaveLength(
      1,
    );
  },
};
export const Dark: Story = {
  globals: { theme: 'dark' },
  parameters: { api: { ...formulaApi, ...availableSources } },
  play: ({ canvasElement }) => sourcesReady(canvasElement),
};
export const Phone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  parameters: { api: { ...formulaApi, ...availableSources } },
  play: ({ canvasElement }) => sourcesReady(canvasElement),
};
const spaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const spaceFormulas = `/api/spaces/${spaceId}/items/${id}/formulas`;
const spaceApi = {
  [`GET ${spaceFormulas}/sources`]: {
    sources: [{ itemId: 'budget', name: 'Budget' }],
  },
  [`GET ${spaceFormulas}/sources/budget`]: { sheets: [{ sheetId: 'summary', name: 'Summary' }] },
  [`POST ${spaceFormulas}/resolve`]: { definition },
  [`POST ${spaceFormulas}/evaluate`]: { ok: true, kind: 'scalar', value: 1234.56 },
};
async function spacePreview(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await sourcesReady(canvasElement);
  await userEvent.click(canvas.getByRole('combobox', { name: /^Formula$/ }));
  await userEvent.keyboard('{End}');
  await userEvent.click(canvas.getByText('Find a cell or range', { exact: true }));
  await userEvent.selectOptions(canvas.getByLabelText('Spreadsheet'), 'budget');
  await waitFor(() => expect(canvas.getByLabelText('Worksheet')).toHaveTextContent('Summary'));
  await userEvent.selectOptions(canvas.getByLabelText('Worksheet'), 'summary');
  await userEvent.click(canvas.getByRole('button', { name: 'Insert reference' }));
  await expect(canvas.getByRole('combobox', { name: /^Formula$/ })).toHaveValue(
    '=Budget.Summary.A1',
  );
  await userEvent.selectOptions(canvas.getByLabelText('Number format'), 'currency');
  await userEvent.click(canvas.getByRole('button', { name: /^Preview$/ }));
  await expect(await canvas.findByText('$1,234.56', { exact: true })).toBeVisible();
}
export const SpaceSources: Story = {
  args: { spaceId },
  parameters: { api: spaceApi },
  play: ({ canvasElement }) => spacePreview(canvasElement),
};
export const SpaceSourcesDark: Story = {
  ...SpaceSources,
  globals: { theme: 'dark' },
};
export const SpaceSourcesPhone: Story = {
  ...SpaceSources,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
export const SpaceSourceUnavailable: Story = {
  args: { spaceId, initial: { id: 'formula', start: 0, end: 18, definition } },
  parameters: {
    api: {
      ...spaceApi,
      [`POST ${spaceFormulas}/evaluate`]: { ok: false, reason: 'private-source' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await sourcesReady(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Preview$/ }));
    await expect(await canvas.findByRole('status')).toHaveTextContent('access');
  },
};
function SpaceGuestLocation({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = { href: location.href, state: history.state };
    history.replaceState(null, '', `/share/${spaceId}`);
    setReady(true);
    return () => history.replaceState(original.state, '', original.href);
  }, []);
  return ready ? children : null;
}
const guestFormulas = `/api/guest-spaces/${spaceId}/items/${id}/formulas`;
const guestSpaceApi = {
  [`GET ${guestFormulas}/sources`]: { sources: [{ itemId: 'budget', name: 'Budget' }] },
  [`GET ${guestFormulas}/sources/budget`]: { sheets: [{ sheetId: 'summary', name: 'Summary' }] },
  [`POST ${guestFormulas}/resolve`]: { definition },
  [`POST ${guestFormulas}/evaluate`]: { ok: true, kind: 'scalar', value: 1234.56 },
};
export const SpaceGuestSources: Story = {
  args: { spaceId },
  decorators: [
    (Story) => (
      <SpaceGuestLocation>
        <Story />
      </SpaceGuestLocation>
    ),
  ],
  parameters: { api: guestSpaceApi },
  play: ({ canvasElement }) => spacePreview(canvasElement),
};
export const SpaceGuestSourcesDark: Story = {
  ...SpaceGuestSources,
  globals: { theme: 'dark' },
};
export const SpaceGuestSourcesPhone: Story = {
  ...SpaceGuestSources,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
export const SpaceGuestExternalUnavailable: Story = {
  ...SpaceGuestSources,
  args: { spaceId, initial: { id: 'formula', start: 0, end: 18, definition } },
  parameters: {
    api: {
      ...guestSpaceApi,
      [`POST ${guestFormulas}/evaluate`]: { ok: false, reason: 'private-source' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await sourcesReady(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Preview$/ }));
    await expect(await canvas.findByRole('status')).toHaveTextContent('access');
  },
};
export const Scalar: Story = {
  render: () => (
    <p>
      The current budget is{' '}
      <FormulaResultView
        definition={definition}
        result={{ ok: true, kind: 'scalar', value: 1234.56 }}
      />
      .
    </p>
  ),
};
export const Table: Story = {
  render: () => (
    <FormulaResultView
      definition={{ ...definition, format: 'general' }}
      result={{
        ok: true,
        kind: 'table',
        rows: [
          ['Item', 'Actual', 'Budget'],
          ['Supplies', 120, 150],
          ['Travel', 320, 350],
        ],
      }}
    />
  ),
};
export const ThirtyRows: Story = {
  render: () => (
    <FormulaResultView
      definition={{ ...definition, format: 'general' }}
      result={{
        ok: true,
        kind: 'table',
        rows: Array.from({ length: 30 }, (_, row) => [`Item ${row + 1}`, row * 10, row * 12]),
      }}
    />
  ),
};
export const Empty: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: true, kind: 'scalar', value: null }} />
  ),
};
export const Calculating: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: false, reason: 'loading' }} />
  ),
};
export const PrivateSource: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: false, reason: 'private-source' }} />
  ),
};
export const MissingSource: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: false, reason: 'missing-source' }} />
  ),
};
export const InvalidFormula: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: false, reason: 'invalid-formula' }} />
  ),
};
export const TooLarge: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: false, reason: 'too-large' }} />
  ),
};
export const Busy: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: false, reason: 'busy' }} />
  ),
};
export const TimedOut: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: false, reason: 'timeout' }} />
  ),
};
export const Unavailable: Story = {
  render: () => (
    <FormulaResultView definition={definition} result={{ ok: false, reason: 'unavailable' }} />
  ),
};
