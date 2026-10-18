import { VersionNames } from './VersionNames.tsx';
import { IPermissionService } from '@univerjs/core';
import { getAllWorkbookPermissionPoint } from '@univerjs/sheets';
import { UnitAction } from '@univerjs/protocol';
import { Collaborators, watchPresence } from './Collaborators.tsx';
import type { Collaborator } from './Collaborators.tsx';
import { useEffect, useRef, useState } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import enUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import {
  collaborationPlugins,
  prepareCollaboration,
  identifyCollaborator,
  watchCollaboration,
  ClientEnglish,
  UIEnglish,
} from './collaboration.ts';
import type { SaveState } from '../src/shared/autosave.ts';
import { editorReady } from './editorReady.ts';

export function SheetEditor({
  id,
  onDirty,
}: {
  id: string;
  name: string;
  onDirty: (dirty: boolean) => void;
}) {
  const [people, setPeople] = useState<Collaborator[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof watchCollaboration> | null>(null);
  const [status, setStatus] = useState<SaveState>({
    dirty: false,
    message: 'Loading spreadsheet…',
    failed: false,
  });
  useEffect(() => {
    let disposed = false;
    let stopPresence: (() => void) | undefined;
    setPeople([]);
    let editing = false;
    let disposeEditor: (() => void) | undefined;
    let save: ReturnType<typeof watchCollaboration> | undefined;
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
      const data = await prepareCollaboration(id);
      if (disposed) return;
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(enUS, ClientEnglish, UIEnglish) },
        collaboration: true,
        plugins: collaborationPlugins(data.unitId),
        presets: [UniverSheetsCorePreset({ container: container.current! })],
      });
      disposeEditor = () => univer.dispose();
      identifyCollaborator(univer, data.user);
      const workbook = await univerAPI.getCollaboration().loadSheetAsync(data.unitId);
      if (!workbook) throw new Error('Could not load this spreadsheet.');
      await editorReady(univerAPI);
      if (disposed) return;
      const readOnly = async () => {
        // This tab's presentation follows its grant; never change shared permissions.
        const permissions = univer.__getInjector().get(IPermissionService);
        for (const Point of getAllWorkbookPermissionPoint()) {
          const point = new Point(data.unitId);
          if (!permissions.getPermissionPoint(point.id)) permissions.addPermissionPoint(point);
          permissions.updatePermissionPoint(
            point.id,
            [UnitAction.View, UnitAction.Copy, UnitAction.Print].includes(point.subType),
          );
        }
      };
      if (data.access === 'viewer') await readOnly();
      save = watchCollaboration(univer, univerAPI, data.unitId, id, data.access, publish, readOnly);
      controller.current = save;
      stopPresence = await watchPresence(univer, univerAPI, data.unitId, setPeople);
      if (disposed) stopPresence();
      univerAPI.addEvent(univerAPI.Event.SheetEditChanging, () => {
        editing = true;
        publish(lastState);
      });
      univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
        editing = false;
        publish(lastState);
      });
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
    return () => {
      disposed = true;
      stopPresence?.();
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
      <Collaborators people={people} />
      <div className="save-status" role="status" aria-label="Save status" aria-live="polite">
        {status.message}
        {status.failed && status.dirty && (
          <button onClick={() => controller.current?.retry()}>Retry saving</button>
        )}
      </div>
      <VersionNames
        id={id}
        saved={!status.dirty && !status.failed && Boolean(controller.current)}
      />
      <div className="univer-container" ref={container} />
    </section>
  );
}
