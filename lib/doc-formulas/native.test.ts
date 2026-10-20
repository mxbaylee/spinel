import { afterEach, describe, expect, it, vi } from 'vitest';
import { ICommandService, IUniverInstanceService, type Univer } from '@univerjs/core';
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
  registerDocumentLayoutPresentation: () => ({ dispose() {} }),
}));
const definition: FormulaDefinition = { version: 1, expression: '=1', references: [] };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
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
) {
  const body = formulaBody('formula', definition);
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
    getViewModel: () => ({ reset() {} }),
    getSkeleton: () => ({ makeDirty() {}, findNodeByCharIndex: () => undefined }),
    recalculate() {},
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
    edit: () => {
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
