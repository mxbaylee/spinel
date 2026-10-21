import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { FormulaDialog, FormulaResultView } from './DocFormulas.tsx';
import type { FormulaDefinition } from '@spinel/doc-formulas';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sources = `/api/items/${id}/formulas/sources`;
const definition: FormulaDefinition = {
  version: 1,
  expression: '=Budget.Summary.A1',
  references: [{ start: 1, end: 18, itemId: 'budget', sheetId: 'summary', range: 'A1' }],
  format: 'currency',
};
const meta = {
  id: 'docs-formulas',
  title: 'Current production/Docs/Formulas',
  component: FormulaDialog,
  args: { id, onSave: fn(), onClose: fn() },
  parameters: {
    api: {
      [`GET ${sources}`]: {
        sources: [
          { itemId: 'budget', name: 'Budget' },
          { itemId: 'forecast', name: 'Forecast' },
        ],
      },
      [`GET ${sources}/budget`]: { sheets: [{ sheetId: 'summary', name: 'Summary' }] },
      [`POST /api/items/${id}/formulas/resolve`]: { definition },
      [`POST /api/items/${id}/formulas/evaluate`]: { ok: true, kind: 'scalar', value: 1234.56 },
    },
  },
} satisfies Meta<typeof FormulaDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Insert: Story = {};
export const Edit: Story = { args: { initial: { id: 'formula', start: 0, end: 18, definition } } };
export const LoadingSources: Story = { parameters: { api: { [`GET ${sources}`]: pending() } } };
export const NoSources: Story = { parameters: { api: { [`GET ${sources}`]: { sources: [] } } } };
export const SourceError: Story = {
  parameters: { api: { [`GET ${sources}`]: failure('Unavailable', 503) } },
};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
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
