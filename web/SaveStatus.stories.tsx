import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { SaveState } from '../src/shared/autosave.ts';
import { SaveStatus } from './SaveStatus.tsx';

const saved: SaveState = { dirty: false, failed: false, message: 'All changes saved.' };
const saving: SaveState = {
  dirty: true,
  failed: false,
  message: 'Finishing save — keep this tab open.',
};
const failed: SaveState = {
  dirty: true,
  failed: true,
  message: 'Could not finish saving recovery data. Keep this tab open and retry.',
};
const originalHref =
  '/spaces/11111111-1111-4111-8111-111111111111?item=22222222-2222-4222-8222-222222222222';
const copyHref = '/?item=33333333-3333-4333-8333-333333333333';
const copyName =
  'Autumn travel plans — reservations and places to explore (offline copy, 2026-10-27 14:35)';
const recoveryFailed: SaveState = {
  local: 'attention',
  dirty: false,
  failed: true,
  retained: true,
  message: 'Needs attention. The live document changed. Your saved device copy is retained.',
  recovery: {
    phase: 'failed',
    originalHref,
    message: 'The copy could not be created. Your offline changes stay on this device.',
  },
};

const meta = {
  id: 'editor-savestatus',
  title: 'Current production/Editor/SaveStatus',
  component: SaveStatus,
  args: {
    state: saved,
    target: null,
    onRetry: fn(),
    onRecover: fn(),
    onExportRecovery: fn(),
    onDiscardRecovery: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          'Production save control in the title slot. State fixtures; the canvas below is a geometry marker, not Univer. Native editor acceptance runs in Playwright.',
      },
    },
  },
  render: function Example(args) {
    const [target, setTarget] = useState<HTMLSpanElement | null>(null);
    const [state, setState] = useState(args.state);
    const [unfinishedText, setUnfinishedText] = useState(args.unfinishedText);
    return (
      <>
        <header className="editor-title-status">
          <h2>Autumn travel plans — reservations and places to explore</h2>
          <span className="save-slot" ref={setTarget} />
        </header>
        <SaveStatus
          target={target}
          state={state}
          onRetry={() => {
            args.onRetry();
            if (!state.signInRequired && !unfinishedText) setState(saved);
          }}
          onRecover={args.onRecover}
          onExportRecovery={args.onExportRecovery}
          onDiscardRecovery={() => {
            args.onDiscardRecovery?.();
            setState((current) => ({
              ...current,
              dirty: false,
              message: current.recovery?.creation
                ? 'This document was discarded from this device. Any document already uploaded stays unchanged.'
                : 'Your offline changes were discarded from this device. The original was not changed.',
              recovery: { ...current.recovery!, phase: 'discarded', message: undefined },
            }));
          }}
          unfinishedText={
            unfinishedText && {
              value: unfinishedText.value,
              onDiscard: () => {
                unfinishedText.onDiscard();
                setUnfinishedText(undefined);
                setState((current) => ({
                  ...current,
                  local: 'attention',
                  dirty: false,
                  message: current.signInRequired
                    ? 'Your sign-in ended. Your saved device copy is retained.'
                    : 'Needs attention. The live document changed. Your saved device copy is retained.',
                }));
              },
            }
          }
        />
        <div
          aria-label="Editor geometry fixture"
          style={{
            height: 240,
            marginTop: 16,
            border: '1px solid var(--sp-border)',
            background: 'var(--sp-panel)',
            padding: 16,
          }}
        >
          Document content
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          <button onClick={() => setState(saving)}>Simulate saving</button>
          <button onClick={() => setState(failed)}>Simulate failure</button>
          <button onClick={() => setState(saved)}>Simulate saved</button>
        </div>
      </>
    );
  },
} satisfies Meta<typeof SaveStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

async function noPageOverflow(document: Document) {
  await waitFor(() =>
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    ),
  );
}

const details: NonNullable<Story['play']> = async ({ canvasElement }) => {
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: /^Save details:/ }),
  );
  await expect(
    await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Save details',
    }),
  ).toBeVisible();
  await noPageOverflow(canvasElement.ownerDocument);
};

