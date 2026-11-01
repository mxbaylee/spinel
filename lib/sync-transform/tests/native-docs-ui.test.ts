import {
  getDocsEmptySnapshot,
  ICommandService,
  IConfigService,
  IUndoRedoService,
  JSONX,
  LocaleType,
  TextX,
  Univer,
} from '@univerjs/core';
import type { DocumentDataModel } from '@univerjs/core';
import {
  DocStateChangeManagerService,
  DocStateEmitService,
  IDocStateChangeInterceptorService,
  RichTextEditingMutation,
  UniverDocsPlugin,
} from '@univerjs/docs';
import type { IDocStateChangeInfo, IRichTextEditingMutationParams } from '@univerjs/docs';
import {
  DocIMEInputManagerService,
  UniverDocsMobileUIPlugin,
  UniverDocsUIPlugin,
} from '@univerjs/docs-ui';
import { IRenderManagerService, UniverRenderEnginePlugin } from '@univerjs/engine-render';
import type { IRenderContext } from '@univerjs/engine-render';
import { IShortcutService } from '@univerjs/ui';
import { afterEach, expect, test, vi } from 'vitest';
import { installNativeDocCompatibility } from '../src/native-docs.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each(['desktop', 'mobile'] as const)(
  '%s DocsUI keeps its native IME provider, composition, selections and layout history',
  (mode) => {
    const univer = new Univer({ locale: LocaleType.EN_US });
    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverDocsPlugin);
    const injector = univer.__getInjector();
    const renderManager = injector.get(IRenderManagerService);
    // Construct the real public DocsUI plugin, which registers its native IME
    // interceptor in the same constructor used by registerPlugin. This headless
    // DI regression supplies the keyboard registration host; browser smoke owns
    // actual DOM/canvas rendering and event delivery.
    const keyboard = { registerShortcut: () => ({ dispose() {} }) } as unknown as IShortcutService;
    injector.add([IShortcutService, { useValue: keyboard }]);
    const UIPlugin = mode === 'desktop' ? UniverDocsUIPlugin : UniverDocsMobileUIPlugin;
    const plugin = new UIPlugin(
      {},
      injector,
      renderManager,
      injector.get(ICommandService),
      injector.get(IConfigService),
    );
    const original = injector.get(IDocStateChangeInterceptorService);
    const transform = vi.spyOn(original, 'transformChangeStateInfo');
    const policy = installNativeDocCompatibility(univer);
    expect(installNativeDocCompatibility(univer)).toBe(policy);
    expect(injector.get(IDocStateChangeInterceptorService)).toBe(original);
    const manager = injector.get(DocStateChangeManagerService);
    expect(manager).toBeInstanceOf(DocStateChangeManagerService);
    const emit = injector.get(DocStateEmitService);
    const ime = new DocIMEInputManagerService({} as IRenderContext<DocumentDataModel>);
    const render = {
      with(service: unknown) {
        expect(service).toBe(DocIMEInputManagerService);
        return ime;
      },
    } as unknown as NonNullable<ReturnType<IRenderManagerService['getRenderUnitById']>>;
    vi.spyOn(renderManager, 'getRenderUnitById').mockImplementation((id) =>
      id === 'composition' ? render : null,
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const snapshot = getDocsEmptySnapshot('composition');
      const first = JSONX.getInstance().editOp(
        new TextX().insert(1, { dataStream: 'n' }).serialize(),
      );
      const second = JSONX.getInstance().editOp(
        new TextX().delete(1).insert(1, { dataStream: '漢' }).serialize(),
      );
      const afterFirst = JSONX.apply(
        structuredClone(snapshot),
        structuredClone(first),
      ) as unknown as typeof snapshot;
      const undoFirst = JSONX.invertWithDoc(structuredClone(first), snapshot);
      const undoSecond = JSONX.invertWithDoc(structuredClone(second), afterFirst);
      const beforeLayout = { caret: 'before composition' };
      const afterLayout = { caret: 'after composition' };
      const oldSelection = [{ startOffset: 0, endOffset: 0, collapsed: true, segmentId: '' }];
      const newSelection = [{ startOffset: 1, endOffset: 1, collapsed: true, segmentId: '' }];
      const params = (
        actions: IRichTextEditingMutationParams['actions'],
        layoutState: unknown,
      ): IRichTextEditingMutationParams => ({
        unitId: 'composition',
        actions,
        textRanges: newSelection,
        layoutState,
        options: { preserve: true },
        isEditing: false,
      });
      ime.setActiveRange(oldSelection[0]);
      ime.setPreviousDocRanges(oldSelection);
      ime.setPreviousSelectionOptions({ wholeDocument: true });
      ime.pushUndoRedoMutationParams(
        params(undoFirst, beforeLayout),
        params(first, { caret: 'candidate' }),
      );
      ime.pushUndoRedoMutationParams(
        params(undoSecond, { caret: 'candidate' }),
        params(second, afterLayout),
      );
      const state: IDocStateChangeInfo = {
        commandId: RichTextEditingMutation.id,
        unitId: 'composition',
        trigger: 'doc.command.ime-input',
        segmentId: '',
        isCompositionEnd: true,
        debounce: true,
        redoState: { actions: second, textRanges: null },
        undoState: { actions: undoSecond, textRanges: null },
      };
      emit.emitStateChangeInfo(state);
      expect(transform).toHaveBeenCalledExactlyOnceWith(state);
      const cached = manager.getStateCache('composition').history[0];
      expect(cached.redoState).toMatchObject({
        layoutState: afterLayout,
        textRanges: newSelection,
        options: { preserve: true },
        isEditing: false,
      });
      expect(cached.undoState).toMatchObject({
        layoutState: beforeLayout,
        textRanges: oldSelection,
        options: { wholeDocument: true },
      });
      const after = JSONX.apply(
        structuredClone(snapshot),
        structuredClone(cached.redoState.actions),
      ) as unknown as typeof snapshot;
      expect(after.body!.dataStream).toBe('漢\r\n');
      const restored = JSONX.apply(
        after,
        structuredClone(cached.undoState.actions),
      ) as unknown as typeof snapshot;
      expect(restored.body!.dataStream).toBe(snapshot.body!.dataStream);
      expect(restored.body!.paragraphs).toEqual(snapshot.body!.paragraphs);
      manager.flushPendingChanges('composition');
      expect(injector.get(IUndoRedoService).getUndoRedoStatus('composition')).toEqual({
        undos: 1,
        redos: 0,
      });

      // The native manager falls back to its original state if the UI provider
      // has no render/IME session. The composed service must retain that rule.
      const withoutRender = { ...state, unitId: 'unrendered' };
      emit.emitStateChangeInfo(withoutRender);
      expect(transform).toHaveLastReturnedWith(null);
      expect(manager.getStateCache('unrendered').history[0].redoState.actions).toEqual(second);
    } finally {
      ime.dispose();
      plugin.dispose();
      univer.dispose();
    }
  },
);
