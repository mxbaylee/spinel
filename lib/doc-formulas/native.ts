import {
  BooleanNumber,
  ICommandService,
  IUniverInstanceService,
  UniverInstanceType,
  type DocumentDataModel,
  type IDisposable,
  type ITextRange,
  type Univer,
} from '@univerjs/core';
import {
  DOC_INTERCEPTOR_POINT,
  DocInterceptorService,
  DocSelectionManagerService,
  DocSkeletonManagerService,
  InsertTextCommand,
  RichTextEditingMutation,
} from '@univerjs/docs';
import { DocEventManagerService, DocPrintInterceptorService } from '@univerjs/docs-ui';
import {
  IRenderManagerService,
  registerDocCustomGlyphRenderer,
  registerDocumentLayoutPresentation,
} from '@univerjs/engine-render';
import type { FormulaDefinition, FormulaResult } from './definition.ts';
import {
  docFormulas,
  formulaBody,
  formulaFromRange,
  formulaPresentationBody,
  FORMULA_FONT_FAMILY,
  type DocFormula,
} from './model.ts';
import {
  formulaGeometry,
  paintFormula,
  type FormulaDisplay,
  type FormulaPaintColors,
} from './rendering.ts';

export interface DocFormulaSelection extends ITextRange {
  revision: number;
}

export interface FormulaState {
  formula: DocFormula;
  result: FormulaDisplay;
}
export interface DocFormulaOptions {
  univer: Univer;
  unitId: string;
  evaluate: (definition: FormulaDefinition, signal: AbortSignal) => Promise<FormulaResult>;
  onActivate?: (formula: DocFormula) => void;
  onChange?: (states: FormulaState[]) => void;
  colors?: FormulaPaintColors;
}
// The SDK renderer registry is global. Each mounted document has a private scope, including previews.
const painters = new Map<string, (input: Parameters<typeof paintFormula>[0]) => void>();
let renderer: IDisposable | undefined;
let mounts = 0;