async function recoveryDetails(context: Parameters<NonNullable<Story['play']>>[0]) {
  const geometry = within(context.canvasElement).getByLabelText('Editor geometry fixture');
  const bounds = geometry.getBoundingClientRect().toJSON();
  await details(context);
  await expect(geometry.getBoundingClientRect().toJSON()).toEqual(bounds);
  return within(
    within(context.canvasElement.ownerDocument.body).getByRole('dialog', { name: 'Save details' }),
  );
}

export const Saved: Story = {};
export const SavingOnDevice: Story = {
  args: {
    state: { local: 'saving', dirty: true, failed: false, message: 'Saving on this device…' },
  },
  play: details,
};
export const SavedOnDevice: Story = {
  args: {
    state: {
      local: 'saved',
      dirty: false,
      failed: false,
      message: 'Saved on this device — waiting to sync.',
    },
  },
  play: details,
};
export const Synced: Story = {
  args: {
    state: {
      local: 'synced',
      dirty: false,
      failed: false,
      message: 'Synced. All changes are saved on the server and this device.',
    },
  },
  play: details,
};
export const NeedsAttention: Story = {
  args: {
    state: {
      local: 'attention',
      dirty: false,
      failed: true,
      message: 'Needs attention. The live document changed. Your saved device copy is retained.',
    },
  },
  play: details,
};
export const CreationNeedsAttention: Story = {
  args: {
    state: {
      ...recoveryFailed,
      message:
        'Needs attention. The chosen folder is no longer available. Use Back to files, then choose another folder from this document’s menu.',
      recovery: { phase: 'ready', originalHref: '/', creation: true },
    },
  },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    await expect(
      panel.getByText(/Use Back to files, then choose another folder from this document’s menu\./),
    ).toBeVisible();
    await expect(
      panel.queryByRole('button', { name: 'Retry creating copy' }),
    ).not.toBeInTheDocument();
    await expect(panel.getByRole('button', { name: 'Export as Univer file' })).toBeEnabled();
    await userEvent.click(panel.getByRole('button', { name: 'Discard device copy…' }));
    await expect(
      panel.getByText(
        'Discard this document from this device? This cannot be undone. Any document already uploaded stays unchanged.',
      ),
    ).toBeVisible();
    await userEvent.click(panel.getByRole('button', { name: 'Discard device copy' }));
    await expect(context.args.onDiscardRecovery).toHaveBeenCalledOnce();
    await expect(panel.getByRole('link', { name: 'My files' })).toHaveAttribute('href', '/');
    await expect(panel.queryByRole('link', { name: 'Open original' })).not.toBeInTheDocument();
  },
};
export const RecoveryCreating: Story = {
  args: {
    state: {
      ...recoveryFailed,
      message:
        'Creating an offline copy in My files. Your saved device copy is retained until it finishes.',
      recovery: { phase: 'creating', originalHref },
    },
  },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    for (const name of ['Creating copy…', 'Export as Univer file', 'Discard offline changes…']) {
      const button = panel.getByRole('button', { name });
      await expect(button).toBeDisabled();
      await userEvent.click(button);
    }
    await expect(panel.queryByRole('link', { name: 'Open copy' })).not.toBeInTheDocument();
    await expect(context.args.onRecover).not.toHaveBeenCalled();
    await expect(context.args.onExportRecovery).not.toHaveBeenCalled();
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
  },
};
export const RecoveryCreated: Story = {
  args: {
    state: {
      ...recoveryFailed,
      message: `Your offline changes were saved as ${copyName}. The original was not changed.`,
      recovery: { phase: 'created', originalHref, copyHref, copyName },
    },
  },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    await expect(panel.getByRole('link', { name: 'Open copy' })).toHaveAttribute('href', copyHref);
    await expect(panel.getByRole('link', { name: 'Open original' })).toHaveAttribute(
      'href',
      originalHref,
    );
    for (const name of ['Retry creating copy', 'Export as Univer file', 'Discard offline changes…'])
      await expect(panel.queryByRole('button', { name })).not.toBeInTheDocument();
    await expect(
      within(context.canvasElement).getByRole('button', {
        name: 'Save details: Needs attention',
      }),
    ).toBeVisible();
    await expect(context.args.onRecover).not.toHaveBeenCalled();
  },
};
export const RecoveryFailed: Story = {
  args: { state: recoveryFailed },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    for (const name of ['Retry creating copy', 'Export as Univer file', 'Discard offline changes…'])
      await expect(panel.getByRole('button', { name })).toBeEnabled();
    await expect(
      panel.queryByRole('button', { name: 'Discard offline changes' }),
    ).not.toBeInTheDocument();
    await userEvent.click(panel.getByRole('button', { name: 'Export as Univer file' }));
    await expect(context.args.onExportRecovery).toHaveBeenCalledOnce();
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
    await userEvent.click(panel.getByRole('button', { name: 'Retry creating copy' }));
    await expect(context.args.onRecover).toHaveBeenCalledOnce();
    await expect(context.args.onRetry).not.toHaveBeenCalled();
  },
};
export const RecoveryExported: Story = {
  args: {
    state: {
      ...recoveryFailed,
      recovery: {
        phase: 'failed',
        originalHref,
        message:
          'The Univer file was prepared for download. Check the download before discarding your offline changes. Formula sources are checked when imported.',
      },
    },
  },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    await expect(panel.getByRole('status')).toHaveTextContent(
      'Check the download before discarding your offline changes.',
    );
    await expect(panel.getByRole('button', { name: 'Export as Univer file' })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Discard offline changes…' })).toBeEnabled();
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
  },
};
export const RecoveryDiscardConfirmation: Story = {
  args: { state: recoveryFailed },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    await userEvent.click(panel.getByRole('button', { name: 'Discard offline changes…' }));
    await expect(
      panel.getByText(
        'Discard all offline changes to this document from this device? This cannot be undone. The original and any copy already created stay unchanged.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Discard offline changes' })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Keep changes' })).toBeEnabled();
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
    await noPageOverflow(context.canvasElement.ownerDocument);
  },
};
export const RecoveryDiscarded: Story = {
  args: { state: recoveryFailed },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    await userEvent.click(panel.getByRole('button', { name: 'Discard offline changes…' }));
    await userEvent.click(panel.getByRole('button', { name: 'Keep changes' }));
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
    await expect(
      panel.queryByRole('button', { name: 'Discard offline changes' }),
    ).not.toBeInTheDocument();
    await userEvent.click(panel.getByRole('button', { name: 'Discard offline changes…' }));
    await userEvent.click(panel.getByRole('button', { name: 'Discard offline changes' }));
    await expect(context.args.onDiscardRecovery).toHaveBeenCalledOnce();
    await expect(
      panel.getByText(
        'Your offline changes were discarded from this device. The original was not changed.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Open original' })).toHaveAttribute(
      'href',
      originalHref,
    );
    await expect(
      panel.queryByRole('button', { name: 'Export as Univer file' }),
    ).not.toBeInTheDocument();
    await expect(panel.queryByText(recoveryFailed.recovery!.message!)).not.toBeInTheDocument();
    await expect(context.args.onRecover).not.toHaveBeenCalled();
  },
};
export const RecoveryExpiredAccount: Story = {
  args: {
    state: {
      ...recoveryFailed,
      signInRequired: true,
      message: 'Your sign-in ended. Your saved device copy is retained.',
      recovery: { phase: 'ready', originalHref },
    },
  },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    await expect(
      panel.queryByRole('button', { name: 'Retry creating copy' }),
    ).not.toBeInTheDocument();
    await expect(panel.getByRole('button', { name: 'Discard offline changes…' })).toBeEnabled();
    await userEvent.click(panel.getByRole('button', { name: 'Export as Univer file' }));
    await expect(context.args.onExportRecovery).toHaveBeenCalledOnce();
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
    await userEvent.click(panel.getByRole('button', { name: 'Continue to sign-in' }));
    await expect(context.args.onRetry).toHaveBeenCalledOnce();
    await expect(context.args.onRecover).not.toHaveBeenCalled();
  },
};
export const RecoveryUnfinishedInput: Story = {
  args: {
    state: {
      ...recoveryFailed,
      local: undefined,
      dirty: true,
      message: 'Copy the unfinished cell text before recovering your offline changes.',
      recovery: { phase: 'ready', originalHref },
    },
  },
  play: async (context) => {
    const panel = await recoveryDetails(context);
    await expect(
      panel.getByText('Copy the unfinished cell text before recovering your offline changes.', {}),
    ).toBeVisible();
    for (const name of [
      'Retry creating copy',
      'Export as Univer file',
      'Discard offline changes…',
    ]) {
      const button = panel.getByRole('button', { name });
      await expect(button).toBeDisabled();
      await userEvent.click(button);
    }
    await expect(context.args.onRecover).not.toHaveBeenCalled();
    await expect(context.args.onExportRecovery).not.toHaveBeenCalled();
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
  },
};

