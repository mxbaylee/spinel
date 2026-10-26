import {
  DrawingTypeEnum,
  ICommandService,
  IResourceManagerService,
  IUndoRedoService,
  IUniverInstanceService,
  LocaleService,
  LocaleType,
  sequenceExecute,
  UniverInstanceType,
} from '@univerjs/core';
import type { DocumentDataModel } from '@univerjs/core';
import {
  alignToMergedCellsBorders,
  getMoveRangeCommandMutations,
  SetWorksheetActiveOperation,
} from '@univerjs/sheets';
import { expect } from 'vitest';
import type { Mutation } from '../index.ts';
import { structureIds } from '../src/structure.ts';
import { cellIds, matrixWrites } from '../src/writes.ts';
import { contentState, docText, textMarker } from './content-intent.ts';
import type { EditDescription } from './coverage.ts';
import { randomSheet, recordWire, wire } from './generate.ts';
import { Replica } from './harness.ts';
import type { Generate } from './simulate.ts';

export type GeneratorFamily =
  | 'structure'
  | 'cells'
  | 'commands'
  | 'cuts'
  | 'properties'
  | 'merges'
  | 'settings'
  | 'drawings'
  | 'names'
  | 'docs';

export const historyFingerprint = (replica: Replica) => {
  const snapshot = replica.snapshot() as { names?: unknown };
  return JSON.stringify({ ...snapshot, names: snapshot.names ?? {} }, (key, value) =>
    // The harness separately includes the live drawing/name services. A
    // clone's import resources describe its opening state, not current data.
    key === 'resources'
      ? undefined
      : value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
  );
};

type History = {
  family: GeneratorFamily;
  undone: string;
  after: string;
  edit: Mutation[];
  undo: Mutation[];
  redo: Mutation[];
  next: 'undo' | 'redo';
};

/** Native history stores style IDs; the sender contract puts their values on the wire. */
function inlineHistory(source: Mutation[], replica: Replica): Mutation[] {
  const mutations = wire(source) as Mutation[];
  const style = (id: string) => {
    const value = replica.workbook()!.getStyles().get(id);
    if (!value) throw new Error(`Native history refers to missing style ${id}`);
    return structuredClone(value);
  };
  const records = (data: Record<string, any> | undefined) => {
    for (const value of Object.values(data ?? {})) {
      if (typeof value?.s === 'string') value.s = style(value.s);
    }
  };
  for (const { id, params } of mutations) {
    const matrices =
      id === cellIds.setRangeValues
        ? [params.cellValue]
        : id === cellIds.moveRange
          ? [params.from.value, params.to.value]
          : id === structureIds.insertSheet
            ? [params.sheet.cellData]
            : [];
    for (const { value } of matrices.flatMap(matrixWrites)) {
      if (typeof value?.s === 'string') value.s = style(value.s);
    }
    for (const field of ['rowData', 'columnData', 'rowInfo', 'colInfo']) records(params[field]);
    if (params.sheet) {
      records(params.sheet.rowData);
      records(params.sheet.columnData);
      if (typeof params.sheet.defaultStyle === 'string')
        params.sheet.defaultStyle = style(params.sheet.defaultStyle);
    }
    if (typeof params.defaultStyle === 'string') params.defaultStyle = style(params.defaultStyle);
  }
  return mutations;
}

