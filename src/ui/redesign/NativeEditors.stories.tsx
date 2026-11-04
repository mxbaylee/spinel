import { expect, userEvent, waitFor, within } from 'storybook/test';
import { syncSheetMenuFixture } from '../syncSheetMenus.fixture.ts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { NativeEditor } from './NativeEditors.tsx';
import type { NativeEditorHandle, NativeEditorProps } from './NativeEditors.tsx';
import { Button } from './Controls.tsx';
import { assertDialogTitle } from '../../../.storybook/dialogBounds.ts';
import { MAKE_COPY_COMMAND } from '../../../web/nativeCopy.tsx';

/** Observation belongs to the isolated story, never a production global. */
function NativeEditorStory(props: NativeEditorProps) {
  const editor = useRef<NativeEditorHandle>(undefined);
  const [observation, setObservation] = useState('');
  const observe = () => {
    if (editor.current)
      setObservation(
        JSON.stringify({
          canEdit: editor.current.canEdit(),
          activeRange:
            props.kind === 'sheet'
              ? editor.current.api.getActiveWorkbook()?.getActiveRange()?.getA1Notation()
              : undefined,
          snapshot: editor.current.getSnapshot(),
        }),
      );
  };
  return (
    <div className="rd-native-story-content">
      <details className="rd-native-review-tools">
        <summary>Native editor review controls</summary>
        <p>
          Local fixture selection and inspection. Keyboard input still goes through the real editor.
        </p>
        <Button
          onClick={() => {
            const api = editor.current?.api;
            if (props.kind === 'sheet') {
              const workbook = api?.getActiveWorkbook();
              const sheet = workbook?.getActiveSheet();
              if (sheet) sheet.setActiveRange(sheet.getRange('A16'));
            } else api?.getActiveDocument()?.setSelection(0, 0);
            observe();
          }}
        >
          {props.kind === 'sheet' ? 'Select cell A16' : 'Select document start'}
        </Button>
        <Button onClick={observe}>Read current snapshot</Button>
      </details>
      <output hidden data-native-snapshot>
        {observation}
      </output>
      <NativeEditor
        {...props}
        onReady={(handle) => {
          editor.current = handle;
          observe();
        }}
        onChange={observe}
      />
    </div>
  );
}

const meta = {
  id: 'redesign-native-editors',
  title: 'Native fixtures/Editors',
  component: NativeEditor,
  render: (args) => <NativeEditorStory {...args} />,
  decorators: [
    (Story) => (
      <div className="sp-ui rd-native-story">
        <Story />
      </div>
    ),
  ],
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Real open-source Univer editors with local fixture data. Copy dialogs use the production addon with local API fixtures. One active editor at a time; no collaboration, accounts or persistence.',
      },
    },
  },
} satisfies Meta<typeof NativeEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Sheet: Story = { args: { kind: 'sheet' } };
export const Doc: Story = { args: { kind: 'doc' } };
export const SheetViewer: Story = { args: { kind: 'sheet', readOnly: true } };
export const DocViewer: Story = { args: { kind: 'doc', readOnly: true } };

const copyFileId = '00000000-0000-4000-8000-000000000089';
const copyApi = {
  [`GET /api/items/${copyFileId}/copy-options`]: {
    name: 'Autumn plans (copy)',
    parentId: null,
    destinations: [],
  },
};

export const MakeCopyDialog: Story = {
  args: { kind: 'doc', copyFileId },
  parameters: { api: copyApi },
  render: (args) => (
    <NativeEditor
      {...args}
      onReady={({ api }) => {
        // Global dialog parts can mount after the document renderer is ready.
        // Real toolbar clicks and phone taps remain covered by e2e/copy.spec.ts.
        const steady = api.Enum.LifecycleStages.Steady;
        const open = () => {
          void api.executeCommand(MAKE_COPY_COMMAND);
        };
        if (api.getCurrentLifecycleStage() >= steady) {
          open();
          return;
        }
        const listener = api.disposeWithMe(
          api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => {
            if (stage >= steady) {
              listener.dispose();
              open();
            }
          }),
        );
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(
      () => expect(canvasElement.querySelector('[data-native-stage="ready"]')).toBeInTheDocument(),
      { timeout: 30_000 },
    );
    const document = canvasElement.ownerDocument;
    const mobile = canvasElement.querySelector<HTMLElement>('[data-u-comp="mobile-more-trigger"]');
    const page = within(document.body);
    const dialog = await page.findByRole('dialog', { name: 'Make a copy' }, { timeout: 30_000 });
    await waitFor(() => expect(dialog).toBeVisible());
    if (mobile) {
      // Univer's mobile drawer owns a plain title region, not a heading.
      // Keep its app-scoped accessible name and verify our actual title content.
      await expect(dialog).toHaveAccessibleName('Make a copy');
      const title = dialog.querySelector('.sp-modal-title');
      await expect(title).toBeVisible();
      await expect(title).toHaveTextContent(/^Make a copy$/);
      const cue = dialog.querySelector('.sp-modal-title-icon');
      await expect(cue).toBeVisible();
      await expect(cue).toHaveAttribute('aria-hidden', 'true');
      expect(cue?.textContent?.trim() || cue?.querySelector('svg')).toBeTruthy();
    } else await assertDialogTitle(dialog, 'Make a copy');
    await expect(await within(dialog).findByRole('textbox', { name: 'Name' })).toHaveValue(
      'Autumn plans (copy)',
    );
  },
};

export const SheetFormula: Story = {
  args: { kind: 'sheet' },
  render: () => (
    <NativeEditor
      kind="sheet"
      onReady={({ api }) => {
        const sheet = api.getActiveWorkbook()?.getActiveSheet();
        if (sheet) sheet.setActiveRange(sheet.getRange('D11'));
      }}
    />
  ),
};

function inspectCopyMenu(available: boolean): NonNullable<Story['play']> {
  return async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(
      () => {
        expect(canvasElement.querySelector('[data-native-stage="ready"]')).toBeInTheDocument();
      },
      { timeout: 30_000 },
    );
    const mobile = canvas.queryByRole('button', { name: 'Open sheet menu' });
    if (mobile) await userEvent.click(mobile);
    else
      await userEvent.pointer({
        target: canvas.getByRole('tab', {
          name: available ? 'Small sheet' : 'Large sheet',
        }),
        keys: '[MouseRight]',
      });
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByText('Rename', { exact: true })).toBeVisible());
    if (available)
      await waitFor(() => expect(body.getByText('Copy', { exact: true })).toBeVisible());
    else expect(body.queryByText('Copy', { exact: true })).not.toBeInTheDocument();
    for (const label of [
      'Protect Worksheet',
      'Unprotect Worksheet',
      'Change permissions',
      'Remove protection',
    ])
      expect(body.queryByText(label, { exact: true })).not.toBeInTheDocument();
  };
}

export const SheetCopyAvailable: Story = {
  args: { kind: 'sheet', getSnapshot: () => syncSheetMenuFixture() },
  play: inspectCopyMenu(true),
};
export const SheetCopyUnavailable: Story = {
  args: { kind: 'sheet', getSnapshot: () => syncSheetMenuFixture(true) },
  play: inspectCopyMenu(false),
};
