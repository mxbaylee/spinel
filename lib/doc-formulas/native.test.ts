import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ICommandService,
  IUniverInstanceService,
  type Univer,
  type IDocumentBody,
} from '@univerjs/core';
import {
  DocInterceptorService,
  DocSelectionManagerService,
  DocSkeletonManagerService,
} from '@univerjs/docs';
import { DocEventManagerService, DocPrintInterceptorService } from '@univerjs/docs-ui';
import { IRenderManagerService } from '@univerjs/engine-render';
import { installDocFormulas, type FormulaState } from './native.ts';
import { formulaBody } from './model.ts';
import type { FormulaDefinition, FormulaResult } from './definition.ts';
import type { IDocumentLayoutSnapshot } from '@univerjs/engine-render';

const hooks = vi.hoisted(() => ({
  presentation: vi.fn(
    (
      _model: unknown,
      _projection: { getSnapshot: (snapshot: IDocumentLayoutSnapshot) => IDocumentLayoutSnapshot },
    ) => ({ dispose: vi.fn() }),
  ),
}));

vi.mock('@univerjs/docs', () => ({
  DOC_INTERCEPTOR_POINT: { CUSTOM_RANGE: Symbol('range') },
  DocInterceptorService: Symbol('interceptor'),
  DocSelectionManagerService: Symbol('selection'),
  DocSkeletonManagerService: Symbol('skeleton'),
  InsertTextCommand: { id: 'insert' },
  RichTextEditingMutation: { id: 'rich' },
}));
vi.mock('@univerjs/docs-ui', () => ({
  DocEventManagerService: Symbol('events'),
  DocPrintInterceptorService: Symbol('print'),
}));
vi.mock('@univerjs/engine-render', () => ({
  IRenderManagerService: Symbol('render'),
  registerDocCustomGlyphRenderer: () => ({ dispose() {} }),
  registerDocumentLayoutPresentation: hooks.presentation,
}));
const definition: FormulaDefinition = { version: 1, expression: '=1', references: [] };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function deferred() {
  let resolve!: (value: FormulaResult) => void;
  const promise = new Promise<FormulaResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  evaluate: (definition: FormulaDefinition, signal: AbortSignal) => Promise<FormulaResult>,
  empty = false,
) {
  let body: IDocumentBody = empty
    ? { dataStream: 'A plain document\r\n' }
    : formulaBody('formula', definition);
  let revision = 0;
  const states: FormulaState[][] = [];
  let mutation!: (command: { id: string; params: { unitId: string } }) => void;
  let print!: (context: { unitId: string; dpr: number }) => Promise<void>;
  const executeCommand = vi.fn(async () => true);
  const model = {
    getBody: () => body,
    getMutationRevision: () => revision,
    getDocumentStyle: () => ({ pageSize: { width: 700, height: 1000 }, textStyle: { fs: 12 } }),
  };
  const skeleton = {
    getViewModel: () => ({
      reset() {},
      getChildren: () => [{ endIndex: body.dataStream.length - 1 }],
    }),
    getSkeleton: () => ({ makeDirty() {}, findNodeByCharIndex: () => undefined }),
    recalculate: vi.fn(),
  };
  const render = {
    mainComponent: { makeDirty() {} },
    with: (token: unknown) => {
      if (token === DocSkeletonManagerService) return skeleton;
      if (token === DocInterceptorService) return { intercept: () => ({ dispose() {} }) };
      if (token === DocEventManagerService)
        return { clickCustomRanges$: { subscribe: () => ({ unsubscribe() {} }) } };
      throw new Error('Unexpected render service');
    },
  };
  const services = new Map<unknown, unknown>([
    [IUniverInstanceService, { getUnit: () => model }],
    [IRenderManagerService, { getRenderUnitById: () => render }],
    [
      ICommandService,
      {
        executeCommand,
        onCommandExecuted: (listener: typeof mutation) => {
          mutation = listener;
          return { dispose() {} };
        },
      },
    ],
    [
      DocSelectionManagerService,
      { getActiveTextRange: () => ({ startOffset: 0, endOffset: 0, collapsed: true }) },
    ],
    [
      DocPrintInterceptorService,
      {
        registerPrintPreparation: (handler: typeof print) => {
          print = handler;
          return () => true;
        },
      },
    ],
  ]);
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({
        font: '',
        measureText: (text: string) => ({ width: text.length * 60 }),
      }),
    }),
  });
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => queueMicrotask(callback));
  const controller = installDocFormulas({
    univer: {
      __getInjector: () => ({ get: (token: unknown) => services.get(token) }),
    } as unknown as Univer,
    unitId: 'doc',
    evaluate,
    onChange: (value) => states.push(structuredClone(value)),
  });
  cleanups.push(controller.dispose);
  return {
    controller,
    states,
    executeCommand,
    repaints: skeleton.recalculate,
    edit: (replacement?: IDocumentBody) => {
      if (replacement) body = replacement;
      revision++;
      mutation({ id: 'rich', params: { unitId: 'doc' } });
    },
    print: () => print({ unitId: 'doc', dpr: 1 }),
    move: () => {
      revision++;
    },
  };
}
describe('native formula lifecycle', () => {
  it('leaves plain documents on their original layout path without polling repaints', async () => {
    const evaluate = vi.fn(async (): Promise<FormulaResult> => ({
      ok: true,
      kind: 'scalar',
      value: 1,
    }));
    const { controller, repaints, edit } = fixture(evaluate, true);
    await controller.refresh();
    await controller.refresh();
    controller.clear();
    edit();
    await controller.refresh();
    expect(evaluate).not.toHaveBeenCalled();
    expect(repaints).not.toHaveBeenCalled();
    expect(hooks.presentation).not.toHaveBeenCalled();
  });
  it('restores the normal layout after removal and reinstalls formulas on undo without late values', async () => {
    const removed = deferred();
    const evaluate = vi
      .fn()
      .mockReturnValueOnce(removed.promise)
      .mockResolvedValue({ ok: true, kind: 'scalar', value: 7 });
    const { controller, states, edit } = fixture(evaluate, true);
    edit(formulaBody('formula', definition));
    const pending = controller.refresh();
    expect(hooks.presentation).toHaveBeenCalledTimes(1);
    const firstPresentation = hooks.presentation.mock.results[0]!.value;
    edit({ dataStream: 'A plain document\r\n' });
    await controller.refresh();
    expect(firstPresentation.dispose).toHaveBeenCalledOnce();
    expect(states.at(-1)).toEqual([]);
    removed.resolve({ ok: true, kind: 'scalar', value: 999 });
    await pending;
    expect(states.at(-1)).toEqual([]);
    edit(formulaBody('formula', definition));
    await controller.refresh();
    expect(hooks.presentation).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.[0]?.result).toEqual({ ok: true, kind: 'scalar', value: 7 });
    expect(JSON.stringify(states)).not.toContain('999');
  });
  it('projects section paint options for modern layout without saving them to the document', async () => {
    const { controller } = fixture(async () => ({ ok: true, kind: 'scalar', value: 42 }));
    await controller.refresh();
    const source: IDocumentLayoutSnapshot = {
      id: 'doc',
      documentStyle: { documentFlavor: 2, renderConfig: { background: { rgb: '#fff' } } },
      body: {
        ...formulaBody('formula', definition),
        sectionBreaks: [{ startIndex: 1, sectionId: 'original', renderConfig: { vertexAngle: 0 } }],
      },
    };
    const before = structuredClone(source);
    const projected = hooks.presentation.mock.calls[0]![1].getSnapshot(source);
    expect(projected.body?.sectionBreaks?.[0]).toMatchObject({
      sectionId: 'original',
      renderConfig: { useCustomGlyphRenderer: 1, vertexAngle: 0, background: { rgb: '#fff' } },
    });
    expect(source).toEqual(before);
    // Imported snapshots may omit section metadata; existing layout nodes supply it transiently.
    delete source.body!.sectionBreaks;
    expect(
      hooks.presentation.mock.calls[0]![1].getSnapshot(source).body?.sectionBreaks?.[0],
    ).toMatchObject({
      startIndex: 1,
      renderConfig: { useCustomGlyphRenderer: 1 },
    });
    expect(source.body!.sectionBreaks).toBeUndefined();
  });
  it('coalesces refreshes so an in-flight calculation is not continually aborted', async () => {
    const pending = deferred(),
      evaluate = vi.fn(() => pending.promise);
    const { controller, states } = fixture(evaluate);
    const first = controller.refresh(),
      second = controller.refresh();
    expect(first).toBe(second);
    expect(evaluate).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, kind: 'scalar', value: 42 });
    await first;
    expect(states.at(-1)?.[0]?.result).toEqual({ ok: true, kind: 'scalar', value: 42 });
  });
  it('discards a stale response after a document mutation', async () => {
    const old = deferred(),
      fresh = deferred();
    const evaluate = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { controller, states, edit } = fixture(evaluate);
    const first = controller.refresh();
    edit();
    const second = controller.refresh();
    old.resolve({ ok: true, kind: 'scalar', value: 999 });
    await first;
    expect(states.at(-1)?.[0]?.result.ok).toBe(false);
    fresh.resolve({ ok: true, kind: 'scalar', value: 7 });
    await second;
    expect(JSON.stringify(states)).not.toContain('999');
    expect(states.at(-1)?.[0]?.result).toEqual({ ok: true, kind: 'scalar', value: 7 });
  });
  it('pauses all print-entry calculations and clears an earlier result before page collection', async () => {
    const evaluate = vi.fn(async (): Promise<FormulaResult> => ({
      ok: true,
      kind: 'scalar',
      value: 42,
    }));
    const { controller, states, print } = fixture(evaluate);
    await controller.refresh();
    await print();
    await controller.refresh();
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.[0]?.result).toEqual({ ok: false, reason: 'unavailable' });
    await controller.resume();
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
  it('does not restore an aborted private result during print preparation', async () => {
    const pending = deferred();
    const { controller, states, print } = fixture(() => pending.promise);
    const inFlight = controller.refresh();
    await print();
    pending.resolve({ ok: true, kind: 'scalar', value: 999 });
    await inFlight;
    expect(JSON.stringify(states)).not.toContain('999');
  });
  it('rejects a captured caret after a concurrent mutation rather than writing at the wrong offset', async () => {
    const { controller, move, executeCommand } = fixture(async () => ({
      ok: true,
      kind: 'scalar',
      value: 1,
    }));
    await controller.refresh();
    const selection = controller.selection();
    move();
    await expect(controller.insert(definition, selection)).rejects.toThrow('document changed');
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