const unfinishedDocValue =
  '家族旅行の最終予定 518 — keep every word ✈\nThe last composition event supplied this complete text.';
const unfinishedDocState: SaveState = {
  ...recoveryFailed,
  local: undefined,
  dirty: true,
  message: 'Copy the unfinished text before recovering your offline changes.',
  recovery: { phase: 'ready', originalHref },
};
async function unfinishedDocDetails(context: Parameters<NonNullable<Story['play']>>[0]) {
  const panel = await recoveryDetails(context);
  const text = panel.getByRole('textbox', { name: 'Unfinished text' });
  await expect(text).toHaveAttribute('readonly');
  await expect(text).toHaveValue(unfinishedDocValue);
  await userEvent.click(text);
  await userEvent.type(text, 'This must not replace the retained draft.');
  await expect(text).toHaveValue(unfinishedDocValue);
  for (const name of ['Export as Univer file', 'Discard offline changes…']) {
    const action = panel.getByRole('button', { name });
    await expect(action).toBeDisabled();
    await userEvent.click(action);
  }
  if (context.args.state.signInRequired)
    await expect(
      panel.queryByRole('button', { name: 'Retry creating copy' }),
    ).not.toBeInTheDocument();
  else {
    const copy = panel.getByRole('button', { name: 'Retry creating copy' });
    await expect(copy).toBeDisabled();
    await userEvent.click(copy);
  }
  await expect(panel.queryByRole('link', { name: 'Open copy' })).not.toBeInTheDocument();
  await expect(
    panel.queryByRole('button', { name: 'Continue to sign-in' }),
  ).not.toBeInTheDocument();
  await expect(context.args.onRecover).not.toHaveBeenCalled();
  await expect(context.args.onExportRecovery).not.toHaveBeenCalled();
  await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
  await expect(context.args.unfinishedText?.onDiscard).not.toHaveBeenCalled();
  await expect(panel.getByRole('button', { name: 'Discard unfinished text' })).toBeEnabled();
  await noPageOverflow(context.canvasElement.ownerDocument);
  return panel;
}

