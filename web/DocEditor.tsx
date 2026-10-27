import { SaveStatus } from './SaveStatus.tsx';
import { recordNativeMutationInventory } from './nativeMutationInventory.ts';
import {
  installDocFormulas,
  FormulaSaveError,
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
  FormulaReadout,
  formulaRequest,
  formulaPaperColors,
  type FormulaTransport,
} from './DocFormulas.tsx';
import { documentPath } from './documentAccess.ts';
import type { OfflineSession } from './offline/OfflineSession.ts';
import { EditorTools } from './EditorTools.tsx';
import { useEditorChrome } from './EditorFrame.tsx';
import { editorTheme, bindEditorTheme, installCanvasColors } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import {
  DocSelectionManagerService,
  DocSkeletonManagerService,
  RichTextEditingMutation,
  setDocumentPermissionValue,
} from '@univerjs/docs';
import { UnitAction } from '@univerjs/protocol';
import {
  calcDocRangePositions,
  DocBackScrollRenderController,
  DocSelectionRenderService,
} from '@univerjs/docs-ui';
import { watchPresence } from './Collaborators.tsx';
import type { Collaborator } from './Collaborators.tsx';
import { useEffect, useRef, useState } from 'react';
import {
  IPermissionService,
  IContextService,
  IUniverInstanceService,
  FOCUSING_DOC,
  FOCUSING_UNIVER_EDITOR,
  FOCUSING_COMMON_DRAWINGS,
  EDITOR_ACTIVATED,
  FOCUSING_FX_BAR_EDITOR,
  IImageIoService,
  IURLImageService,
  ImageSourceType,
  ImageUploadStatusType,
  ICommandService,
  Inject,
  Injector,
  Plugin,
  UniverInstanceType,
  DocumentFlavor,
} from '@univerjs/core';
import { ImageIoService } from '@univerjs/drawing';
import {
  UniverDrawingPlugin,
  UniverDrawingUIPlugin,
  UniverDrawingMobileUIPlugin,
  UniverDocsDrawingPlugin,
  UniverDocsDrawingUIPlugin,
  UniverDocsDrawingMobileUIPlugin,
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
import { BuiltInUIPart, IRenderManagerService } from '@univerjs/preset-docs-core';
import { IContextMenuService } from '@univerjs/ui';
import { docPreset, mobileDocPlugins, useMobileDocControls } from './docPreset.ts';
import { guardPhoneDocInput } from './docPhoneView.ts';
import enUS from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import '@univerjs/ui/facade';
import {
  prepareEditor,
  identifyCollaborator,
  watchCollaboration,
  loadSpinelDocument,
  disposeSpinelSync,
} from './collaboration.ts';
import type { SaveState } from '../src/shared/autosave.ts';
import { editorReady } from './editorReady.ts';
import { documentReady } from './documentReady.ts';
import type { ConnectionState } from './connectionState.ts';
import { guestPendingBuffer } from './guestPendingBuffer.ts';
import type { RegisterGuestEditor } from './guestRevocation.ts';
import { nativeSyncPermissions } from './nativeSyncPermissions.ts';
import { observeDocResponsiveness } from './docResponsivenessEvidence.ts';

export function DocEditor({
  id,
  name,
  spaceId,
  onDirty,
  registerGuestEditor,
  onConnectionState,
  saveStatusTarget,
  localAccountId,
}: {
  id: string;
  name: string;
  spaceId?: string;
  saveStatusTarget: HTMLElement | null;
  onDirty: (dirty: boolean, retained?: boolean) => void;
  registerGuestEditor?: RegisterGuestEditor;
  onConnectionState?: (state: ConnectionState | null) => void;
  localAccountId?: string;
}) {
  const chrome = useEditorChrome();
  // Rotation or a keyboard resize must not remount an editor with pending edits.
  const [mobile] = useState(useMobileDocControls);
  const [phoneReady, setPhoneReady] = useState(false);
  const [phoneReadOnly, setPhoneReadOnly] = useState(false);
  const [phoneLayoutChanged, setPhoneLayoutChanged] = useState(false);
  const formulas = useRef<DocFormulaController | null>(null);
  const formulaTransport = useRef<FormulaTransport | undefined>(undefined);
  const [formulaStates, setFormulaStates] = useState<FormulaState[]>([]);
  const [formulaError, setFormulaError] = useState('');
  const [formulaEdit, setFormulaEdit] = useState<{
    formula?: DocFormula;
    selection?: DocFormulaSelection;
  } | null>(null);
  const formulaDraftOpen = useRef(false);
  const formulaDraftChanged = useRef<(() => void) | undefined>(undefined);
  const [formulaOnline, setFormulaOnline] = useState(false);
  const editFormula = (value: typeof formulaEdit) => {
    formulaDraftOpen.current = Boolean(value);
    setFormulaEdit(value);
    formulaDraftChanged.current?.();
  };
  const canEditFormulas = useRef(false);
  const [uploadError, setUploadError] = useState('');
  const [editable, setEditable] = useState(false);
  const [preserveFormulaInput, setPreserveFormulaInput] = useState(false);
  const [unfinishedText, setUnfinishedText] = useState<string | null>(null);
  const discardUnfinishedText = useRef<(() => void) | undefined>(undefined);
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
    let offlineSession: OfflineSession | undefined;
    let initialized = false;
    let captureReady = false;
    const room = `${spaceId ?? ''}/${id}`;
    if (lastRoom.current !== room) syncNotice.current = undefined;
    lastRoom.current = room;
    onConnectionState?.('reconnecting');
    let lastConnection: ConnectionState = 'reconnecting';
    const publishConnection = (state: ConnectionState) => {
      if (disposed) return;
      setFormulaOnline(state === 'online');
      if (state !== 'online' && lastConnection === 'online') formulas.current?.clear();
      else if (state === 'online' && lastConnection !== 'online') void formulas.current?.refresh();
      lastConnection = state;
      onConnectionState?.(state);
    };
    const loading = new AbortController();
    let stopPresence: (() => void) | undefined;
    let formulaInterval: ReturnType<typeof setInterval> | undefined;
    let stopFormulaVisibility: (() => void) | undefined;
    let stopSelectionEvidence: (() => void) | undefined;
    let stopDocumentLayout: (() => void) | undefined;
    let responsivenessEvidence: ReturnType<typeof observeDocResponsiveness> | undefined;
    let phoneInput: ReturnType<typeof guardPhoneDocInput> | undefined;
    let phoneInputLocked = false;
    let phoneOnlyMessage: string | undefined;
    setFormulaStates([]);
    editFormula(null);
    setPreserveFormulaInput(false);
    setUnfinishedText(null);
    setFormulaError('');
    setPeople([]);
    setPhoneReadOnly(false);
    setPhoneLayoutChanged(false);
    setPhoneReady(false);
    let uploads = 0;
    let insertions = 0;
    let composing = false;
    let compositionText = '';
    let heldComposition = false;
    let inputFrozen = false;
    let finishReadonly: (() => void) | undefined;
    let uploaded = 0;
    let disposeEditor: (() => void) | undefined;
    let save: ReturnType<typeof watchCollaboration> | undefined;
    let lastState: SaveState = { dirty: false, failed: false, message: 'Loading document…' };
    const publish = (state: SaveState) => {
      lastState = state;
      if (disposed) return;
      const busy =
        uploads > 0 || insertions > 0 || composing || heldComposition || formulaDraftOpen.current;
      const dirty = busy || state.dirty;
      if (dirty && initialized) syncNotice.current = undefined;
      onDirty(dirty, Boolean(state.retained));
      setStatus({
        ...state,
        ...(busy ? { local: undefined } : {}),
        dirty,
        failed: state.failed || (initialized && Boolean(syncNotice.current)),
        message: heldComposition
          ? state.signInRequired
            ? 'Your sign-in ended. Copy the unfinished text before signing in again.'
            : 'Copy the unfinished text before recovering your offline changes.'
          : formulaDraftOpen.current
            ? 'Editing formula — changes not saved yet.'
            : composing
              ? 'Editing text — changes not saved yet.'
              : busy
                ? 'Inserting image — keep this tab open.'
                : state.failed
                  ? state.message
                  : ((initialized ? syncNotice.current : undefined) ??
                    // Keep explicit device durability and attention announcements.
                    // The phone layout fallback remains visible in the help text.
                    (initialized && !dirty && !state.local && phoneOnlyMessage
                      ? phoneOnlyMessage
                      : state.message)),
      });
    };
    formulaDraftChanged.current = () => publish(lastState);
    const editorElement = container.current;
    const compositionStart = () => {
      if (disposed || inputFrozen) return;
      composing = true;
      compositionText = '';
      publish(lastState);
    };
    const compositionUpdate = (event: CompositionEvent) => {
      if (!composing || disposed) return;
      compositionText = event.data;
      if (heldComposition) setUnfinishedText(compositionText);
    };
    const compositionEnd = (event: CompositionEvent) => {
      if (disposed || !composing) return;
      // Refused native capture may reject a final IME update. Preserve its text
      // before the native handler: that handler can itself start the hold.
      compositionText = event.data || compositionText;
      if (heldComposition) setUnfinishedText(compositionText);
      // Let the native composition-end handler capture its edit first.
      queueMicrotask(() => {
        if (disposed) return;
        composing = false;
        publish(lastState);
        const freeze = finishReadonly;
        finishReadonly = undefined;
        freeze?.();
      });
    };
    discardUnfinishedText.current = () => {
      if (disposed || !heldComposition) return;
      heldComposition = false;
      composing = false;
      compositionText = '';
      setUnfinishedText(null);
      const freeze = finishReadonly;
      finishReadonly = undefined;
      freeze?.();
      publish(lastState);
    };
    editorElement?.addEventListener('compositionstart', compositionStart, true);
    editorElement?.addEventListener('compositionupdate', compositionUpdate, true);
    editorElement?.addEventListener('compositionend', compositionEnd, true);
    publish(lastState);
    void (async () => {
      const data = await prepareEditor(id, spaceId, () => !disposed, localAccountId);
      offlineSession = data.offline;
      if (disposed) {
        offlineSession?.dispose();
        return;
      }
      if (data.offline) {
        const verify = () => {
          data.offline!.verifyRemote();
          if (data.offline!.enabled && !data.offline!.online)
            throw new FormulaSaveError('unavailable');
        };
        formulaTransport.current = {
          verify,
          fetch: (url, init) => {
            verify();
            return data.offline!.fetch(url, init);
          },
        };
      } else formulaTransport.current = undefined;
      const nativePermissions = nativeSyncPermissions(data.unitId, data.access);
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
            if (data.offline?.enabled && !data.offline.online)
              throw new Error(
                'Connect before inserting a new image. Existing images remain available offline.',
              );
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
              throw new Error('Choose a PNG, JPEG or WebP image.');
            const response = await (data.offline?.fetch.bind(data.offline) ?? fetch)(
              `${documentPath(id, spaceId)}/images`,
              {
                method: 'POST',
                headers: { 'Content-Type': file.type },
                body: file,
                signal: AbortSignal.timeout(30_000),
              },
            );
            const image = await response.json();
            data.offline?.verifyRemote();
            if (!response.ok) throw new Error(image.error ?? 'Image upload failed.');
            await data.offline?.prepareImages(image.url);
            data.offline?.verifyRemote();
            uploaded++;
            return {
              imageId: crypto.randomUUID(),
              imageSourceType: ImageSourceType.URL,
              source: data.offline?.toVisible(image.url) ?? (image.url as string),
              base64Cache: data.offline?.toVisible(image.url) ?? (image.url as string),
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
          [LocaleType.EN_US]: mergeLocales(enUS, drawingEnUS, linkEnUS),
        },
        override: [...nativePermissions.override, [IImageIoService, { useClass: StoredImages }]],
        plugins: [
          [
            UniverDrawingPlugin,
            {
              override: [
                [IImageIoService, { useClass: StoredImages }],
                ...(data.offline ? [[IURLImageService, { useValue: data.offline }]] : []),
              ],
              allowImageSize: 5 * 1024 * 1024,
            },
          ],
          mobile ? UniverDrawingMobileUIPlugin : UniverDrawingUIPlugin,
          UniverDocsDrawingPlugin,
          mobile ? UniverDocsDrawingMobileUIPlugin : UniverDocsDrawingUIPlugin,
          TrackedImageInsertion,
        ],
        presets: [
          docPreset(
            container.current!,
            mobile,
            data.access === 'viewer',
            Object.fromEntries(
              [
                DOCS_SHAPE_MENU_ID,
                DOCS_SHAPE_BELOW_MENU_ID,
                InsertDocRectangleShapeCommand.id,
                InsertDocEllipseShapeCommand.id,
                `${InsertDocRectangleShapeCommand.id}.below`,
                `${InsertDocEllipseShapeCommand.id}.below`,
              ].map((id) => [id, { hidden: true }]),
            ),
          ),
          mobileDocPlugins(UniverDocsHyperLinkPreset(), mobile),
        ],
      });
      const stopTheme = bindEditorTheme(univer);
      disposeEditor = () => {
        responsivenessEvidence?.dispose();
        responsivenessEvidence = undefined;
        stopSelectionEvidence?.();
        stopSelectionEvidence = undefined;
        stopDocumentLayout?.();
        stopDocumentLayout = undefined;
        phoneInput?.dispose();
        phoneInput = undefined;
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
      const readonly = async (
        preserveInput = false,
        options: { holdComposition?: boolean } = {},
      ) => {
        if (disposed) return;
        inputFrozen = true;
        canEditFormulas.current = false;
        setPreserveFormulaInput(preserveInput);
        if (!preserveInput) editFormula(null);
        formulas.current?.clear();
        setEditable(false);
        if (preserveInput && composing) {
          // Recovery may refuse the final native edit, so retain its text by
          // default. A phone-only layout fence lets that edit finish normally;
          // it must never clear a hold already established by recovery.
          if (options.holdComposition !== false) {
            heldComposition = true;
            setUnfinishedText(compositionText);
            publish(lastState);
          }
          finishReadonly = () => {
            if (!disposed) void readonly(true, options);
          };
          return;
        }
        finishReadonly = undefined;
        // Preserve native composition before the phone keyboard/focus fence
        // exits editing, just as before the document permission is frozen.
        phoneInputLocked = true;
        nativePermissions.readonly();
        phoneInput?.stopEditing();
        if (mobile)
          univerAPI
            .setUIVisible(BuiltInUIPart.HEADER, false)
            .setUIVisible(BuiltInUIPart.FOOTER, false)
            .setUIVisible(BuiltInUIPart.TOOLBAR, false);
        // Local UI state only: changing the shared document's permission rules
        // would also make still-authorized collaborators read-only.
        const permissions = univer.__getInjector().get(IPermissionService);
        setDocumentPermissionValue(permissions, data.unitId, data.unitId, UnitAction.Edit, false);
        setDocumentPermissionValue(permissions, data.unitId, data.unitId, UnitAction.Copy, true);
      };
      await loadSpinelDocument({
        univer,
        unitId: data.unitId,
        itemId: id,
        spaceId,
        access: data.access,
        kind: 'doc',
        signal: loading.signal,
        isCurrent: () => !disposed,
        offline: data.offline,
        canRefresh: () =>
          uploads === 0 &&
          insertions === 0 &&
          !composing &&
          !heldComposition &&
          !formulaDraftOpen.current,
        lock: () => {
          heldComposition = false;
          composing = false;
          compositionText = '';
          finishReadonly = undefined;
          inputFrozen = true;
          setUnfinishedText(null);
          setPreserveFormulaInput(false);
          editFormula(null);
          publish({
            dirty: false,
            failed: true,
            local: 'attention',
            message: 'Offline access changed on this device. Reopen the document to continue.',
          });
          // Retire queued native composition callbacks before destroying Univer.
          disposed = true;
          loading.abort();
          canEditFormulas.current = false;
          clearInterval(formulaInterval);
          stopFormulaVisibility?.();
          formulas.current?.dispose();
          formulas.current = null;
          formulaTransport.current = undefined;
          setFormulaStates([]);
          stopPresence?.();
          setPeople([]);
          save?.dispose();
          controller.current = null;
          disposeEditor?.();
          disposeEditor = undefined;
          setEditable(false);
        },
        initializeAccess: () => (data.access === 'viewer' ? readonly() : undefined),
        onInitialPending: () =>
          publish({
            dirty: true,
            failed: false,
            message: 'Changes not saved yet — keep this tab open.',
          }),
        reload: (_reason, clean) => {
          if (disposed) return;
          initialized = false;
          syncNotice.current = clean
            ? undefined
            : 'The document was reloaded after a synchronization problem. Edits the server did not accept were discarded.';
          publish({
            dirty: false,
            failed: !clean,
            message: clean
              ? 'Loading the current saved document…'
              : 'Reloading after a synchronization problem…',
          });
          reload((generation) => generation + 1);
        },
      });
      captureReady = true;
      const document = univerAPI.getActiveDocument();
      if (!document) throw new Error('Could not load this document.');
      await editorReady(univerAPI);
      // A document-type plugin can initialize after the global Rendered stage.
      // Do not advertise readiness until our drawing commands are installed too.
      await drawingsRendered;
      if (disposed) return;
      await documentReady(univer, data.unitId, loading.signal);
      if (disposed) return;
      const render = univer
        .__getInjector()
        .get(IRenderManagerService)
        .getRenderUnitById(data.unitId);
      if (import.meta.env.VITE_DOC_RESPONSIVENESS_EVIDENCE === '1')
        responsivenessEvidence = observeDocResponsiveness(univer, data.unitId, mobile);
      render?.engine.getCanvasElement().setAttribute('aria-label', 'Document canvas');
      if (mobile && render)
        phoneInput = guardPhoneDocInput(
          render,
          univer.__getInjector().get(IContextMenuService),
          () => phoneInputLocked,
        );
      if (
        render &&
        ((mobile && import.meta.env.VITE_SYNC_EVIDENCE === '1') ||
          import.meta.env.VITE_DOC_SELECTION_EVIDENCE === '1')
      ) {
        // Evidence builds expose a read-only snapshot of the public native
        // caret after real input; they cannot alter the range or document.
        const selection = render.with(DocSelectionRenderService);
        const injector = univer.__getInjector();
        const logicalSelection = injector.get(DocSelectionManagerService);
        const units = injector.get(IUniverInstanceService);
        const contexts = injector.get(IContextService);
        const rangeEvidence = (
          range:
            | ReturnType<typeof selection.getActiveTextRange>
            | ReturnType<typeof logicalSelection.getActiveTextRange>,
        ) =>
          range
            ? {
                start: range.startOffset,
                end: range.endOffset,
                collapsed: range.collapsed,
                segmentId: range.segmentId,
                segmentPage: range.segmentPage,
              }
            : null;
        const commands: Array<{
          at: number;
          id: string;
          unitId?: string;
          direction?: number;
          granularity?: string;
          zoomRatio?: number;
        }> = [];
        const relevantCommands = new Set([
          'doc.operation.move-cursor',
          'doc.operation.set-selections',
          'doc.operation.set-zoom-ratio',
        ]);
        const stopCommands = injector.get(ICommandService).onCommandExecuted((command) => {
          if (!relevantCommands.has(command.id)) return;
          const params = command.params as
            | { unitId?: string; direction?: number; granularity?: string; zoomRatio?: number }
            | undefined;
          commands.push({
            at: performance.now(),
            id: command.id,
            unitId: params?.unitId,
            direction: params?.direction,
            granularity: params?.granularity,
            zoomRatio: params?.zoomRatio,
          });
          if (commands.length > 20) commands.shift();
        });
        const observeSelection = () => {
          const range = selection.getActiveTextRange();
          const logical = logicalSelection.getSelectionInfo({
            unitId: data.unitId,
            subUnitId: data.unitId,
          });
          const start = range?.startOffset;
          const end = range?.endOffset;
          const anchor = range?.getAnchor();
          const viewport = selection.activeViewPort;
          const skeleton = render.with(DocSkeletonManagerService).getSkeleton();
          const progress = skeleton.getLayoutProgress();
          window.dispatchEvent(
            new CustomEvent('spinel-doc-selection-evidence', {
              detail: {
                unitId: data.unitId,
                mobile,
                observedAt: performance.now(),
                currentUnitId: units
                  .getCurrentUnitOfType(UniverInstanceType.UNIVER_DOC)
                  ?.getUnitId(),
                currentLogicalRange: rangeEvidence(logicalSelection.getActiveTextRange()),
                unitLogicalRanges:
                  logicalSelection
                    .getTextRanges({ unitId: data.unitId, subUnitId: data.unitId })
                    ?.map(rangeEvidence) ?? null,
                unitSelectionOptions: logical?.options ? { ...logical.options } : null,
                unitSelectionStyles:
                  logical?.textRanges.map(({ style }) => ({
                    stroke: style?.strokeActive,
                    fill: style?.fill,
                  })) ?? null,
                nativeRange: rangeEvidence(range),
                start,
                end,
                hasAnchor: Boolean(anchor),
                anchor: anchor
                  ? {
                      visible: anchor.visible,
                      left: anchor.left,
                      top: anchor.top,
                      width: anchor.width,
                      height: anchor.height,
                    }
                  : null,
                inputConnected: selection.inputElement.isConnected,
                inputFocused: selection.isFocusing,
                pointerSelection: selection.isOnPointerEvent,
                pendingSelection: selection.hasPendingSelection,
                shortcutContext: {
                  doc: contexts.getContextValue(FOCUSING_DOC),
                  editor: contexts.getContextValue(FOCUSING_UNIVER_EDITOR),
                  drawing: contexts.getContextValue(FOCUSING_COMMON_DRAWINGS),
                  activated: contexts.getContextValue(EDITOR_ACTIVATED),
                  formulaBar: contexts.getContextValue(FOCUSING_FX_BAR_EDITOR),
                },
                viewport: viewport
                  ? {
                      key: viewport.viewportKey,
                      active: viewport.isActive,
                      width: viewport.width,
                      height: viewport.height,
                      scrollX: viewport.viewportScrollX,
                      scrollY: viewport.viewportScrollY,
                      bounds: viewport.calcViewportInfo().viewBound,
                    }
                  : null,
                scale: { x: render.scene.scaleX, y: render.scene.scaleY },
                layout: {
                  viewportReady: render.with(DocBackScrollRenderController).isViewportReady(),
                  firstNode: skeleton.findNodePositionByCharIndex(0) ?? null,
                  progress: progress
                    ? {
                        reason: progress.reason,
                        anchorReady: progress.anchorReady,
                        complete: progress.complete,
                        cancelled: progress.cancelled,
                      }
                    : null,
                },
                commands: [...commands],
                editing: selection.isEditing,
                bounds:
                  start !== undefined && end !== undefined
                    ? calcDocRangePositions(
                        {
                          startOffset: start,
                          endOffset: end,
                          collapsed: start === end,
                          segmentId: range!.segmentId,
                          segmentPage: range!.segmentPage,
                        },
                        render,
                      )?.[0]
                    : undefined,
                scroll: render.scene.getViewport('viewMain')?.viewportScrollY ?? 0,
                text: document.getDocumentDataModel().getSnapshot().body?.dataStream,
              },
            }),
          );
        };
        window.addEventListener('spinel-doc-selection-read', observeSelection);
        stopSelectionEvidence = () => {
          window.removeEventListener('spinel-doc-selection-read', observeSelection);
          stopCommands.dispose();
        };
      }
      // Modern Docs reflow through device-local layout options. Paginated Docs
      // only scale to fit, so retain their original layout and use the ticket's
      // read-only phone fallback instead of rewriting shared page geometry.
      const model = document.getDocumentDataModel();
      const initialFlavor = model.getSnapshot().documentStyle?.documentFlavor;
      const deviceReadOnly = mobile && initialFlavor !== DocumentFlavor.MODERN;
      setPhoneReadOnly(deviceReadOnly);
      if (deviceReadOnly) phoneOnlyMessage = 'View only on this phone. Edit on a larger screen.';
      let layoutChanged = false;
      if (mobile) {
        const layout = univer
          .__getInjector()
          .get(ICommandService)
          .onCommandExecuted((command) => {
            if (
              command.id !== RichTextEditingMutation.id ||
              (command.params as { unitId?: string } | undefined)?.unitId !== data.unitId ||
              disposed ||
              layoutChanged ||
              model.getSnapshot().documentStyle?.documentFlavor === initialFlavor
            )
              return;
            // Native gesture/resize controllers depend on the initial page mode.
            // Retain the unit and its pending queue, but require reopening before
            // further local edits if a peer changes that mode. Never change the
            // shared snapshot or the server-authorized grant to fit this device.
            layoutChanged = true;
            setPhoneLayoutChanged(true);
            phoneOnlyMessage = 'View only on this phone. Reopen after the page layout change.';
            // A local presentation fence must retain an unfinished Formula
            // draft and let active native composition capture before freezing.
            void readonly(true, { holdComposition: false }).then(
              () => publish(lastState),
              (error) =>
                publish({
                  ...lastState,
                  failed: true,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'Could not update document access. Reload to try again.',
                }),
            );
          });
        stopDocumentLayout = () => layout.dispose();
      }
      // Apply the fence before loading Formula code, which can wait on network.
      if (data.access === 'viewer' || deviceReadOnly) await readonly();
      const installedFormulas = await installDocFormulas({
        univer,
        unitId: data.unitId,
        colors: formulaPaperColors,
        evaluate: (definition, signal) => {
          if (data.offline?.enabled && !data.offline.online)
            return Promise.resolve({ ok: false as const, reason: 'unavailable' as const });
          return formulaRequest<FormulaResult>(
            id,
            'evaluate',
            { definition },
            signal,
            spaceId,
            undefined,
            formulaTransport.current,
          );
        },
        onActivate: (formula) => {
          if (canEditFormulas.current) editFormula({ formula });
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
      if (data.access !== 'viewer' && !deviceReadOnly && !layoutChanged) {
        canEditFormulas.current = true;
        setEditable(true);
        if (!mobile) document.setSelection(0, 0);
      }
      stopPresence = await watchPresence(univer, univerAPI, data.unitId, setPeople);
      if (disposed) {
        stopPresence();
        return;
      }
      initialized = true;
      save = watchCollaboration(univer, publish, readonly, publishConnection);
      controller.current = save;
      setPhoneReady(true);
    })().catch((error) => {
      // Failed checkpoint/SDK initialization must not leave a writable canvas
      // without native capture. A bound client may already own pending input.
      if (!captureReady) {
        disposeEditor?.();
        disposeEditor = undefined;
        offlineSession?.dispose();
      }
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
      discardUnfinishedText.current = undefined;
      formulaDraftChanged.current = undefined;
      editorElement?.removeEventListener('compositionstart', compositionStart, true);
      editorElement?.removeEventListener('compositionupdate', compositionUpdate, true);
      editorElement?.removeEventListener('compositionend', compositionEnd, true);
      registerGuestEditor?.(null);
      canEditFormulas.current = false;
      clearInterval(formulaInterval);
      stopFormulaVisibility?.();
      formulas.current?.dispose();
      formulas.current = null;
      formulaTransport.current = undefined;
      loading.abort();
      stopPresence?.();
      save?.dispose();
      // Univer owns a separate React root; unmount it after our cleanup commit.
      if (disposeEditor) queueMicrotask(disposeEditor);
      offlineSession?.dispose();
      controller.current = null;
      setEditable(false);
      onDirty(false);
      onConnectionState?.(null);
    };
    // Name is folder metadata; a rename must not recreate an editor with pending edits.
  }, [id, spaceId, reloadGeneration]);
  return (
    <section className="sheet-editor" aria-label="Doc document" data-mobile={mobile}>
      <SaveStatus
        state={status}
        target={chrome?.saveTarget ?? saveStatusTarget}
        onRetry={() => controller.current?.retry()}
        onRecover={() => controller.current?.recover()}
        onExportRecovery={() => controller.current?.exportRecovery()}
        onDiscardRecovery={() => controller.current?.discardRecovery()}
        unfinishedText={
          unfinishedText === null
            ? undefined
            : {
                value: unfinishedText,
                onDiscard: () => discardUnfinishedText.current?.(),
              }
        }
      />
      {!localAccountId && (
        <EditorTools
          id={id}
          name={name}
          spaceId={spaceId}
          people={people}
          saved={
            !status.dirty &&
            !status.failed &&
            (!status.local || status.local === 'synced') &&
            Boolean(controller.current)
          }
          insertFormula={
            editable
              ? () => {
                  try {
                    if (!formulas.current) throw new Error('Wait for the document to load.');
                    setFormulaError('');
                    editFormula({ selection: formulas.current.selection() });
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
                                editFormula({ formula });
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
      )}
      {localAccountId && <FormulaReadout states={formulaStates} target={chrome?.toolsTarget} />}
      {formulaEdit && (editable || preserveFormulaInput) && (
        <FormulaDialog
          id={id}
          spaceId={spaceId}
          initial={formulaEdit.formula}
          transport={formulaTransport.current}
          remoteAvailable={formulaOnline}
          onClose={() => {
            editFormula(null);
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
          : formulaError ||
            (phoneLayoutChanged
              ? 'This Doc’s page layout changed. Reopen it to continue.'
              : phoneReadOnly
                ? 'Edit on a larger screen. This Doc keeps its page layout.'
                : editable
                  ? mobile
                    ? 'Tap Edit, then tap the text to write.'
                    : 'Click the page to write. Type / for commands.'
                  : '')}
      </p>
      <div className="univer-container" ref={container} inert={mobile && !phoneReady} />
    </section>
  );
}
