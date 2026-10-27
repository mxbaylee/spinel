import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { FormulaDialog, FormulaResultView } from './DocFormulas.tsx';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import { FormulaSaveError, type FormulaFailureReason } from '@spinel/doc-formulas';

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

function FormulaFocusReturn(args: ComponentProps<typeof FormulaDialog>) {
  const [open, setOpen] = useState(true);
  const editor = useRef<HTMLDivElement>(null);
  return (
    <section aria-label="Formula focus return">
      <div
        ref={editor}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Document editor"
        tabIndex={0}
      >
        Document text.
      </div>
      {open && (
        <FormulaDialog
          {...args}
          onClose={() => {
            args.onClose();
            setOpen(false);
            // Match DocEditor's restoration after the modal closes.
            requestAnimationFrame(() => editor.current?.focus());
          }}
        />
      )}
    </section>
  );
}

function returnsDocumentFocus(action: 'save' | 'cancel'): Story {
  const save = fn(async (_definition: FormulaDefinition, _signal: AbortSignal) => {});
  const close = fn();
  return {
    args: { onSave: save, onClose: close },
    parameters: { api: { ...formulaApi, ...availableSources } },
    render: (args) => <FormulaFocusReturn {...args} />,
    play: async ({ canvasElement }) => {
      save.mockClear();
      close.mockReset();
      close.mockImplementation(() => {
        // The browser modal must release focus before the parent's callback,
        // even before React has committed the dialog's unmount.
        expect(canvasElement.querySelector('dialog')?.open).toBe(false);
      });
      await sourcesReady(canvasElement);
      const canvas = within(canvasElement);
      const dialog = canvas.getByRole('dialog', { name: 'Insert formula' });
      if (action === 'save') {
        const expression = canvas.getByRole('combobox', { name: 'Formula' });
        await userEvent.clear(expression);
        await userEvent.type(expression, definition.expression);
        await userEvent.click(canvas.getByRole('button', { name: /^Insert formula$/ }));
      } else await userEvent.click(canvas.getByRole('button', { name: /^Cancel$/ }));
      await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      await expect(save).toHaveBeenCalledTimes(action === 'save' ? 1 : 0);
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      const editor = canvas.getByRole('textbox', { name: 'Document editor' });
      await waitFor(() => expect(editor).toHaveFocus());
      await userEvent.keyboard('Continue writing');
      await expect(editor).toHaveTextContent('Continue writing');
    },
  };
}
export const SaveReturnsFocus: Story = returnsDocumentFocus('save');
export const CancelReturnsFocus: Story = returnsDocumentFocus('cancel');

function FormulaConnectivity(args: ComponentProps<typeof FormulaDialog>) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const change = (event: Event) => setOnline((event as CustomEvent<boolean>).detail);
    window.addEventListener('storybook-formula-connection', change);
    return () => window.removeEventListener('storybook-formula-connection', change);
  }, []);
  return <FormulaDialog {...args} remoteAvailable={online} />;
}

export const OfflineKeepsDraft: Story = {
  args: { onClose: fn() },
  parameters: { api: { ...formulaApi, ...availableSources } },
  render: (args) => <FormulaConnectivity {...args} />,
  play: async ({ canvasElement, args }) => {
    await sourcesReady(canvasElement);
    const canvas = within(canvasElement);
    const expression = canvas.getByRole('combobox', { name: /^Formula$/ });
    await userEvent.clear(expression);
    await userEvent.type(expression, definition.expression);
    await userEvent.selectOptions(canvas.getByLabelText('Number format'), 'currency');
    await userEvent.click(canvas.getByRole('button', { name: /^Preview$/ }));
    await expect(await canvas.findByText('$1,234.56')).toBeVisible();
    window.dispatchEvent(new CustomEvent('storybook-formula-connection', { detail: false }));
    await waitFor(() => expect(canvas.queryByText('$1,234.56')).not.toBeInTheDocument());
    await expect(expression).toHaveValue(definition.expression);
    await expect(canvas.getByLabelText('Number format')).toHaveValue('currency');
    await expect(canvas.getByRole('dialog', { name: 'Insert formula' })).toBeVisible();
    await expect(args.onClose).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('storybook-formula-connection', { detail: true }));
    await sourcesReady(canvasElement);
    await expect(expression).toHaveValue(definition.expression);
    await expect(canvas.getByLabelText('Number format')).toHaveValue('currency');
  },
};

function saveFailure(reason: FormulaFailureReason): Story {
  const save = fn(async (_definition: FormulaDefinition, _signal: AbortSignal) => {
    throw new FormulaSaveError(reason);
  });
  const close = fn();
  return {
    args: {
      initial: { id: 'formula', start: 0, end: 18, definition },
      onSave: save,
      onClose: close,
    },
    parameters: { api: { ...formulaApi, ...availableSources } },
    play: async ({ canvasElement }) => {
      save.mockClear();
      close.mockClear();
      await sourcesReady(canvasElement);
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole('button', { name: /^Save formula$/ }));
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
        new FormulaSaveError(reason).message,
      );
      await expect(canvas.getByRole('combobox', { name: /^Formula$/ })).toHaveValue(
        definition.expression,
      );
      await expect(canvas.getByLabelText('Number format')).toHaveValue('currency');
      await expect(save).toHaveBeenCalledTimes(1);
      await expect(close).not.toHaveBeenCalled();
      await expect(
        canvas.getByRole('button', {
          name: new FormulaSaveError(reason).retryable ? /^Retry save$/ : /^Save formula$/,
        }),
      ).toBeEnabled();
    },
  };
}
export const SaveBusy: Story = saveFailure('busy');
export const SaveTimedOut: Story = saveFailure('timeout');
export const SaveUnavailable: Story = saveFailure('unavailable');
export const SaveInvalid: Story = saveFailure('invalid-formula');
export const SavePrivateSource: Story = saveFailure('private-source');
export const SaveTooLarge: Story = saveFailure('too-large');