export const RecoveryUnfinishedDocText: Story = {
  args: {
    state: unfinishedDocState,
    unfinishedText: { value: unfinishedDocValue, onDiscard: fn() },
  },
  play: async (context) => {
    const geometry = within(context.canvasElement).getByLabelText('Editor geometry fixture');
    const before = geometry.getBoundingClientRect().toJSON();
    const panel = await unfinishedDocDetails(context);
    await userEvent.click(panel.getByRole('button', { name: 'Retry saving' }));
    await expect(context.args.onRetry).toHaveBeenCalledOnce();
    await expect(panel.getByRole('textbox', { name: 'Unfinished text' })).toHaveValue(
      unfinishedDocValue,
    );
    await expect(panel.getByRole('button', { name: 'Retry creating copy' })).toBeDisabled();
    await expect(geometry.getBoundingClientRect().toJSON()).toEqual(before);
  },
};

export const RecoveryUnfinishedDocTextDiscarded: Story = {
  args: {
    state: unfinishedDocState,
    unfinishedText: { value: unfinishedDocValue, onDiscard: fn() },
  },
  play: async (context) => {
    const geometry = within(context.canvasElement).getByLabelText('Editor geometry fixture');
    const before = geometry.getBoundingClientRect().toJSON();
    const panel = await unfinishedDocDetails(context);
    await userEvent.click(panel.getByRole('button', { name: 'Discard unfinished text' }));
    await expect(context.args.unfinishedText?.onDiscard).toHaveBeenCalledOnce();
    await expect(panel.queryByRole('textbox', { name: 'Unfinished text' })).not.toBeInTheDocument();
    for (const name of ['Retry creating copy', 'Export as Univer file', 'Discard offline changes…'])
      await expect(panel.getByRole('button', { name })).toBeEnabled();
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
    await expect(context.args.onRecover).not.toHaveBeenCalled();
    await expect(geometry.getBoundingClientRect().toJSON()).toEqual(before);
    await noPageOverflow(context.canvasElement.ownerDocument);
  },
};