/** A real command/history cycle on the exact document this client currently sees. */
export function historyExample(
  family: GeneratorFamily,
  replica: Replica,
  next: () => number,
): History | null {
  const workbook = replica.workbook()!;
  const unitId = workbook.getUnitId();
  const resources = replica.injector
    .get(IResourceManagerService)
    .getResourcesByType(unitId, UniverInstanceType.UNIVER_SHEET);
  const document = replica.injector
    .get(IUniverInstanceService)
    .getCurrentUnitOfType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC);
  const copy = new Replica({
    workbook: { ...workbook.getSnapshot(), resources },
    doc: document?.getSnapshot(),
  });
  try {
    const commands = copy.injector.get(ICommandService);
    const instances = copy.injector.get(IUniverInstanceService);
    copy.injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
    const sheet = randomSheet(copy, next);
    const subUnitId = sheet.getSheetId();
    const target = { unitId, subUnitId };
    const row = next() % sheet.getRowCount();
    const col = next() % sheet.getColumnCount();
    const range = { startRow: row, endRow: row, startColumn: col, endColumn: col };
    const focus = family === 'docs' ? document!.getUnitId() : unitId;
    instances.focusUnit(focus);
    if (family !== 'docs') commands.syncExecuteCommand(SetWorksheetActiveOperation.id, target);
    const originalContent = contentState(copy);
    const run = (id: string, params: object) => {
      const order = [...copy.workbook()!.getSheetOrders()];
      const recording = recordWire(commands);
      let result: unknown;
      try {
        result = commands.syncExecuteCommand(id, params);
      } catch (error) {
        // Native merge is declared async, but defaultMerge skips its only
        // await. Every mutation and its history entry exist synchronously.
        if (!String(error).includes('should not return a promise')) throw error;
        result = recording.mutations.length > 0;
      } finally {
        recording.dispose();
      }
      if (!result) return null;
      return recording.mutations.map((mutation) =>
        mutation.id === structureIds.removeSheet && mutation.params.index === undefined
          ? {
              ...mutation,
              params: { ...mutation.params, index: order.indexOf(mutation.params.subUnitId) },
            }
          : mutation,
      );
    };
    let edit: Mutation[] | null;
    if (family === 'structure') {
      const id = `n_history_${next()}`;
      edit = run('sheet.command.insert-sheet', {
        unitId,
        index: next() % (workbook.getSheetOrders().length + 1),
        sheet: { id, name: id, rowCount: 4, columnCount: 3, cellData: { 0: { 0: { v: id } } } },
      });
    } else if (family === 'cells') {
      edit = run('sheet.command.set-range-values', {
        ...target,
        range,
        value: { v: `history value ${next()}`, f: null, si: null, p: null },
      });
    } else if (family === 'commands') {
      edit = run('sheet.command.set-style', {
        ...target,
        range,
        style: { type: 'bl', value: next() % 2 },
      });
    } else if (family === 'cuts') {
      const others = copy
        .workbook()!
        .getSheetOrders()
        .filter((id) => id !== subUnitId);
      if (others.length === 0) return null;
      const toSubUnitId = others[next() % others.length];
      const toSheet = copy.workbook()!.getSheetBySheetId(toSubUnitId)!;
      // A real selected source includes its complete merge. Passing a partial
      // merge straight to the factory bypasses the command's admission hook
      // and fabricates an undo shape the UI would not send.
      const fromRange = alignToMergedCellsBorders(range, sheet, false);
      const rows = fromRange.endRow - fromRange.startRow;
      const cols = fromRange.endColumn - fromRange.startColumn;
      if (rows >= toSheet.getRowCount() || cols >= toSheet.getColumnCount()) return null;
      const toRow = next() % (toSheet.getRowCount() - rows);
      const toCol = next() % (toSheet.getColumnCount() - cols);
      // The public factory is exactly what the async MoveRangeCommand stores
      // in native history; selection-only operations are deliberately absent.
      const info = copy.injector.invoke((accessor) =>
        getMoveRangeCommandMutations(
          accessor,
          {
            ...target,
            fromSubUnitId: subUnitId,
            toSubUnitId,
            fromRange,
            toRange: {
              startRow: toRow,
              endRow: toRow + rows,
              startColumn: toCol,
              endColumn: toCol + cols,
            },
          },
          { includeSelection: false },
        ),
      );
      if (!info) return null;
      const recording = recordWire(commands);
      try {
        if (!sequenceExecute(info.redos, commands).result) {
          if (recording.mutations.length > 0)
            throw new Error('Native cut failed after sending mutations');
          return null;
        }
        edit = recording.mutations;
      } finally {
        recording.dispose();
      }
      copy.injector.get(IUndoRedoService).pushUndoRedo({
        unitID: unitId,
        undoMutations: info.undos,
        redoMutations: info.redos,
      });
    } else if (family === 'properties') {
      edit = run('sheet.command.set-row-height', {
        ...target,
        ranges: [range],
        value: 30 + (next() % 30),
      });
    } else if (family === 'merges') {
      if (sheet.getColumnCount() < 2) return null;
      const startColumn = Math.min(col, sheet.getColumnCount() - 2);
      const merge = { ...range, startColumn, endColumn: startColumn + 1 };
      edit = run('sheet.command.add-worksheet-merge', {
        ...target,
        selections: [merge],
        defaultMerge: true,
      });
    } else if (family === 'settings') {
      edit = run('sheet.command.set-tab-color', {
        ...target,
        value: next() % 2 ? '#cc0022' : '#0044bb',
      });
    } else if (family === 'drawings') {
      const drawingId = `history_image_${next()}`;
      const anchor = {
        from: { row, column: col, rowOffset: 0, columnOffset: 0 },
        to: { row: row + 1, column: col + 1, rowOffset: 0, columnOffset: 0 },
      };
      edit = run('sheet.command.insert-sheet-image', {
        drawings: [
          {
            ...target,
            drawingId,
            drawingType: DrawingTypeEnum.DRAWING_IMAGE,
            imageSourceType: 'URL',
            source: `https://example.com/${drawingId}.png`,
            transform: { left: col * 88, top: row * 20, width: 88, height: 20, angle: 0 },
            sheetTransform: anchor,
            axisAlignSheetTransform: anchor,
          },
        ],
      });
    } else if (family === 'names') {
      const id = `history_name_${next()}`;
      edit = run('sheet.command.insert-defined-name', {
        unitId,
        id,
        name: id,
        formulaOrRefString: '=1',
      });
    } else {
      const at = next() % Math.max(1, docText(copy).length - 1);
      edit = run('doc.command.insert-text', {
        unitId: focus,
        segmentId: '',
        range: { startOffset: at, endOffset: at, collapsed: true },
        body: { dataStream: textMarker() },
        debounce: false,
      });
    }
    if (!edit?.length) return null;
    const after = historyFingerprint(copy);
    const undo = run('univer.command.undo', { unitId: focus });
    if (!undo?.length) throw new Error(`${family} command recorded no native undo`);
    // Native undo can materialize a previously inferred cell `t`, so capture
    // its actual inverse state rather than pretending every raw field returns
    // to its pre-command representation. Character/sheet identities do return.
    const undone = historyFingerprint(copy);
    expect(contentState(copy), `${family} native undo restores content identities`).toEqual(
      originalContent,
    );
    const redo = run('univer.command.redo', { unitId: focus });
    if (!redo?.length) throw new Error(`${family} command recorded no native redo`);
    expect(historyFingerprint(copy), `${family} native redo repeats its local state`).toBe(after);
    return {
      family,
      undone,
      after,
      edit: inlineHistory(edit, copy),
      undo: inlineHistory(undo, copy),
      redo: inlineHistory(redo, copy),
      next: 'undo',
    };
  } finally {
    copy.univer.dispose();
  }
}

