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

const meta = {
  id: 'editor-savestatus',
  title: 'Current production/Editor/SaveStatus',
  component: SaveStatus,
  args: { state: saved, target: null, onRetry: fn() },
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
            setState(saved);
          }}
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
export const Saving: Story = { args: { state: saving }, play: details };
export const EditingCell: Story = {
  args: { state: { dirty: true, failed: false, message: 'Editing cell — changes not saved yet.' } },
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
