import { VersionNames } from './VersionNames.tsx';
import { editorTheme, bindEditorTheme } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import { setDocumentPermissionValue } from '@univerjs/docs';
import { UnitAction } from '@univerjs/protocol';
import { Collaborators, watchPresence } from './Collaborators.tsx';
import type { Collaborator } from './Collaborators.tsx';
import { useEffect, useRef, useState } from 'react';
import {
  IPermissionService,
  IImageIoService,
  ImageSourceType,
  ImageUploadStatusType,
  ICommandService,
  Inject,
  Injector,
  Plugin,
  UniverInstanceType,
} from '@univerjs/core';
import { ImageIoService } from '@univerjs/drawing';
import {
  UniverDrawingPlugin,
  UniverDrawingUIPlugin,
  UniverDocsDrawingPlugin,
  UniverDocsDrawingUIPlugin,
  DOCS_SHAPE_MENU_ID,
  DOCS_SHAPE_BELOW_MENU_ID,
  InsertDocImageCommand,
  InsertDocRectangleShapeCommand,
  InsertDocEllipseShapeCommand,
} from '@univerjs/preset-docs-drawing';
import { UniverDocsHyperLinkPreset } from '@univerjs/preset-docs-hyper-link';
import linkEnUS from '@univerjs/preset-docs-hyper-link/locales/en-US';
import '@univerjs/preset-docs-hyper-link/lib/index.css';
import drawingEnUS from '@univerjs/preset-docs-drawing/locales/en-US';
import '@univerjs/preset-docs-drawing/lib/index.css';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import enUS from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
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
import { documentReady } from './documentReady.ts';