/**
 * Random actual history actions, including commands from every generator
 * family. A remote state change invalidates cached native history as SPN-058
 * does; already emitted undo/redo still enters the ordinary pending queue.
 */
export function historyGenerator(generators: Record<GeneratorFamily, Generate>) {
  const pending = new WeakMap<Replica, History & { epoch: number }>();
  const descriptions = new WeakMap<Mutation[], EditDescription>();
  const families = Object.keys(generators) as GeneratorFamily[];
  const describe = (mutations: Mutation[]) => {
    const description = descriptions.get(mutations);
    if (!description) throw new Error('Generated edit lost its family provenance');
    return description;
  };
  const generate: Generate = (replica, next) => {
    const history = pending.get(replica);
    pending.delete(replica);
    if (history && next() % 4 !== 0) {
      // Simulator local edits apply each original mutation individually;
      // every peer revision calls apply once even if its transform is empty.
      if (replica.applicationEpoch === history.epoch) {
        const action = history.next;
        const mutations = structuredClone(history[action]);
        descriptions.set(mutations, { family: history.family, action });
        if (action === 'undo')
          pending.set(replica, {
            ...history,
            next: 'redo',
            epoch: replica.applicationEpoch + mutations.length,
          });
        return mutations;
      }
    }
    const family = families[next() % families.length];
    const example = next() % 8 === 0 ? historyExample(family, replica, next) : null;
    const mutations = example?.edit ?? generators[family](replica, next);
    if (mutations?.length) {
      descriptions.set(mutations, { family, action: 'edit' });
      if (example)
        pending.set(replica, {
          ...example,
          epoch: replica.applicationEpoch + mutations.length,
        });
    }
    return mutations;
  };
  return { generate, describe };
}
