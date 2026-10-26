import { SaveStatus } from './SaveStatus.tsx';
import { recordNativeMutationInventory } from './nativeMutationInventory.ts';
import {
  installDocFormulas,
  type DocFormula,
  type DocFormulaController,
  type DocFormulaSelection,
  type FormulaDefinition,
  type FormulaResult,
  type FormulaState,
} from '@spinel/doc-formulas';
import {
  FormulaDialog,
  FormulaResultView,
  formulaRequest,
  formulaPaperColors,
} from './DocFormulas.tsx';
import { documentPath } from './documentAccess.ts';
import { EditorTools } from './EditorTools.tsx';
import { useEditorChrome } from './EditorFrame.tsx';
import { printDocument } from './documentPrint.ts';
import { UniverDocsPrintPlugin } from '@univerjs-pro/docs-print';
import printEnglish from '@univerjs-pro/docs-print/locale/en-US';
import '@univerjs-pro/docs-print/lib/index.css';
import { editorTheme, bindEditorTheme, installCanvasColors } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import {
  DocStateChangeManagerService,
  DocStateEmitService,
  setDocumentPermissionValue,
} from '@univerjs/docs';
import { UnitAction } from '@univerjs/protocol';
import { watchPresence } from './Collaborators.tsx';
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
import { UniverDocsCorePreset, UniverDocsUIPlugin } from '@univerjs/preset-docs-core';
import enUS from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import {
  collaborationPlugins,
  prepareCollaboration,
  identifyCollaborator,
  watchCollaboration,
  loadSpinelDocument,
  disposeSpinelSync,
  ClientEnglish,
  UIEnglish,
} from './collaboration.ts';
import type { SaveState } from '../src/shared/autosave.ts';
import { editorReady } from './editorReady.ts';
import { documentReady } from './documentReady.ts';
import type { ConnectionState } from './connectionState.ts';
import { docPendingChanges } from './docPending.ts';
import { guestPendingBuffer } from './guestPendingBuffer.ts';
import type { RegisterGuestEditor } from './guestRevocation.ts';
import { nativeSyncPermissions } from './nativeSyncPermissions.ts';

