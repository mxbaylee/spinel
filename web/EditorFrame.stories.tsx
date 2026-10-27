import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useState } from 'react';
import { emptyAppearance } from '../src/shared/appearance.ts';
import type { ItemAppearance } from '../src/shared/appearance.ts';
import { createPortal } from 'react-dom';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { EditorFrame, useEditorChrome } from './EditorFrame.tsx';
import { EditorTools } from './EditorTools.tsx';
import { SaveStatus } from './SaveStatus.tsx';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import { FormulaReadout } from './DocFormulas.tsx';
import { failure, pending } from '../.storybook/api.ts';
import { PresenceLabel, presencePopupZIndex } from './PresenceLabel.tsx';
import { OfflineAvailability } from './offline/OfflineAvailability.tsx';

function Fixture({
  dialog = false,
  saved = true,
  presence = false,
  formulas = false,
}: {
  dialog?: boolean;
  saved?: boolean;
  presence?: boolean;
  formulas?: boolean;
}) {
  const chrome = useEditorChrome();
  return (
    <section className="sheet-editor" aria-label="Editor geometry fixture">
      {presence &&
        createPortal(
          <div
            data-presence-layer-fixture
            aria-hidden
            style={{ position: 'fixed', right: 8, top: '40%', zIndex: presencePopupZIndex }}
          >
            <PresenceLabel name="Morgan Another Very Long Collaborator Name" color="#c54835" />
          </div>,
          document.body,
        )}
      <SaveStatus
        target={chrome?.saveTarget ?? null}
        state={{
          dirty: !saved,
          failed: false,
          message: saved ? 'All changes saved.' : 'Saving changes…',
        }}
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
        saved={saved}
        formulas={
          formulas
            ? (close) => (
                <div className="doc-formulas">
                  <ul>
                    <li>
                      <button onClick={close}>
                        =123456789+123456789+123456789+123456789+123456789+123456789
                      </button>
                      <span className="formula-value">740740734</span>
                    </li>
                  </ul>
                  <button onClick={fn()}>Refresh formulas</button>
                </div>
              )
            : undefined
        }
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

async function assertDialogTargets(dialog: HTMLElement) {
  const scope = within(dialog);
  for (const control of [
    ...scope.getAllByRole('button'),
    ...scope.queryAllByRole('textbox'),
    ...scope.queryAllByRole('link'),
  ]) {
    const box = control.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    if (window.innerWidth <= 640 || matchMedia('(pointer: coarse)').matches) {
      await expect(box.width).toBeGreaterThanOrEqual(44);
      await expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

async function openTool(canvasElement: HTMLElement, name: string) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Document actions' }));
  await userEvent.click(await within(document.body).findByRole('menuitem', { name }));
  return within(document.body).findByRole('dialog', { name });
}

export const Default: Story = {};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('button', { name: 'Save details: Saved' }).getBoundingClientRect().width,
    ).toBe(window.innerWidth <= 640 ? 44 : 144);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
export const Guest: Story = { args: { guest: true, onBack: undefined, access: 'View only' } };
export const Reconnecting: Story = { args: { connection: 'reconnecting' } };
export const Rename: Story = {
  args: { onRename: fn(async () => {}) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Rename Quarterly planning' }));
    const input = canvas.getByRole('textbox', { name: 'Document name' });
    await expect(input).toHaveValue('Quarterly planning');
    await expect(input).toHaveFocus();
    await expect(canvas.getByRole('button', { name: 'Save name' })).toBeEnabled();
    await assertDialogTargets(canvas.getByRole('form', { name: 'Rename document' }));
    const form = canvas.getByRole('form', { name: 'Rename document' }).getBoundingClientRect();
    const access = canvas.getByText('Can edit').getBoundingClientRect();
    const back = canvas.getByRole('button', { name: 'Back to files' }).getBoundingClientRect();
    await expect(form.left).toBeGreaterThanOrEqual(back.right);
    await expect(
      form.right <= access.left || form.bottom <= access.top || form.top >= access.bottom,
    ).toBe(true);
    const field = input.getBoundingClientRect();
    const save = canvas.getByRole('button', { name: 'Save name' }).getBoundingClientRect();
    await expect(field.right).toBeLessThanOrEqual(save.left);
  },
};
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
        access={allowed ? 'Can edit' : 'Access changed'}
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
    await expect(canvas.getByText('Access changed', { exact: true })).toBeVisible();
    await expect(canvas.queryByText('Can edit', { exact: true })).not.toBeInTheDocument();
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
    await assertDialogTargets(dialog);
  },
};
export const VersionNamingFailure: Story = {
  parameters: {
    api: {
      'GET /api/items/fixture/history': { versions: [], canName: true },
      'POST /api/items/fixture/history': failure(
        'Could not save this version name. Try again.',
        503,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openTool(canvasElement, 'Versions'),
      scope = within(dialog);
    await userEvent.click(await scope.findByRole('button', { name: 'Name this version' }));
    const input = scope.getByRole('textbox', { name: 'Version name' });
    await expect(scope.getByRole('button', { name: 'Save version name' })).toBeDisabled();
    await userEvent.type(input, 'Ready for review');
    await userEvent.click(scope.getByRole('button', { name: 'Save version name' }));
    await expect(await scope.findByRole('alert')).toHaveTextContent(
      'Could not save this version name. Try again.',
    );
    await expect(input).toHaveValue('Ready for review');
    await expect(scope.getByRole('button', { name: 'Save version name' })).toBeEnabled();
    await expect(scope.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await assertDialogTargets(dialog);
  },
};
export const VersionRename: Story = {
  parameters: {
    api: {
      'GET /api/items/fixture/history': {
        versions: [{ id: 'named', name: 'Approved budget', capturedAt: Date.UTC(2026, 9, 22, 12) }],
        canName: true,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await openTool(canvasElement, 'Versions'),
      scope = within(dialog);
    await userEvent.click(await scope.findByRole('button', { name: 'Rename version' }));
    await expect(scope.getByRole('textbox', { name: 'Version name' })).toHaveValue(
      'Approved budget',
    );
    await expect(scope.getByRole('button', { name: 'Remove name' })).toBeEnabled();
    await expect(scope.getByRole('link', { name: 'Preview version' })).toHaveAttribute(
      'href',
      '/preview?item=fixture&version=named',
    );
    await assertDialogTargets(dialog);
  },
};
export const VersionsLoading: Story = {
  parameters: { api: { 'GET /api/items/fixture/history': pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await openTool(canvasElement, 'Versions');
    await expect(within(dialog).getByRole('button', { name: 'Refresh versions' })).toBeDisabled();
    await assertDialogTargets(dialog);
  },
};
export const ExportDialog: Story = {
  parameters: { api: { 'GET /api/items/fixture/pdf': { kind: 'doc' } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Document actions' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Export' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Export' });
    await expect(
      within(dialog).getByRole('button', { name: 'Download Univer file' }),
    ).toBeEnabled();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Export as PDF' })).toBeEnabled(),
    );
    await assertDialogTargets(dialog);
  },
};
export const ExportWaitingForSave: Story = {
  args: { children: <Fixture saved={false} /> },
  play: async ({ canvasElement }) => {
    const dialog = await openTool(canvasElement, 'Export'),
      scope = within(dialog);
    await expect(scope.getByRole('button', { name: 'Download Univer file' })).toBeDisabled();
    await expect(scope.getByRole('button', { name: 'Export as PDF' })).toBeDisabled();
    await expect(scope.getByText('Wait until changes are saved before exporting.')).toBeVisible();
    await assertDialogTargets(dialog);
  },
};
export const PdfFailure: Story = {
  parameters: {
    api: {
      'GET /api/items/fixture/pdf': { kind: 'doc' },
      'POST /api/items/fixture/pdf': failure('Could not export this PDF. Try again.', 422),
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Document actions' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Export' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Export' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Export as PDF' })).toBeEnabled(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export as PDF' }));
    await expect(await within(document.body).findByRole('alert')).toHaveTextContent(
      'Could not export this PDF. Try again.',
    );
    await expect(within(document.body).getByRole('dialog', { name: 'Export' })).toBeVisible();
    await assertDialogTargets(within(document.body).getByRole('dialog', { name: 'Export' }));
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
/** The actual populated native readout is also retained by doc-formulas.spec.ts. */
export const EditableFormulas: Story = {
  args: { children: <Fixture formulas /> },
  play: async ({ canvasElement }) => {
    const dialog = await openTool(canvasElement, 'Formulas');
    await expect(within(dialog).getByRole('button', { name: 'Refresh formulas' })).toBeEnabled();
    await assertDialogTargets(dialog);
  },
};
export const OfflineAvailabilitySuccess: Story = {
  args: {
    children: (
      <>
        <Fixture />
        <OfflineAvailability
          message={{
            failed: false,
            text: 'Quarterly planning — a long document title is available offline on this device.',
          }}
          onDismiss={fn()}
        />
      </>
    ),
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'Offline availability',
    });
    await expect(within(dialog).getByRole('status')).toHaveTextContent('available offline');
    await assertDialogTargets(dialog);
  },
};
export const OfflineAvailabilityFailure: Story = {
  args: {
    children: (
      <>
        <Fixture />
        <OfflineAvailability
          message={{ failed: true, text: 'Offline download is temporarily unavailable.' }}
          onDismiss={fn()}
        />
      </>
    ),
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'Offline availability',
    });
    await expect(within(dialog).getByRole('alert')).toHaveTextContent('temporarily unavailable');
    await assertDialogTargets(dialog);
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
    const peopleTrigger = canvas.getByRole('button', { name: 'People in this document' });
    await userEvent.click(peopleTrigger);
    const people = await body.findByRole('dialog', { name: 'People in this document' });
    await expect(
      within(people).getByText('Alexandria Nakamura-Fernandez — a long collaborator name'),
    ).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.click(within(people).getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(people).not.toBeInTheDocument());
    await waitFor(() => expect(peopleTrigger).toHaveFocus());
    await userEvent.click(canvas.getByRole('button', { name: 'Enter theatre mode' }));
    const exit = canvas.getByRole('button', { name: 'Exit theatre mode' });
    await expect(exit).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Save details: Saved' }).getBoundingClientRect().width,
    ).toBe(44);
    const saveTrigger = canvas.getByRole('button', { name: 'Save details: Saved' });
    await userEvent.click(saveTrigger);
    const details = await body.findByRole('dialog', { name: 'Save details' });
    await expect(details).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect(exit).toBeVisible();
    // The first Escape belongs to the popover, including its closing lifetime.
    // Wait for actual removal and restored focus before testing a new idle Escape.
    await waitFor(() => expect(details).not.toBeInTheDocument());
    await expect(saveTrigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(saveTrigger).toHaveFocus());
    exit.focus();
    await expect(exit).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect(await canvas.findByRole('button', { name: 'Enter theatre mode' })).toBeVisible();
  },
};
/** Retain the actual open portal beside the composed editor for visual review. */
export const PeopleDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'People in this document' }));
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'People in this document',
    });
    await expect(
      within(dialog).getByText('Alexandria Nakamura-Fernandez — a long collaborator name'),
    ).toBeVisible();
    await assertDialogTargets(dialog);
  },
};

