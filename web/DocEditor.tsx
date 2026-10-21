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
import { guestItemId, documentPath } from './documentAccess.ts';
import { VersionNames } from './VersionNames.tsx';
import { FileExports } from './FileExports.tsx';
import { printDocument } from './documentPrint.ts';
import { UniverDocsPrintPlugin } from '@univerjs-pro/docs-print';
import printEnglish from '@univerjs-pro/docs-print/locale/en-US';
import '@univerjs-pro/docs-print/lib/index.css';
import { editorTheme, bindEditorTheme, installCanvasColors } from '../src/ui/editorTheme.ts';
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
import { UniverDocsCorePreset, UniverDocsUIPlugin } from '@univerjs/preset-docs-core';
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
import type { ConnectionState } from './connectionState.ts';

export function DocEditor({
  id,
  name,
  onDirty,
  onConnectionState,
}: {
  id: string;
  name: string;
  onDirty: (dirty: boolean) => void;
  onConnectionState?: (state: ConnectionState | null) => void;
}) {
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
  const [status, setStatus] = useState<SaveState>({
    dirty: false,
    message: 'Loading document…',
    failed: false,
  });
  useEffect(() => {
    let disposed = false;
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
            const response = await fetch(`${documentPath(id)}/images`, {
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
          [LocaleType.EN_US]: mergeLocales(
            enUS,
            drawingEnUS,
            linkEnUS,
            ClientEnglish,
            UIEnglish,
            printEnglish,
          ),
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
          UniverDocsPrintPlugin,
          ...collaborationPlugins(
            data.unitId,
            [[IImageIoService, { useClass: StoredImages }]],
            true,
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
        stopTheme();
        univer.dispose();
      };
      installCanvasColors(univer);
      identifyCollaborator(univer, data.user);
      const document = await univerAPI.getCollaboration().loadDocAsync(data.unitId);
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
          formulaRequest<FormulaResult>(id, 'evaluate', { definition }, signal),
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
      const readonly = async () => {
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
      save = watchCollaboration(
        univer,
        univerAPI,
        data.unitId,
        id,
        data.access,
        publish,
        readonly,
        publishConnection,
      );
      controller.current = save;
    })().catch((error) => {
      publishConnection('offline');
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
  }, [id]);
  return (
    <section className="sheet-editor" aria-label="Doc document">
      <Collaborators people={people} />
      <div className="save-status" role="status" aria-label="Save status" aria-live="polite">
        <span className="save-message">{status.message}</span>
        <span className="save-retry">
          {status.failed && status.dirty && (
            <button onClick={() => controller.current?.retry()}>Retry saving</button>
          )}
        </span>
      </div>
      {uploadError && <p role="alert">{uploadError} Try inserting the file again.</p>}
      {!guestItemId() && (
        <>
          <VersionNames
            id={id}
            saved={!status.dirty && !status.failed && Boolean(controller.current)}
          />
          <FileExports
            id={id}
            name={name}
            saved={!status.dirty && !status.failed && Boolean(controller.current)}
            print={async () => {
              if (!print.current) throw new Error('Wait for the document to load.');
              await print.current();
            }}
          />
        </>
      )}
      {Boolean(controller.current) && (
        <details className="doc-formulas">
          <summary>Formulas{formulaStates.length ? ` (${formulaStates.length})` : ''}</summary>
          {editable && (
            <button
              onClick={() => {
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
              }}
            >
              Insert formula
            </button>
          )}
          {formulaError && <p role="alert">{formulaError}</p>}
          {!formulaStates.length && (
            <p>Use a spreadsheet cell, range, or calculation in this Doc.</p>
          )}
          <ul>
            {formulaStates.map(({ formula, result }) => (
              <li key={formula.id}>
                {editable ? (
                  <button onClick={() => setFormulaEdit({ formula })}>
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
            <button onClick={() => void formulas.current?.resume()}>Refresh formulas</button>
          )}
        </details>
      )}
      {formulaEdit && editable && (
        <FormulaDialog
          id={id}
          initial={formulaEdit.formula}
          onClose={() => {
            setFormulaEdit(null);
            // Wait for dialog cleanup before returning keyboard input to the native document.
            requestAnimationFrame(() => formulas.current?.focus());
          }}
          onSave={async (definition: FormulaDefinition) => {
            if (!formulas.current || !canEditFormulas.current)
              throw new Error('This document is read-only.');
            if (
              !(await formulas.current.insert(
                definition,
                formulaEdit.selection,
                formulaEdit.formula?.id,
              ))
            )
              throw new Error('The formula could not be inserted.');
          }}
        />
      )}
      {editable && <p className="editor-help">Click the page to write. Type / for commands.</p>}
      <div className="univer-container" ref={container} />
    </section>
  );
}