export function installDocFormulas(options: DocFormulaOptions) {
  const { univer, unitId } = options;
  const injector = univer.__getInjector();
  const document = injector
    .get(IUniverInstanceService)
    .getUnit<DocumentDataModel>(unitId, UniverInstanceType.UNIVER_DOC);
  const render = injector.get(IRenderManagerService).getRenderUnitById(unitId);
  if (!document || !render) throw new Error('Wait for the document to load.');
  const commands = injector.get(ICommandService);
  const selections = injector.get(DocSelectionManagerService);
  const skeleton = render.with(DocSkeletonManagerService);
  const scope = crypto.randomUUID();
  let disposed = false;
  let abort = new AbortController();
  let states: FormulaState[] = [];
  let refreshing: Promise<void> | undefined;
  let printPaused = false;
  const canvas = globalThis.document.createElement('canvas');
  const measureContext = canvas.getContext('2d');
  const measure = (text: string, at: number) => {
    if (!measureContext) return [...text].length * 0.6;
    const glyph = skeleton.getSkeleton().findNodeByCharIndex(at);
    const style =
      glyph?.ts ?? document.getBody()?.textRuns?.find((run) => run.st <= at && run.ed > at)?.ts;
    measureContext.font = `${style?.it === BooleanNumber.TRUE ? 'italic ' : ''}${style?.bl === BooleanNumber.TRUE ? 'bold ' : ''}100px "Atkinson Hyperlegible Next", sans-serif`;
    return measureContext.measureText(text).width / 100;
  };
  const fit = (result: FormulaResult, definition: FormulaDefinition, at: number): FormulaResult => {
    if (!result.ok) return result;
    const style = document.getDocumentStyle();
    const glyph = skeleton.getSkeleton().findNodeByCharIndex(at);
    const line = glyph?.parent?.parent;
    const column = line?.parent;
    const page = column?.parent?.parent;
    // Read the actual current layout: section sizes, table cells, headings, and page margins.
    const size =
      ((glyph?.fontStyle?.originFontSize ?? glyph?.ts?.fs ?? style.textStyle?.fs ?? 12) * 4) / 3;
    const dimensions = formulaGeometry(result, definition, (text) => measure(text, at));
    const width = column
      ? column.width - (line?.paragraphPaddingLeft ?? 0) - (line?.paragraphPaddingRight ?? 0)
      : (style.pageSize?.width ?? 595) - (style.marginLeft ?? 72) - (style.marginRight ?? 72);
    const height = page
      ? page.pageHeight - page.marginTop - page.marginBottom - (page.footnoteHeight ?? 0)
      : (style.pageSize?.height ?? 842) - (style.marginTop ?? 72) - (style.marginBottom ?? 72);
    return dimensions.width * size > width ||
      (dimensions.ascent + dimensions.descent) * size > height
      ? { ok: false, reason: 'too-large' }
      : result;
  };
  const geometry = (id: string) => {
    const state = states.find((entry) => entry.formula.id === id);
    if (!state) return null;
    return formulaGeometry(state.result, state.formula.definition, (text) =>
      measure(text, state.formula.start),
    );
  };
  renderer ??= registerDocCustomGlyphRenderer({
    fontFamily: FORMULA_FONT_FAMILY,
    renderer: (input) => {
      const paint = input.glyphKey ? painters.get(input.glyphKey) : undefined;
      if (!paint) return true; // Never fall back to painting an unauthorized cached value.
      paint(input);
      return true;
    },
  });
  mounts++;
  let presentation: IDisposable | undefined;
  const createPresentation = () =>
    registerDocumentLayoutPresentation(document, {
      getSnapshot: (snapshot) =>
        !docFormulas(snapshot.body).length
          ? snapshot
          : {
              ...snapshot,
              documentStyle: {
                ...snapshot.documentStyle,
                renderConfig: {
                  ...snapshot.documentStyle.renderConfig,
                  useCustomGlyphRenderer: BooleanNumber.TRUE,
                },
              },
              body: snapshot.body
                ? {
                    ...formulaPresentationBody(snapshot.body, scope),
                    // Modern Docs replace document-level render options during layout.
                    // Section options survive that normalization and reach the canvas.
                    sectionBreaks: skeleton
                      .getViewModel()
                      .getChildren()
                      .map((node) => {
                        const section = snapshot.body?.sectionBreaks?.find(
                          (entry) => entry.startIndex === node.endIndex,
                        );
                        return {
                          ...(section ?? {
                            startIndex: node.endIndex,
                            sectionId: `formula-section-${node.endIndex}`,
                          }),
                          renderConfig: {
                            ...snapshot.documentStyle.renderConfig,
                            ...section?.renderConfig,
                            useCustomGlyphRenderer: BooleanNumber.TRUE,
                          },
                        };
                      }),
                  }
                : undefined,
            },
      captureState: () => null,
      applyActions: () => {},
      restoreState: () => {},
    });
  const interceptor = render
    .with(DocInterceptorService)
    .intercept(DOC_INTERCEPTOR_POINT.CUSTOM_RANGE, {
      priority: 100,
      handler: (range, context, next) => {
        if (!range || !formulaFromRange(range, context.body)) return next(range);
        const dimensions = geometry(range.rangeId);
        return next({
          ...range,
          show: false,
          glyphWidthEm: dimensions?.width ?? 8,
          glyphAscentEm: dimensions?.ascent ?? 1,
          glyphDescentEm: dimensions?.descent ?? 0.25,
        });
      },
    });
  const repaint = () => {
    if (disposed) return;
    skeleton.getViewModel().reset(document);
    skeleton.getSkeleton().makeDirty(true);
    skeleton.recalculate();
    render.mainComponent?.makeDirty();
    options.onChange?.(states);
  };
  const installPainters = () => {
    for (const key of painters.keys()) if (key.startsWith(`${scope}:`)) painters.delete(key);
    for (const state of states)
      painters.set(`${scope}:${state.formula.id}`, (input) => {
        const dimensions = geometry(state.formula.id);
        if (dimensions) paintFormula(input, dimensions, !state.result.ok, options.colors);
      });
  };
  const evaluateAll = async () => {
    if (disposed) return;
    const formulas = docFormulas(document.getBody());
    if (!formulas.length && !states.length) return;
    if (formulas.length) presentation ??= createPresentation();
    else {
      presentation?.dispose();
      presentation = undefined;
    }
    abort.abort();
    abort = new AbortController();
    const signal = abort.signal;
    states = formulas.map((formula) => ({
      formula,
      result: { ok: false, reason: 'loading' },
    }));
    installPainters();
    repaint();
    // Sequential requests respect the server's bounded evaluator instead of filling a render queue.
    for (const state of states) {
      let result: FormulaResult;
      try {
        result = await options.evaluate(state.formula.definition, signal);
      } catch {
        result = { ok: false, reason: 'unavailable' };
      }
      if (signal.aborted || disposed) return;
      state.result = fit(result, state.formula.definition, state.formula.start);
      repaint();
    }
  };
  const refresh = (force = false): Promise<void> => {
    if (disposed || printPaused) return Promise.resolve();
    if (refreshing && !force) return refreshing;
    if (force) abort.abort();
    const task = evaluateAll();
    refreshing = task;
    void task.finally(() => {
      if (refreshing === task) refreshing = undefined;
    });
    return task;
  };
  const clear = () => {
    abort.abort();
    refreshing = undefined;
    if (!states.length) return;
    states = states.map((state) => ({ ...state, result: { ok: false, reason: 'unavailable' } }));
    installPainters();
    repaint();
  };
  const resume = () => {
    printPaused = false;
    return refresh();
  };
  const beforePrint = () => {
    printPaused = true;
    clear();
  };
  const afterPrint = () => {
    void resume();
  };
  globalThis.addEventListener('beforeprint', beforePrint);
  globalThis.addEventListener('afterprint', afterPrint);
  const stopPrint = injector
    .get(DocPrintInterceptorService)
    .registerPrintPreparation(async (context) => {
      if (context.unitId !== unitId) return;
      beforePrint();
      // Native PDF entry points await this public hook before collecting canvas/DOM pages.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
  const changes = commands.onCommandExecuted((command) => {
    if (
      command.id === RichTextEditingMutation.id &&
      (command.params as { unitId?: string } | undefined)?.unitId === unitId
    )
      void refresh(true);
  });
  const clicks = render
    .with(DocEventManagerService)
    .clickCustomRanges$.subscribe(({ range, segmentId }) => {
      if (segmentId) return;
      const formula = formulaFromRange(range, document.getBody());
      if (formula) options.onActivate?.(formula);
    });
  const selection = (): DocFormulaSelection => {
    const range = selections.getActiveTextRange();
    if (!range || range.segmentId) throw new Error('Place the cursor in the document body first.');
    return {
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      collapsed: range.collapsed,
      revision: document.getMutationRevision(),
    };
  };
  const insert = async (
    definition: FormulaDefinition,
    selected?: DocFormulaSelection,
    replaceId?: string,
  ) => {
    if (printPaused)
      throw new Error('Finish the PDF dialog, then refresh formulas before editing.');
    const existing = replaceId
      ? docFormulas(document.getBody()).find((entry) => entry.id === replaceId)
      : undefined;
    if (replaceId && !existing) throw new Error('This formula was removed. Close and try again.');
    if (!existing && selected && selected.revision !== document.getMutationRevision())
      throw new Error('The document changed. Cancel and place the cursor again before inserting.');
    const range = existing
      ? { startOffset: existing.start, endOffset: existing.end, collapsed: false }
      : (selected ?? selection());
    const revision = document.getMutationRevision();
    const check = new AbortController();
    const evaluated = await options.evaluate(definition, check.signal);
    if (disposed) throw new Error('The document was closed.');
    if (revision !== document.getMutationRevision())
      throw new Error('The document changed while calculating. Try saving the formula again.');
    const fitted = fit(evaluated, definition, range.startOffset);
    const unchangedPrivate =
      !fitted.ok &&
      fitted.reason === 'private-source' &&
      existing &&
      existing.definition.expression === definition.expression &&
      JSON.stringify(existing.definition.references) === JSON.stringify(definition.references);
    if (!fitted.ok && !unchangedPrivate)
      throw new Error(
        fitted.reason === 'too-large'
          ? 'This result does not fit the page. Use a smaller range or shorter cell values.'
          : 'This formula cannot be calculated. Preview it and check its sources.',
      );
    return commands.executeCommand(InsertTextCommand.id, {
      unitId,
      body: formulaBody(replaceId ?? crypto.randomUUID(), definition),
      range,
      textRanges: [
        {
          startOffset: range.startOffset + definition.expression.length,
          endOffset: range.startOffset + definition.expression.length,
          collapsed: true,
        },
      ],
    });
  };
  void refresh();
  return {
    refresh,
    insert,
    selection,
    clear,
    resume,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      changes.dispose();
      clicks.unsubscribe();
      stopPrint();
      globalThis.removeEventListener('beforeprint', beforePrint);
      globalThis.removeEventListener('afterprint', afterPrint);
      interceptor.dispose();
      presentation?.dispose();
      for (const key of painters.keys()) if (key.startsWith(`${scope}:`)) painters.delete(key);
      if (--mounts === 0) {
        renderer?.dispose();
        renderer = undefined;
      }
      states = [];
    },
  };
}
export type DocFormulaController = ReturnType<typeof installDocFormulas>;
