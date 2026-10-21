import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY } from '@univerjs/core';
import { NativeEditor } from './NativeEditors.tsx';
import type { NativeEditorHandle, NativeEditorProps } from './NativeEditors.tsx';
import { Button } from './Controls.tsx';

function browserSelection() {
  const selection = window.getSelection();
  const describe = (node: Node | null) => {
    const element = node instanceof Element ? node : node?.parentElement;
    return element
      ? { tag: element.tagName, id: element.id, editable: element.getAttribute('contenteditable') }
      : null;
  };
  return selection
    ? {
        rangeCount: selection.rangeCount,
        collapsed: selection.isCollapsed,
        anchor: describe(selection.anchorNode),
        anchorOffset: selection.anchorOffset,
        focus: describe(selection.focusNode),
        focusOffset: selection.focusOffset,
      }
    : null;
}

/** Observation belongs to the isolated story, never a production global. */
function NativeEditorStory(props: NativeEditorProps) {
  const editor = useRef<NativeEditorHandle>();
  const events = useRef<Record<string, unknown>[]>([]);
  const inputEvents = useRef<Record<string, unknown>[]>([]);
  const textCommands = useRef<Record<string, unknown>[]>([]);
  const keyEvents = useRef<Record<string, unknown>[]>([]);
  const stopEvents = useRef<(() => void)[]>([]);
  const record = (event: Record<string, unknown>) => {
    const log =
      event.event === 'input' || event.event === 'input-capture'
        ? inputEvents
        : event.event === 'keydown'
          ? keyEvents
          : event.id === 'doc.command.insert-text' || event.id === 'doc.command.replace-selection'
            ? textCommands
            : events;
    log.current = [...log.current.slice(log === inputEvents ? -63 : -23), event];
  };
  useEffect(() => () => stopEvents.current.forEach((stop) => stop()), []);
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
          inputDocument:
            props.kind === 'sheet'
              ? editor.current.api.getDocument(DOCS_NORMAL_EDITOR_UNIT_ID_KEY)?.save().body
              : undefined,
          events: events.current,
          inputEvents: inputEvents.current,
          textCommands: textCommands.current,
          keyEvents: keyEvents.current,
          browserSelection: browserSelection(),
          snapshot: editor.current.getSnapshot(),
        }),
      );
  };
  return (
    <div
      className="sp-ui"
      onKeyDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.rd-native-editor')) return;
        record({
          event: 'keydown',
          phase: 'capture',
          target: target.id,
          key: event.key,
          selection: browserSelection(),
        });
      }}
      onInputCapture={(event) => {
        const input = event.nativeEvent as InputEvent;
        record({
          event: 'input-capture',
          target: (event.target as HTMLElement).id,
          data: input.data,
          inputType: input.inputType,
          defaultPrevented: input.defaultPrevented,
          text: (event.target as HTMLElement).textContent?.slice(0, 120),
        });
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.rd-native-editor')) return;
        record({
          event: 'keydown',
          phase: 'bubble',
          target: target.id,
          key: event.key,
          defaultPrevented: event.defaultPrevented,
          editable: target.isContentEditable,
        });
      }}
      onInput={(event) => {
        const input = event.nativeEvent as InputEvent;
        record({
          event: 'input',
          target: (event.target as HTMLElement).id,
          data: input.data,
          inputType: input.inputType,
          defaultPrevented: input.defaultPrevented,
        });
      }}
    >
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
          stopEvents.current.forEach((stop) => stop());
          stopEvents.current = [
            handle.api.addEvent(handle.api.Event.BeforeCommandExecute, (event) => {
              record({ event: 'before-command', id: event.id, unitId: event.params?.unitId });
            }),
            handle.api.addEvent(handle.api.Event.CommandExecuted, (event) => {
              record({ event: 'command', id: event.id, unitId: event.params?.unitId });
            }),
          ].map((subscription) => () => subscription.dispose());
          observe();
        }}
        onChange={observe}
      />
    </div>
  );
}

const meta = {
  title: 'Redesign/Native editors',
  component: NativeEditor,
  render: (args) => <NativeEditorStory {...args} />,
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Real open-source Univer editors with local fixture data. One active editor at a time; no collaboration, accounts, server requests or persistence.',
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
