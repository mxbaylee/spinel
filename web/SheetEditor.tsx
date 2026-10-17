import { useEffect, useRef, useState } from 'react';
import { CommandType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { createUniver, LocaleType } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import enUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import { Autosave, SaveFailure } from '../src/shared/autosave.ts';
import type { SaveState } from '../src/shared/autosave.ts';

export function SheetEditor({
  id,
  name,
  onDirty,
}: {
  id: string;
  name: string;
  onDirty: (dirty: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<Autosave | null>(null);
  const [status, setStatus] = useState<SaveState>({
    dirty: false,
    message: 'Loading spreadsheet…',
    failed: false,
  });
  useEffect(() => {
    let disposed = false;
    let editing = false;
    let disposeEditor: (() => void) | undefined;
    let save: Autosave | undefined;
    let lastState = status;
    const publish = (state: SaveState) => {
      lastState = state;
      if (disposed) return;
      const dirty = editing || state.dirty;
      onDirty(dirty);
      setStatus({
        ...state,
        dirty,
        message: editing && !state.failed ? 'Editing cell — changes not saved yet.' : state.message,
      });
    };
    void (async () => {
      const response = await fetch(`/api/items/${id}/sheet`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not load this spreadsheet.');
      if (disposed) return;
      const data = result as { snapshot: IWorkbookData | null; revision: number };
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: enUS },
        presets: [UniverSheetsCorePreset({ container: container.current! })],
      });
      disposeEditor = () => univer.dispose();
      const workbook = univerAPI.createWorkbook(
        data.snapshot ?? { id, name, locale: LocaleType.EN_US },
      );
      save = new Autosave(
        data.revision,
        data.snapshot,
        async (payload) => {
          const response = await fetch(`/api/items/${id}/sheet`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
          });
          const result = await response.json();
          if (!response.ok)
            throw new SaveFailure(
              response.status,
              result.error ?? 'Changes have not been saved. Try again.',
            );
          return result as { revision: number };
        },
        publish,
      );
      controller.current = save;
      const capture = () => {
        if (disposed) return;
        try {
          save!.changed(workbook.save());
        } catch {
          publish({
            dirty: true,
            message:
              'Could not prepare your changes for saving. Keep this tab open and copy your changes.',
            failed: true,
          });
        }
      };
      workbook.onCommandExecuted((command) => {
        if (command.type === CommandType.MUTATION) queueMicrotask(capture);
      });
      univerAPI.addEvent(univerAPI.Event.SheetEditChanging, () => {
        editing = true;
        publish(lastState);
      });
      univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
        editing = false;
        queueMicrotask(capture);
      });
      capture();
    })().catch((error) => {
      if (!disposed)
        publish({
          dirty: false,
          message:
            error instanceof Error
              ? error.message
              : 'Could not load this spreadsheet. Reload to try again.',
          failed: true,
        });
    });
    const online = () => save?.retry();
    window.addEventListener('online', online);
    return () => {
      disposed = true;
      window.removeEventListener('online', online);
      save?.dispose();
      // Univer owns a separate React root; unmount it after our cleanup commit.
      if (disposeEditor) queueMicrotask(disposeEditor);
      controller.current = null;
      onDirty(false);
    };
    // Name is folder metadata; a rename must not recreate an editor with pending edits.
  }, [id]);
  return (
    <section className="sheet-editor" aria-label="Sheet document">
      <div className="save-status" role="status" aria-live="polite">
        {status.message}
        {status.failed && status.dirty && (
          <button onClick={() => controller.current?.retry()}>Retry saving</button>
        )}
      </div>
      <div className="univer-container" ref={container} />
    </section>
  );
}