const retrySave = fn(async (_definition: FormulaDefinition, _signal: AbortSignal) => {});
const retryClose = fn();
export const SaveRetry: Story = {
  args: {
    initial: { id: 'formula', start: 0, end: 18, definition },
    onSave: retrySave,
    onClose: retryClose,
  },
  parameters: { api: { ...formulaApi, ...availableSources } },
  play: async ({ canvasElement }) => {
    retrySave.mockReset();
    retryClose.mockClear();
    retrySave.mockRejectedValueOnce(new FormulaSaveError('busy')).mockResolvedValue(undefined);
    await sourcesReady(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Save formula$/ }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Calculation is busy');
    await expect(retrySave).toHaveBeenCalledTimes(1);
    await expect(retryClose).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: /^Retry save$/ }));
    await waitFor(() => expect(retryClose).toHaveBeenCalledTimes(1));
    await expect(retrySave).toHaveBeenCalledTimes(2);
    for (const [saved] of retrySave.mock.calls) await expect(saved).toEqual(definition);
  },
};

const heldSave = fn(async (_definition: FormulaDefinition, _signal: AbortSignal) => {});
const heldClose = fn();
export const SaveDoubleActivation: Story = {
  args: {
    initial: { id: 'formula', start: 0, end: 18, definition },
    onSave: heldSave,
    onClose: heldClose,
  },
  parameters: { api: { ...formulaApi, ...availableSources } },
  play: async ({ canvasElement }) => {
    heldSave.mockReset();
    heldClose.mockClear();
    let release!: () => void;
    heldSave.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await sourcesReady(canvasElement);
    const form = canvasElement.querySelector('form')!;
    // Two submissions in the same turn bypass the rendered disabled attribute.
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => expect(heldSave).toHaveBeenCalledTimes(1));
    await expect(heldClose).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(heldClose).toHaveBeenCalledTimes(1));
    await expect(heldSave).toHaveBeenCalledTimes(1);
  },
};

const staleSave = fn(async (_definition: FormulaDefinition, _signal: AbortSignal) => {});
const staleClose = fn();
export const SaveCancelledRetry: Story = {
  args: {
    initial: { id: 'formula', start: 0, end: 18, definition },
    onSave: staleSave,
    onClose: staleClose,
  },
  parameters: { api: { ...formulaApi, ...availableSources } },
  play: async ({ canvasElement }) => {
    staleSave.mockReset();
    staleClose.mockClear();
    let release!: () => void;
    staleSave
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    await sourcesReady(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Save formula$/ }));
    await waitFor(() => expect(staleSave).toHaveBeenCalledTimes(1));
    const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await expect(staleSave.mock.calls[0]![1].aborted).toBe(true);
    } finally {
      if (original) Object.defineProperty(document, 'visibilityState', original);
      else Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
      release();
    }
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /^Save formula$/ })).toBeEnabled(),
    );
    await expect(staleClose).not.toHaveBeenCalled();
    await expect(canvas.getByRole('combobox', { name: /^Formula$/ })).toHaveValue(
      definition.expression,
    );
    await userEvent.click(canvas.getByRole('button', { name: /^Save formula$/ }));
    await waitFor(() => expect(staleClose).toHaveBeenCalledTimes(1));
    await expect(staleSave).toHaveBeenCalledTimes(2);
  },
};
function pendingSaveCancellation(method: 'button' | 'escape'): Story {
  const save = fn(async (_definition: FormulaDefinition, _signal: AbortSignal) => {});
  const close = fn();
  return {
    args: {
      initial: { id: 'formula', start: 0, end: 18, definition },
      onSave: save,
      onClose: close,
    },
    parameters: { api: { ...formulaApi, ...availableSources } },
    play: async ({ canvasElement }) => {
      save.mockReset();
      close.mockReset();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      save.mockImplementation(() => pending);
      close.mockImplementation(() => {
        // The request is cancelled before the parent receives its close callback.
        expect(save.mock.calls[0]![1].aborted).toBe(true);
      });
      await sourcesReady(canvasElement);
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole('button', { name: /^Save formula$/ }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await expect(canvas.getByRole('button', { name: /^Working…$/ })).toBeDisabled();
      const cancel = canvas.getByRole('button', { name: /^Cancel$/ });
      await expect(cancel).toBeEnabled();
      const modal = canvas.getByRole('dialog');
      try {
        if (method === 'button') await userEvent.click(cancel);
        else {
          // Escape's native dialog action dispatches cancel; synthetic keyboard events
          // do not perform that browser default action in Storybook's test driver.
          modal.dispatchEvent(new Event('cancel', { cancelable: true }));
        }
        await expect(save.mock.calls[0]![1].aborted).toBe(true);
        await expect(close).toHaveBeenCalledTimes(1);
        // A second close/submit before parent unmount must not activate anything again.
        modal.dispatchEvent(new Event('cancel', { cancelable: true }));
        canvasElement
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      } finally {
        release();
      }
      await pending;
      await expect(close).toHaveBeenCalledTimes(1);
      await expect(save).toHaveBeenCalledTimes(1);
    },
  };
}
export const SaveCancelPending: Story = pendingSaveCancellation('button');
export const SaveEscapePending: Story = pendingSaveCancellation('escape');

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
