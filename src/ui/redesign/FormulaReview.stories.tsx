import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { FormulaReview } from './FormulaReview.tsx';

const meta = {
  title: 'Redesign/Formula authoring',
  component: FormulaReview,
  args: { onApply: fn(), onCancel: fn() },
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'Design-only authoring flows. Completion and result rendering use production helpers; preview values are explicitly sample data, with no formula evaluation or document writes.',
      },
    },
  },
  decorators: [
    (Story, context) => (
      <div className="sp-ui rd-formula-stage">
        <h1>{context.args.mode === 'edit' ? 'Edit formula' : 'Insert formula'}</h1>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormulaReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Insert: Story = {};
export const Edit: Story = { args: { mode: 'edit', state: 'scalar' } };
export const LoadingSources: Story = { args: { state: 'source-loading' } };
export const NoSources: Story = { args: { state: 'source-empty' } };
export const SourceError: Story = { args: { state: 'source-error' } };
export const SourceRetry: Story = {
  args: { state: 'source-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Retry sources' }));
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
    await expect(canvas.getByRole('combobox', { name: 'Spreadsheet' })).toHaveTextContent('Budget');
  },
};
export const LoadingWorksheets: Story = { args: { state: 'worksheet-loading' } };
export const WorksheetError: Story = { args: { state: 'worksheet-error' } };
export const WorksheetRetry: Story = {
  args: { state: 'worksheet-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Retry worksheets' }));
    await expect(canvas.getByRole('combobox', { name: 'Worksheet' })).toHaveTextContent('Summary');
  },
};
export const Dark: Story = { globals: { theme: 'dark' }, args: { state: 'scalar' } };
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
export const Scalar: Story = { args: { state: 'scalar' } };
export const Table: Story = { args: { state: 'table' } };
export const ThirtyRows: Story = { args: { state: 'thirty-rows' } };
export const LastTablePage: Story = {
  args: { state: 'thirty-rows' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
    await expect(canvas.getByText('Rows 21–30 of 30')).toBeVisible();
    await expect(canvas.getByText('Item 30')).toBeVisible();
    await expect(canvas.queryByText('Item 1')).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Next' })).toBeDisabled();
  },
};
export const Empty: Story = { args: { state: 'empty' } };
export const Calculating: Story = { args: { state: 'calculating' } };
export const PrivateSource: Story = { args: { state: 'private-source' } };
export const MissingSource: Story = { args: { state: 'missing-source' } };
export const InvalidFormula: Story = { args: { state: 'invalid-formula' } };
export const TooLarge: Story = { args: { state: 'too-large' } };
export const Busy: Story = { args: { state: 'busy' } };
export const TimedOut: Story = { args: { state: 'timeout' } };
export const Unavailable: Story = { args: { state: 'unavailable' } };
export const PreviewRetry: Story = {
  args: { state: 'timeout' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Retry preview' }));
    await expect(
      canvas.getByText(
        'Sample preview shown. This design preview does not calculate your expression.',
      ),
    ).toBeVisible();
  },
};
export const Offline: Story = { args: { state: 'offline' } };
export const Saving: Story = { args: { state: 'saving' } };
export const SaveError: Story = { args: { mode: 'edit', state: 'save-error' } };
export const SaveRetry: Story = {
  args: { mode: 'edit', state: 'save-error' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('combobox', { name: /^Formula$/ })).toHaveValue(
      '=Budget.Summary.A1',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onApply).toHaveBeenCalledWith('=Budget.Summary.A1', 'currency');
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
  },
};
export const Autocomplete: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('combobox', { name: /^Formula$/ });
    await userEvent.clear(input);
    await userEvent.type(input, '=Bu');
    await expect(canvas.getByRole('option', { name: 'Budget' })).toBeVisible();
  },
};
export const KeyboardCompletion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('combobox', { name: /^Formula$/ });
    await userEvent.clear(input);
    await userEvent.type(input, '=Bu');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(input).toHaveValue('=Budget.'));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(input).toHaveValue('=Budget.Summary.'));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(input).toHaveValue('=Budget.Summary.A1'));
    await expect(input).toHaveFocus();
  },
};
export const SourcePicker: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Find a cell or range'));
    await userEvent.clear(canvas.getByRole('textbox', { name: 'Cell or range' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Cell or range' }), 'B2:C8');
    await userEvent.click(canvas.getByRole('button', { name: 'Use this reference' }));
    await expect(canvas.getByRole('combobox', { name: /^Formula$/ })).toHaveValue(
      '=Budget.Summary.B2:C8',
    );
  },
};
export const EditedExpressionClearsPreview: Story = {
  args: { state: 'scalar' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByRole('combobox', { name: /^Formula$/ }));
    await userEvent.type(canvas.getByRole('combobox', { name: /^Formula$/ }), '=1+2');
    await expect(
      canvas.queryByRole('region', { name: 'Sample formula preview' }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Preview sample' }));
    await expect(
      canvas.getByText(
        'Sample preview shown. This design preview does not calculate your expression.',
      ),
    ).toBeVisible();
  },
};
export const Cancel: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancel).toHaveBeenCalled();
  },
};