export const ExpiredUnfinishedDocText: Story = {
  args: {
    state: {
      ...unfinishedDocState,
      signInRequired: true,
      message: 'Your sign-in ended. Copy the unfinished text before signing in again.',
    },
    unfinishedText: { value: unfinishedDocValue, onDiscard: fn() },
  },
  play: async (context) => {
    const geometry = within(context.canvasElement).getByLabelText('Editor geometry fixture');
    const before = geometry.getBoundingClientRect().toJSON();
    const panel = await unfinishedDocDetails(context);
    await userEvent.click(panel.getByRole('button', { name: 'Discard unfinished text' }));
    await expect(context.args.unfinishedText?.onDiscard).toHaveBeenCalledOnce();
    await expect(panel.queryByRole('textbox', { name: 'Unfinished text' })).not.toBeInTheDocument();
    await expect(panel.getByRole('button', { name: 'Export as Univer file' })).toBeEnabled();
    await userEvent.click(panel.getByRole('button', { name: 'Continue to sign-in' }));
    await expect(context.args.onRetry).toHaveBeenCalledOnce();
    await expect(context.args.onDiscardRecovery).not.toHaveBeenCalled();
    await expect(context.args.onRecover).not.toHaveBeenCalled();
    await expect(geometry.getBoundingClientRect().toJSON()).toEqual(before);
    await noPageOverflow(context.canvasElement.ownerDocument);
  },
};

export const DeviceSaveFailed: Story = {
  args: {
    state: {
      local: 'failed',
      dirty: true,
      failed: true,
      message: 'Changes could not be saved on this device. Keep this tab open and retry saving.',
    },
  },
  play: details,
};
export const AttentionSaveFailed: Story = {
  args: {
    state: {
      local: 'failed',
      dirty: true,
      failed: true,
      message:
        'Changes could not be saved on this device. Keep this tab open and retry saving. Synchronization also needs attention.',
    },
  },
  play: async (context) => {
    await details(context);
    await expect(
      within(context.canvasElement.ownerDocument.body).getByRole('button', {
        name: 'Retry saving',
      }),
    ).toBeVisible();
  },
};
export const Saving: Story = { args: { state: saving }, play: details };
export const EditingCell: Story = {
  args: { state: { dirty: true, failed: false, message: 'Editing cell — changes not saved yet.' } },
  play: details,
};
export const ExpiredCellInput: Story = {
  args: {
    state: {
      dirty: true,
      failed: true,
      signInRequired: true,
      message: 'Your sign-in ended. Copy the unfinished cell text before signing in again.',
    },
  },
  play: details,
};
export const ExpiredSavedWork: Story = {
  args: {
    state: {
      dirty: false,
      failed: true,
      local: 'attention',
      retained: true,
      signInRequired: true,
      message: 'Your sign-in ended. Your saved device copy is retained.',
    },
  },
  play: async (context) => {
    await details(context);
    await expect(
      within(context.canvasElement.ownerDocument.body).getByRole('button', {
        name: 'Continue to sign-in',
      }),
    ).toBeVisible();
  },
};
export const EditingFormula: Story = {
  args: {
    state: { dirty: true, failed: false, message: 'Editing formula — changes not saved yet.' },
  },
  play: details,
};
export const Loading: Story = {
  args: { state: { dirty: false, failed: false, message: 'Loading document…' } },
  play: details,
};
export const ViewOnly: Story = {
  args: {
    state: {
      dirty: false,
      failed: false,
      message: 'View only — reload after your access changes.',
    },
  },
  play: details,
};
export const FailedSave: Story = {
  args: { state: failed },
  play: async (context) => {
    await details(context);
    const trigger = within(context.canvasElement).getByRole('button', {
      name: 'Save details: Not saved',
    });
    // Production workspace button rules must not erase the semantic error color.
    await expect(getComputedStyle(trigger).color).not.toBe(
      getComputedStyle(trigger.parentElement!).color,
    );
  },
};
export const AccessChanged: Story = {
  args: {
    state: {
      dirty: false,
      failed: true,
      message: 'Access changed. Copy unsaved changes before reloading.',
    },
  },
  play: async (context) => {
    await details(context);
    await expect(
      within(context.canvasElement.ownerDocument.body).queryByRole('button', {
        name: 'Retry saving',
      }),
    ).not.toBeInTheDocument();
  },
};
export const WaitingToResync: Story = {
  args: {
    state: {
      dirty: true,
      failed: true,
      message: 'An edit could not be applied. Waiting for the server before reloading.',
    },
  },
  play: details,
};
export const RejectedEdits: Story = {
  args: {
    state: {
      dirty: false,
      failed: true,
      message:
        'The document was reloaded after a synchronization problem. Edits the server did not accept were discarded.',
    },
  },
  play: async (context) => {
    await details(context);
    await expect(
      within(context.canvasElement.ownerDocument.body).queryByRole('button', {
        name: 'Retry saving',
      }),
    ).not.toBeInTheDocument();
  },
};
export const LongError: Story = {
  args: {
    state: {
      ...failed,
      message: `${failed.message} ${'The connection was interrupted before the server could confirm your changes. '.repeat(8)}`,
    },
  },
  play: details,
};