/** Geometry only; native popup forwarding and live overlap are verified in Playwright. */
export const PeopleOverPresence: Story = {
  args: { children: <Fixture presence /> },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'People in this document' }),
    );
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'People in this document',
    });
    await assertDialogTargets(dialog);
    const label = document.querySelector('[data-presence-layer-fixture]')!;
    await expect(Number(getComputedStyle(label).zIndex)).toBeLessThan(
      Number(getComputedStyle(dialog).zIndex),
    );
  },
};
export const ActionsOverPresence: Story = {
  args: { children: <Fixture presence /> },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Document actions' }));
    const menu = await within(document.body).findByRole('menu', { name: 'Document actions' });
    const positioner = menu.closest('.sp-positioner')!;
    const label = document.querySelector('[data-presence-layer-fixture]')!;
    await expect(Number(getComputedStyle(label).zIndex)).toBeLessThan(
      Number(getComputedStyle(positioner).zIndex),
    );
  },
};

export const GuestPdf: Story = {
  args: { guest: true, onBack: undefined, access: 'View only' },
  parameters: { api: { 'GET /api/items/fixture/pdf': { kind: 'doc' } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Export as PDF' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Export as PDF' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Export as PDF' })).toBeEnabled(),
    );
    await expect(within(dialog).queryByRole('button', { name: 'Download Univer file' })).toBeNull();
    await assertDialogTargets(dialog);
  },
};

