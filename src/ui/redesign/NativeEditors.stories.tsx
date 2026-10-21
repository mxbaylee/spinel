import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY } from '@univerjs/core';
import { NativeEditor } from './NativeEditors.tsx';
import type { NativeEditorHandle, NativeEditorProps } from './NativeEditors.tsx';
import { Button } from './Controls.tsx';

/** Observation belongs to the isolated story, never a production global. */
function NativeEditorStory(props: NativeEditorProps) {
  const editor = useRef<NativeEditorHandle>();
  const events = useRef<Record<string, unknown>[]>([]);
  const stopEvents = useRef<(() => void)[]>([]);
  const record = (event: Record<string, unknown>) => {
    events.current = [...events.current.slice(-23), event];
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
          snapshot: editor.current.getSnapshot(),
        }),
      );
  };
  return (
    <div
      className="sp-ui"
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