/** State and out-of-flow Retry never change the slot or content bounds. */
export const StableGeometryAndRetry: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const trigger = await canvas.findByRole('button', { name: 'Save details: Saved' });
    const content = canvas.getByLabelText('Editor geometry fixture');
    const before = content.getBoundingClientRect().toJSON();
    const slot = trigger.getBoundingClientRect().toJSON();
    for (const name of [
      'Simulate saving',
      'Simulate failure',
      'Simulate saved',
      'Simulate failure',
    ]) {
      await userEvent.click(canvas.getByRole('button', { name }));
      await expect(content.getBoundingClientRect().toJSON()).toEqual(before);
      await expect(trigger.getBoundingClientRect().toJSON()).toEqual(slot);
    }
    await expect(canvas.getByRole('status', { name: 'Save status' })).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await userEvent.click(trigger);
    await expect(await page.findByRole('dialog', { name: 'Save details' })).toBeVisible();
    await expect(content.getBoundingClientRect().toJSON()).toEqual(before);
    await noPageOverflow(canvasElement.ownerDocument);
    await userEvent.click(page.getByRole('button', { name: 'Retry saving' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
    await expect(trigger).toHaveTextContent('Saved');
    await expect(content.getBoundingClientRect().toJSON()).toEqual(before);
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(page.queryByRole('dialog', { name: 'Save details' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const KeyboardDetails: Story = {
  args: { state: failed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const trigger = await canvas.findByRole('button', {
      name: 'Save details: Not saved',
    });
    await userEvent.tab();
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await expect(await page.findByRole('dialog', { name: 'Save details' })).toBeVisible();
    await waitFor(() => expect(page.getByRole('button', { name: 'Retry saving' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
export const TouchDetails: Story = {
  args: { state: failed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const trigger = await canvas.findByRole('button', {
      name: 'Save details: Not saved',
    });
    await userEvent.pointer({ keys: '[TouchA]', target: trigger });
    await expect(await page.findByRole('dialog', { name: 'Save details' })).toBeVisible();
    await userEvent.pointer({
      keys: '[TouchA]',
      target: canvas.getByLabelText('Editor geometry fixture'),
    });
    await waitFor(() =>
      expect(page.queryByRole('dialog', { name: 'Save details' })).not.toBeInTheDocument(),
    );
  },
};