/** Only the service boundary is local; header, rename and appearance are production components. */
function AppearanceFrameFixture() {
  const [name, setName] = useState('Quarterly planning');
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const original = globalThis.fetch;
    const path = '/api/appearance/items/header-fixture';
    let appearance: ItemAppearance = {
      ...emptyAppearance(),
      icon: 'lucide:book-open',
      iconColor: 'info-strong',
      cover: { source: 'gem', gem: 'spinel' },
    };
    const fixture: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      );
      if (url.pathname !== path) return original(input, init);
      if (init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body));
        // This header fixture has no file/provider service. The separate Appearance
        // playground previews uploads; application tests exercise real photo storage.
        if (patch.cover && patch.cover.source !== 'gem')
          return Response.json(
            { error: 'Photo storage is unavailable in this header preview.' },
            { status: 503 },
          );
        appearance = { ...appearance, ...patch, revision: appearance.revision + 1 };
      }
      return Response.json({ appearance, canEdit: true });
    };
    globalThis.fetch = fixture;
    setReady(true);
    return () => {
      if (globalThis.fetch === fixture) globalThis.fetch = original;
    };
  }, []);
  return ready ? (
    <EditorFrame
      name={name}
      connection="online"
      access="Can edit"
      onBack={fn()}
      onRename={async (next) => setName(next)}
      appearanceTarget={{ id: 'header-fixture', name, kind: 'doc' }}
    >
      <Fixture />
    </EditorFrame>
  ) : null;
}
export const Personalization: Story = {
  render: () => <AppearanceFrameFixture />,
  parameters: {
    docs: {
      description: {
        story:
          'The production editor header with local metadata responses. Rename, icons, colors and gem covers are interactive. The body is a geometry fixture; photo storage and full editor persistence are covered by application tests.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Change appearance' }));
    await userEvent.click(body.getByRole('button', { name: 'Primary, soft' }));
    await userEvent.click(body.getByRole('button', { name: 'Save appearance' }));
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
    const iconStyle = canvas
      .getByRole('button', { name: 'Change appearance' })
      .querySelector('.item-icon')
      ?.getAttribute('style');
    await expect(iconStyle).toContain('var(--fill-primary-soft-fg)');
    await expect(iconStyle).toContain('var(--fill-primary-soft-bg)');
    await userEvent.click(canvas.getByRole('button', { name: 'Rename Quarterly planning' }));
    const input = canvas.getByRole('textbox', { name: 'Document name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Autumn planning');
    await userEvent.click(canvas.getByRole('button', { name: 'Save name' }));
    const rename = await canvas.findByRole('button', { name: 'Rename Autumn planning' });
    await expect(rename).toBeVisible();
    const pencil = rename.querySelector('svg')!.getBoundingClientRect();
    const title = rename.querySelector('.editor-rename-text')!.getBoundingClientRect();
    const button = rename.getBoundingClientRect();
    // Font metrics vary across CI and local browsers; the pencil must remain
    // fully visible beside the bounded title at every reviewed viewport.
    await expect(title.width).toBeGreaterThan(0);
    await expect(pencil.width).toBeGreaterThanOrEqual(16);
    await expect(title.right).toBeLessThanOrEqual(pencil.left);
    await expect(pencil.right).toBeLessThanOrEqual(button.right);
    await userEvent.click(canvas.getByRole('button', { name: 'Change appearance' }));
    await expect(body.getByRole('button', { name: 'Primary, soft' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }));
  },
};