export function DocEditor({
  id,
  name,
  spaceId,
  onDirty,
  registerGuestEditor,
  onConnectionState,
  saveStatusTarget,
}: {
  id: string;
  name: string;
  spaceId?: string;
  saveStatusTarget: HTMLElement | null;
  onDirty: (dirty: boolean) => void;
  registerGuestEditor?: RegisterGuestEditor;
  onConnectionState?: (state: ConnectionState | null) => void;
}) {
  const chrome = useEditorChrome();
  const formulas = useRef<DocFormulaController | null>(null);
  const [formulaStates, setFormulaStates] = useState<FormulaState[]>([]);
  const [formulaError, setFormulaError] = useState('');
  const [formulaEdit, setFormulaEdit] = useState<{
    formula?: DocFormula;
    selection?: DocFormulaSelection;
  } | null>(null);
  const canEditFormulas = useRef(false);
  const print = useRef<(() => Promise<void>) | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [editable, setEditable] = useState(false);
  const [people, setPeople] = useState<Collaborator[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof watchCollaboration> | null>(null);
  const [reloadGeneration, reload] = useState(0);
  const syncNotice = useRef<string | undefined>(undefined);
  const lastRoom = useRef('');
  const [status, setStatus] = useState<SaveState>({
    dirty: false,
    message: 'Loading document…',
    failed: false,
  });
  useEffect(() => {
    let disposed = false;
    let initialized = false;
    const room = `${spaceId ?? ''}/${id}`;
    if (lastRoom.current !== room) syncNotice.current = undefined;
    lastRoom.current = room;
    onConnectionState?.('reconnecting');
    const publishConnection = (state: ConnectionState) => {
      if (!disposed) onConnectionState?.(state);
    };
    const loading = new AbortController();
    let stopPresence: (() => void) | undefined;
    let formulaInterval: ReturnType<typeof setInterval> | undefined;
    let stopFormulaVisibility: (() => void) | undefined;
    setFormulaStates([]);
    setFormulaEdit(null);
    setFormulaError('');
    setPeople([]);
    let uploads = 0;
    let insertions = 0;
    let uploaded = 0;
    let disposeEditor: (() => void) | undefined;
    let save: ReturnType<typeof watchCollaboration> | undefined;
    let lastState: SaveState = { dirty: false, failed: false, message: 'Loading document…' };
    const publish = (state: SaveState) => {
      lastState = state;
      if (disposed) return;
      const busy = uploads > 0 || insertions > 0;
      const dirty = busy || state.dirty;
      if (dirty && initialized) syncNotice.current = undefined;
      onDirty(dirty);
      setStatus({
        ...state,
        dirty,
        failed: state.failed || (initialized && Boolean(syncNotice.current)),
        message: busy
          ? 'Inserting image — keep this tab open.'
          : state.failed
            ? state.message
            : ((initialized ? syncNotice.current : undefined) ?? state.message),
      });
    };
    publish(lastState);
    void (async () => {
      const data = await prepareCollaboration(id, spaceId, () => !disposed);
      if (disposed) return;
      const nativePermissions =
        data.syncVersion === 1 ? nativeSyncPermissions(data.unitId, data.access) : undefined;
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
            const response = await fetch(`${documentPath(id, spaceId)}/images`, {
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
      recordNativeMutationInventory();
      const { univer, univerAPI } = createUniver({
        theme: editorTheme(),
        darkMode: getTheme() === 'dark',
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(
            enUS,
            drawingEnUS,
            linkEnUS,
            ClientEnglish,
            UIEnglish,
            printEnglish,
          ),
        },
        ...(data.syncVersion !== 1 ? { collaboration: true as const } : {}),
        override: [
          ...(nativePermissions?.override ?? []),
          [IImageIoService, { useClass: StoredImages }],
        ],
        plugins: [
          [
            UniverDrawingPlugin,
            {
              override: [
                [IImageIoService, data.syncVersion === 1 ? { useClass: StoredImages } : null],
              ],
              allowImageSize: 5 * 1024 * 1024,
            },
          ],
          UniverDrawingUIPlugin,
          UniverDocsDrawingPlugin,
          UniverDocsDrawingUIPlugin,
          TrackedImageInsertion,
          UniverDocsPrintPlugin,
          ...collaborationPlugins(
            data.unitId,
            [[IImageIoService, { useClass: StoredImages }]],
            true,
            spaceId ? { spaceId, itemId: id } : undefined,
            data.syncVersion === 1,
          ),
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
          // SDK canvas hints are painted at 50% opacity, below AA on white paper.
          // Keep the instruction in accessible shell text instead.
          { plugins: [[UniverDocsUIPlugin, { placeholder: false }]] },
          UniverDocsHyperLinkPreset(),
        ],
      });
      print.current = async () => {
        await printDocument(univerAPI);
      };
      const stopTheme = bindEditorTheme(univer);
      disposeEditor = () => {
        disposeSpinelSync(univer);
        stopTheme();
        univer.dispose();
      };
      registerGuestEditor?.((retain) => {
        try {
          return retain ? guestPendingBuffer(univer) : null;
        } finally {
          disposed = true;
          canEditFormulas.current = false;
          loading.abort();
          clearInterval(formulaInterval);
          stopFormulaVisibility?.();
          formulas.current?.dispose();
          formulas.current = null;
          stopPresence?.();
          save?.dispose();
          disposeEditor?.();
          disposeEditor = undefined;
        }
      });
      installCanvasColors(univer);
      identifyCollaborator(univer, data.user);
      const readonly = async () => {
        nativePermissions?.readonly();
        canEditFormulas.current = false;
        setFormulaEdit(null);
        formulas.current?.clear();
        setEditable(false);
        // Local UI state only: changing the shared document's permission rules
        // would also make still-authorized collaborators read-only.
        const permissions = univer.__getInjector().get(IPermissionService);
        setDocumentPermissionValue(permissions, data.unitId, data.unitId, UnitAction.Edit, false);
        setDocumentPermissionValue(permissions, data.unitId, data.unitId, UnitAction.Copy, true);
      };
      if (data.syncVersion === 1)
        await loadSpinelDocument({
          univer,
          unitId: data.unitId,
          itemId: id,
          spaceId,
          access: data.access,
          kind: 'doc',
          signal: loading.signal,
          isCurrent: () => !disposed,
          initializeAccess: () => (data.access === 'viewer' ? readonly() : undefined),
          onInitialPending: () =>
            publish({
              dirty: true,
              failed: false,
              message: 'Changes not saved yet — keep this tab open.',
            }),
          reload: () => {
            if (disposed) return;
            initialized = false;
            syncNotice.current =
              'The document was reloaded after a synchronization problem. Edits the server did not accept were discarded.';
            publish({
              dirty: false,
              failed: true,
              message: 'Reloading after a synchronization problem…',
            });
            reload((generation) => generation + 1);
          },
        });
      const document =
        data.syncVersion === 1
          ? univerAPI.getActiveDocument()
          : await univerAPI.getCollaboration().loadDocAsync(data.unitId);
      if (!document) throw new Error('Could not load this document.');
      await editorReady(univerAPI);
      // A document-type plugin can initialize after the global Rendered stage.
      // Do not advertise readiness until our drawing commands are installed too.
      await drawingsRendered;
      if (disposed) return;
      await documentReady(univer, data.unitId, loading.signal);
      if (disposed) return;
      const installedFormulas = await installDocFormulas({
        univer,
        unitId: data.unitId,
        colors: formulaPaperColors,
        evaluate: (definition, signal) =>
          formulaRequest<FormulaResult>(id, 'evaluate', { definition }, signal, spaceId),
        onActivate: (formula) => {
          if (canEditFormulas.current) setFormulaEdit({ formula });
        },
        onChange: (states) => {
          if (!disposed) setFormulaStates([...states]);
        },
      });
      if (disposed) {
        installedFormulas.dispose();
        return;
      }
      formulas.current = installedFormulas;
      const refreshVisible = () => {
        if (globalThis.document.visibilityState === 'hidden') formulas.current?.clear();
        else void formulas.current?.refresh();
      };
      globalThis.document.addEventListener('visibilitychange', refreshVisible);
      stopFormulaVisibility = () =>
        globalThis.document.removeEventListener('visibilitychange', refreshVisible);
      formulaInterval = setInterval(() => {
        if (globalThis.document.visibilityState === 'visible') void formulas.current?.refresh();
      }, 5000);
      if (data.access === 'viewer') await readonly();
      else {
        canEditFormulas.current = true;
        setEditable(true);
        document.setSelection(0, 0);
      }
      stopPresence = await watchPresence(univer, univerAPI, data.unitId, setPeople);
      if (disposed) {
        stopPresence();
        return;
      }
      initialized = true;
      save = watchCollaboration(
        univer,
        univerAPI,
        data.unitId,
        id,
        data.access,
        publish,
        readonly,
        publishConnection,
        spaceId,
        data.syncVersion === 1
          ? undefined
          : docPendingChanges(
              data.unitId,
              univer.__getInjector().get(DocStateEmitService),
              univer.__getInjector().get(DocStateChangeManagerService),
            ),
      );
      controller.current = save;
    })().catch((error) => {
      publishConnection('offline');
      if (!disposed)
        publish({
          dirty: lastState.dirty,
          message:
            error instanceof Error
              ? error.message
              : 'Could not load this document. Reload to try again.',
          failed: true,
        });
    });
    return () => {
      disposed = true;
      registerGuestEditor?.(null);
      canEditFormulas.current = false;
      clearInterval(formulaInterval);
      stopFormulaVisibility?.();
      formulas.current?.dispose();
      formulas.current = null;
      loading.abort();
      stopPresence?.();
      save?.dispose();
      // Univer owns a separate React root; unmount it after our cleanup commit.
      if (disposeEditor) queueMicrotask(disposeEditor);
      controller.current = null;
      setEditable(false);
      onDirty(false);
      onConnectionState?.(null);
    };
    // Name is folder metadata; a rename must not recreate an editor with pending edits.
  }, [id, spaceId, reloadGeneration]);
  return (
    <section className="sheet-editor" aria-label="Doc document">
      <SaveStatus
        state={status}
        target={chrome?.saveTarget ?? saveStatusTarget}
        onRetry={() => controller.current?.retry()}
      />
      <EditorTools
        id={id}
        name={name}
        spaceId={spaceId}
        people={people}
        saved={!status.dirty && !status.failed && Boolean(controller.current)}
        print={async () => {
          if (!print.current) throw new Error('Wait for the document to load.');
          await print.current();
        }}
        insertFormula={
          editable
            ? () => {
                try {
                  if (!formulas.current) throw new Error('Wait for the document to load.');
                  setFormulaError('');
                  setFormulaEdit({ selection: formulas.current.selection() });
                } catch (cause) {
                  setFormulaError(
                    cause instanceof Error
                      ? cause.message
                      : 'Place the cursor in the document first.',
                  );
                }
              }
            : undefined
        }
        formulas={
          controller.current
            ? (close) => (
                <div className="doc-formulas">
                  {formulaError && <p role="alert">{formulaError}</p>}
                  {!formulaStates.length && (
                    <p>Use a spreadsheet cell, range, or calculation in this Doc.</p>
                  )}
                  <ul>
                    {formulaStates.map(({ formula, result }) => (
                      <li key={formula.id}>
                        {editable ? (
                          <button
                            onClick={() => {
                              close();
                              setFormulaEdit({ formula });
                            }}
                          >
                            {formula.definition.expression}
                          </button>
                        ) : (
                          <code>{formula.definition.expression}</code>
                        )}
                        <FormulaResultView result={result} definition={formula.definition} />
                      </li>
                    ))}
                  </ul>
                  {formulaStates.length > 0 && (
                    <button onClick={() => void formulas.current?.resume()}>
                      Refresh formulas
                    </button>
                  )}
                </div>
              )
            : undefined
        }
      />
      {formulaEdit && editable && (
        <FormulaDialog
          id={id}
          spaceId={spaceId}
          initial={formulaEdit.formula}
          onClose={() => {
            setFormulaEdit(null);
            // Wait for dialog cleanup before returning keyboard input to the native document.
            requestAnimationFrame(() => formulas.current?.focus());
          }}
          onSave={async (definition: FormulaDefinition, signal: AbortSignal) => {
            if (!formulas.current || !canEditFormulas.current)
              throw new Error('This document is read-only.');
            if (
              !(await formulas.current.insert(
                definition,
                formulaEdit.selection,
                formulaEdit.formula?.id,
                signal,
              ))
            )
              throw new Error('The formula could not be inserted.');
          }}
        />
      )}
      <p className="editor-help" role={uploadError || formulaError ? 'alert' : undefined}>
        {uploadError
          ? `${uploadError} Try inserting the file again.`
          : formulaError || (editable ? 'Click the page to write. Type / for commands.' : '')}
      </p>
      <div className="univer-container" ref={container} />
    </section>
  );
}
