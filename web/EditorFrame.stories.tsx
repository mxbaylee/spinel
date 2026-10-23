import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EditorFrame, useEditorChrome } from './EditorFrame.tsx';
import { EditorTools } from './EditorTools.tsx';
import { SaveStatus } from './SaveStatus.tsx';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import { FormulaReadout } from './DocFormulas.tsx';

function Fixture({
  dialog = false,
  printFailure = false,
}: {
  dialog?: boolean;
  printFailure?: boolean;
}) {
  const chrome = useEditorChrome();
  return (
    <section className="sheet-editor" aria-label="Editor geometry fixture">
      <SaveStatus
        target={chrome?.saveTarget ?? null}
        state={{ dirty: false, failed: false, message: 'All changes saved.' }}
        onRetry={fn()}
      />
      <EditorTools
        id="fixture"
        name="Quarterly planning"
        people={[
          {
            id: 'a',
            name: 'Alexandria Nakamura-Fernandez — a long collaborator name',
            color: '#7950f2',
            selection: 'Planning!B2',
            jump: fn(),
          },
          { id: 'b', name: 'Sam Rivera', color: '#087f5b' },
        ]}
        saved
        print={async () => {
          if (printFailure) throw new Error('Could not open printing.');
        }}
      />
      <div className="univer-container" style={{ background: 'var(--sp-panel)', padding: 24 }}>
        Geometry fixture. Native selection and rendering are checked in Playwright.
        {dialog && (
          <Modal title="Editor dialog fixture" trigger="Open editor dialog">
            Document dialog content.
          </Modal>
        )}
      </div>
    </section>
  );
}
function OfflineFixture() {
  const chrome = useEditorChrome();
  return (
    <section className="sheet-editor" aria-label="Offline geometry fixture">
      <SaveStatus
        target={chrome?.saveTarget ?? null}
        state={{
          dirty: false,
          failed: false,
          message: 'View only on this device. Reconnect to edit.',
        }}
        onRetry={fn()}
      />
      <FormulaReadout
        target={chrome?.toolsTarget}
        states={[
          {
            formula: {
              id: 'offline-value',
              start: 0,
              end: 3,
              definition: { version: 1, expression: '=123', references: [] },
            },
            result: { ok: true, kind: 'scalar', value: 123 },
          },
        ]}
      />
      <div className="univer-container" style={{ background: 'var(--sp-panel)', padding: 24 }}>
        Prepared local document geometry fixture.
      </div>
    </section>
  );
}
const meta = {
  id: 'editor-frame',
  title: 'Current production/Editor/Frame',
  component: EditorFrame,
  args: {
    name: 'Quarterly planning',
    connection: 'online',
    access: 'Can edit',
    onBack: fn(),
    children: <Fixture />,
  },
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    localStorage.removeItem('spinel-theatre');
  },
} satisfies Meta<typeof EditorFrame>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('button', { name: 'Save details: Saved' }).getBoundingClientRect().width,
    ).toBe(window.innerWidth <= 600 ? 44 : 144);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
export const Guest: Story = { args: { guest: true, onBack: undefined, access: 'View only' } };
export const Reconnecting: Story = { args: { connection: 'reconnecting' } };
export const Rename: Story = { args: { onRename: fn(async () => {}) } };
function RenameAuthorityFixture() {
  const [allowed, setAllowed] = useState(true);
  const [rejectLate, setRejectLate] = useState<(() => void) | null>(null);
  return (
    <>
      <button onClick={() => setAllowed(false)}>Revoke fixture access</button>
      <button disabled={!rejectLate} onClick={() => rejectLate?.()}>
        Reject late rename
      </button>
      <EditorFrame
        name={allowed ? 'Private page' : 'Space unavailable'}
        documentKey="same-dirty-page"
        connection="offline"
        onRename={
          allowed
            ? () =>
                new Promise<void>((_, reject) => {
                  setRejectLate(() => () => reject(new Error('Private rename failure')));
                })
            : undefined
        }
      >
        <section aria-label="Retained draft fixture">Already pending local draft.</section>
      </EditorFrame>
    </>
  );
}
export const RenameAuthorityRemoved: Story = {
  render: () => <RenameAuthorityFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const draft = canvas.getByRole('region', { name: 'Retained draft fixture' });
    await userEvent.click(canvas.getByRole('button', { name: 'Rename Private page' }));
    await expect(canvas.getByRole('textbox', { name: 'Document name' })).toHaveValue(
      'Private page',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Save name' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Revoke fixture access' }));
    await expect(canvas.getByRole('heading', { name: 'Space unavailable' })).toBeVisible();
    await expect(canvas.queryByRole('textbox', { name: 'Document name' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Reject late rename' }));
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
    await expect(canvas.getByRole('region', { name: 'Retained draft fixture' })).toBe(draft);
  },
};
export const VersionsDialog: Story = {
  parameters: { api: { 'GET /api/items/fixture/history': { versions: [], canName: true } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Document actions' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Versions' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Versions' });
    await expect(
      await within(dialog).findByRole('button', { name: 'Name this version' }),
    ).toBeEnabled();
    await expect(within(dialog).getByRole('button', { name: 'Return to document' })).toBeVisible();
  },
};
export const ExportDialog: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Document actions' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Export' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Export' });
    await expect(
      within(dialog).getByRole('button', { name: 'Download Univer file' }),
    ).toBeEnabled();
    await expect(within(dialog).getByRole('button', { name: 'Print / save PDF' })).toBeEnabled();
  },
};
export const PrintFailure: Story = {
  args: { children: <Fixture printFailure /> },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Document actions' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Export' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Export' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print / save PDF' }));
    await expect(await within(document.body).findByRole('alert')).toHaveTextContent(
      'Could not open printing.',
    );
    await expect(within(document.body).getByRole('dialog', { name: 'Export' })).toBeVisible();
  },
};
export const OfflineFormulas: Story = {
  args: { connection: 'offline', access: 'Read only', children: <OfflineFixture /> },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Formulas' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Formulas' });
    await expect(within(dialog).getByText('=123')).toBeVisible();
    await expect(within(dialog).getByText('123', { exact: true })).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
export const TheatreDialog: Story = {
  args: { children: <Fixture dialog /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      body = within(document.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Enter theatre mode' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Open editor dialog' }));
    const dialog = await body.findByRole('dialog', { name: 'Editor dialog fixture' });
    const close = within(dialog).getByRole('button', { name: 'Close dialog' });
    const box = close.getBoundingClientRect();
    await expect(
      close.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
    ).toBe(true);
    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByRole('button', { name: 'Exit theatre mode' })).toBeVisible();
  },
};
export const PeopleAndTheatre: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      body = within(document.body);
    await userEvent.click(canvas.getByRole('button', { name: 'People in this document' }));
    const people = await body.findByRole('dialog', { name: 'People in this document' });
    await expect(
      within(people).getByText('Alexandria Nakamura-Fernandez — a long collaborator name'),
    ).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.click(within(people).getByRole('button', { name: 'Close dialog' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Enter theatre mode' }));
    const exit = canvas.getByRole('button', { name: 'Exit theatre mode' });
    await expect(exit).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Save details: Saved' }).getBoundingClientRect().width,
    ).toBe(44);
    await userEvent.click(canvas.getByRole('button', { name: 'Save details: Saved' }));
    await userEvent.keyboard('{Escape}');
    await expect(exit).toBeVisible();
    exit.focus();
    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByRole('button', { name: 'Enter theatre mode' })).toBeVisible();
  },
};