export function DocEditor({
  id,
  onDirty,
}: {
  id: string;
  name: string;
  onDirty: (dirty: boolean) => void;
}) {
  const [uploadError, setUploadError] = useState('');
  const [people, setPeople] = useState<Collaborator[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof watchCollaboration> | null>(null);
  const [status, setStatus] = useState<SaveState>({
    dirty: false,
    message: 'Loading document…',
    failed: false,
  });
  useEffect(() => {
    let disposed = false;
    const loading = new AbortController();
    let stopPresence: (() => void) | undefined;
    setPeople([]);
    let uploads = 0;
    let insertions = 0;
    let uploaded = 0;
    let disposeEditor: (() => void) | undefined;
    let save: ReturnType<typeof watchCollaboration> | undefined;
    let lastState = status;
    const publish = (state: SaveState) => {
      lastState = state;
      if (disposed) return;
      const busy = uploads > 0 || insertions > 0;
      const dirty = busy || state.dirty;
      onDirty(dirty);
      setStatus({
        ...state,
        dirty,
        message: busy ? 'Inserting image — keep this tab open.' : state.message,
      });
    };
    void (async () => {
      const data = await prepareCollaboration(id);
      if (disposed) return;
      let drawingReady!: () => void;
      const drawingsRendered = new Promise<void>((resolve) => {
        drawingReady = resolve;
      });
      class StoredImages extends ImageIoService {
        override async saveImage(file: File) {
          uploads++;
          this.setWaitCount(uploads);
          setUploadError('');
          publish(lastState);
          try {
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
              throw new Error('Choose a PNG, JPEG or WebP image.');
            const response = await fetch(`/api/items/${id}/images`, {
              method: 'POST',
              headers: { 'Content-Type': file.type },
              body: file,
              signal: AbortSignal.timeout(30_000),
            });
            const image = await response.json();
            if (!response.ok) throw new Error(image.error ?? 'Image upload failed.');
            uploaded++;
            return {
              imageId: crypto.randomUUID(),
              imageSourceType: ImageSourceType.URL,
              source: image.url as string,
              base64Cache: image.url as string,
              status: ImageUploadStatusType.SUCCUSS,
            };
          } catch (error) {
            if (!disposed)
              setUploadError(
                error instanceof Error
                  ? error.message
                  : 'Image upload failed. Try inserting the file again.',
              );
            throw new Error(ImageUploadStatusType.ERROR_IMAGE);
          } finally {
            uploads--;
            this.setWaitCount(uploads);
            publish(lastState);
          }
        }
      }
      class TrackedImageInsertion extends Plugin {
        static override pluginName = 'SPINEL_DOC_IMAGE_INSERTION';
        static override type = UniverInstanceType.UNIVER_DOC;
        protected _injector: Injector;
        constructor(_config: unknown, injector: Injector) {
          super();
          this._injector = injector;
        }
        override onRendered() {
          const commands = this._injector.get(ICommandService);
          commands.unregisterCommand(InsertDocImageCommand.id);
          this.disposeWithMe(
            commands.registerCommand({
              ...InsertDocImageCommand,
              handler: async (accessor, params, options) => {
                insertions++;
                const before = uploaded;
                publish(lastState);
                try {
                  const result = await InsertDocImageCommand.handler(
                    accessor,
                    params as Parameters<typeof InsertDocImageCommand.handler>[1],
                    options,
                  );
                  if (!result && uploaded > before && !disposed)
                    setUploadError('The image was uploaded but could not be inserted.');
                  return result;
                } catch {
                  if (!disposed) setUploadError('The image could not be inserted.');
                  return false;
                } finally {
                  // Upload completion precedes dimension loading and the drawing mutation.
                  // Capture that mutation before allowing navigation to report a clean editor.
                  insertions--;
                  publish(lastState);
                }
              },
            }),
          );
          drawingReady();
        }
      }
      Inject(Injector)(TrackedImageInsertion, undefined, 1);
      const { univer, univerAPI } = createUniver({
        theme: editorTheme(),
        darkMode: getTheme() === 'dark',
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(enUS, drawingEnUS, linkEnUS, ClientEnglish, UIEnglish),
        },
        collaboration: true,
        override: [[IImageIoService, { useClass: StoredImages }]],
        plugins: [
          [
            UniverDrawingPlugin,
            {
              override: [[IImageIoService, null]],
              allowImageSize: 5 * 1024 * 1024,
            },
          ],
          UniverDrawingUIPlugin,
          UniverDocsDrawingPlugin,
          UniverDocsDrawingUIPlugin,
          TrackedImageInsertion,
          ...collaborationPlugins(id, [[IImageIoService, { useClass: StoredImages }]]),
        ],
        presets: [
          UniverDocsCorePreset({
            container: container.current!,
            menu: Object.fromEntries(
              [
                DOCS_SHAPE_MENU_ID,
                DOCS_SHAPE_BELOW_MENU_ID,
                InsertDocRectangleShapeCommand.id,
                InsertDocEllipseShapeCommand.id,
                `${InsertDocRectangleShapeCommand.id}.below`,
                `${InsertDocEllipseShapeCommand.id}.below`,
              ].map((id) => [id, { hidden: true }]),
            ),
          }),
          UniverDocsHyperLinkPreset(),
        ],
      });
      const stopTheme = bindEditorTheme(univer);
      disposeEditor = () => {
        stopTheme();
        univer.dispose();
      };
      identifyCollaborator(univer, data.user);
      const document = await univerAPI.getCollaboration().loadDocAsync(id);
      if (!document) throw new Error('Could not load this document.');
      await editorReady(univerAPI);
      // A document-type plugin can initialize after the global Rendered stage.
      // Do not advertise readiness until our drawing commands are installed too.
      await drawingsRendered;
      if (disposed) return;
      await documentReady(univer, id, loading.signal);
      if (disposed) return;
      const readonly = async () => {
        // Local UI state only: changing the shared document's permission rules
        // would also make still-authorized collaborators read-only.
        const permissions = univer.__getInjector().get(IPermissionService);
        setDocumentPermissionValue(permissions, id, id, UnitAction.Edit, false);
        setDocumentPermissionValue(permissions, id, id, UnitAction.Copy, true);
      };
      if (data.access === 'viewer') await readonly();
      else document.setSelection(0, 0);
      stopPresence = await watchPresence(univer, univerAPI, id, setPeople);
      if (disposed) {
        stopPresence();
        return;
      }
      save = watchCollaboration(univer, univerAPI, id, data.access, publish, readonly);
      controller.current = save;
    })().catch((error) => {
      if (!disposed)
        publish({
          dirty: false,
          message:
            error instanceof Error
              ? error.message
              : 'Could not load this document. Reload to try again.',
          failed: true,
        });
    });
    return () => {
      disposed = true;
      loading.abort();
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
    <section className="sheet-editor" aria-label="Doc document">
      <Collaborators people={people} />
      <div className="save-status" role="status" aria-label="Save status" aria-live="polite">
        {status.message}
        {status.failed && status.dirty && (
          <button onClick={() => controller.current?.retry()}>Retry saving</button>
        )}
      </div>
      {uploadError && <p role="alert">{uploadError} Try inserting the file again.</p>}
      <VersionNames
        id={id}
        saved={!status.dirty && !status.failed && Boolean(controller.current)}
      />
      <div className="univer-container" ref={container} />
    </section>
  );
}
