import {
  ICommandService,
  IUniverInstanceService,
  LocaleType,
  normalizeTextRuns,
  Tools,
  Univer,
  UniverInstanceType,
} from '@univerjs/core';
import type { ICellData, IDocumentData, IWorkbookData, Workbook } from '@univerjs/core';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsHyperLinkPlugin } from '@univerjs/docs-hyper-link';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { IDefinedNamesService } from '@univerjs/engine-formula';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { ISheetDrawingService, UniverSheetsDrawingPlugin } from '@univerjs/sheets-drawing';
import { expect } from 'vitest';
import { flip, transform } from '../index.ts';
import type { BaseCells, Mutation, RefusalReason, Side } from '../index.ts';
import { seededWorkbook } from './generate.ts';

/**
 * One client's copy of a document: a headless Univer that applies mutations
 * with the real open-source handlers, so convergence is checked against the
 * model Spinel's editors use, not a re-implementation of it.
 */
export class Replica {
  readonly univer = new Univer({ locale: LocaleType.EN_US });
  private readonly commands: ICommandService;

  constructor(document: { workbook?: IWorkbookData; doc?: IDocumentData }) {
    // The rich-text handler looks up the render manager; nothing is rendered.
    this.univer.registerPlugin(UniverRenderEnginePlugin);
    this.univer.registerPlugin(UniverSheetsPlugin);
    // Rewrites defined names when a command moves the cells they name, as in Spinel's editor.
    this.univer.registerPlugin(UniverSheetsFormulaPlugin);
    this.univer.registerPlugin(UniverDocsPlugin);
    this.univer.registerPlugin(UniverDocsHyperLinkPlugin);
    this.univer.registerPlugin(UniverDrawingPlugin);
    this.univer.registerPlugin(UniverSheetsDrawingPlugin);
    if (document.workbook) {
      this.univer.createUnit(UniverInstanceType.UNIVER_SHEET, Tools.deepClone(document.workbook));
    }
    if (document.doc) {
      this.univer.createUnit(UniverInstanceType.UNIVER_DOC, Tools.deepClone(document.doc));
    }
    this.commands = this.injector.get(ICommandService);
  }

  get injector() {
    return this.univer.__getInjector();
  }

  /** Applies mutations as a remote change. Handlers may rewrite params, so each gets a copy. */
  apply(mutations: Mutation[]) {
    for (const mutation of mutations) {
      let ok: boolean;
      try {
        ok = this.commands.syncExecuteCommand(mutation.id, Tools.deepClone(mutation.params), {
          onlyLocal: true,
          fromCollab: true,
        });
      } catch (error) {
        const order = this.workbook()?.getSheetOrders();
        throw new Error(
          `${mutation.id} failed on ${JSON.stringify(order)}: ${JSON.stringify(mutation.params).slice(0, 300)}`,
          { cause: error },
        );
      }
      if (!ok)
        throw new Error(`Univer rejected ${mutation.id}: ${JSON.stringify(mutation.params)}`);
    }
  }

  workbook(): Workbook | undefined {
    return (
      this.injector
        .get(IUniverInstanceService)
        .getCurrentUnitOfType<Workbook>(UniverInstanceType.UNIVER_SHEET) ?? undefined
    );
  }

  /**
   * The document in a form two replicas can compare: style ids, which each
   * client allocates at random, are replaced by the styles they name, and
   * merges, which Univer keeps in arrival order, are sorted.
   */
  snapshot(): unknown {
    const instances = this.injector.get(IUniverInstanceService);
    const workbook = this.workbook();
    const doc = instances.getCurrentUnitOfType(UniverInstanceType.UNIVER_DOC);
    return {
      workbook: workbook && normalizeWorkbook(workbook.getSnapshot()),
      drawings: workbook && this.sheetDrawings(workbook),
      names:
        workbook && this.injector.get(IDefinedNamesService).getDefinedNameMap(workbook.getUnitId()),
      doc: doc && normalizeDoc(doc.getSnapshot() as IDocumentData),
    };
  }

  /**
   * The sheet drawings Univer persists (the SHEET_DRAWING_PLUGIN resource), for
   * live sheets only: the drawing tree keeps entries for a removed sheet, and
   * Univer lazily creates empty ones as its services look sheets up.
   */
  private sheetDrawings(workbook: Workbook) {
    const units = this.injector
      .get(ISheetDrawingService)
      .getDrawingDataForUnit(workbook.getUnitId());
    return Object.fromEntries(
      Object.entries(units).filter(
        ([sheetId, sheet]) =>
          workbook.getSheetBySheetId(sheetId) &&
          (Object.keys(sheet.data ?? {}).length > 0 || (sheet.order ?? []).length > 0),
      ),
    );
  }
}

/**
 * Univer leaves adjacent runs of one style split or joined, and creates empty
 * collections lazily, depending on the order edits arrive in.
 *
 * It also gives a bulleted paragraph `bullet.textStyle: {}` when it applies a
 * merging retain to it (TextX's updateParagraphs fills in a default bullet),
 * so whether one is there depends on whether a paragraph style or a bullet
 * landed last. No op carries it, so a transform cannot strip it, and it is
 * benign: Univer's renderer spreads the bullet's text style over the
 * paragraph's, bullet.set copies it only as it is, and no command writes one
 * that is not empty. So an empty one counts as none.
 */
function normalizeDoc(snapshot: IDocumentData) {
  if (!snapshot.body) return snapshot;
  const body: Record<string, unknown> = {
    ...snapshot.body,
    textRuns: normalizeTextRuns(Tools.deepClone(snapshot.body.textRuns ?? [])),
    paragraphs: snapshot.body.paragraphs?.map(({ bullet, ...paragraph }) => {
      if (!bullet) return paragraph;
      const { textStyle, ...rest } = bullet;
      return { ...paragraph, bullet: isEmptyObject(textStyle) ? rest : bullet };
    }),
  };
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value) && value.length === 0) delete body[key];
  }
  return { ...snapshot, body };
}

function normalizeWorkbook(snapshot: IWorkbookData) {
  const styles = snapshot.styles ?? {};
  const style = (s: unknown) => (typeof s === 'string' ? (styles[s] ?? s) : s);
  const sheets = Object.fromEntries(
    Object.entries(snapshot.sheets).map(([id, sheet]) => {
      const cellData: Record<string, Record<string, unknown>> = {};
      for (const [row, columns] of Object.entries(sheet.cellData ?? {})) {
        for (const [column, cell] of Object.entries(columns ?? {}) as [string, ICellData][]) {
          if (!cell) continue;
          const resolved: Record<string, unknown> = { ...cell };
          if (cell.s !== undefined) resolved.s = style(cell.s);
          // RemoveNumfmt leaves `s: {}` on a cell whose only style was its
          // format, so whether one is left depends on the order it meets a
          // clear. Univer renders it as no style.
          if (isEmptyObject(resolved.s)) delete resolved.s;
          if (Object.keys(resolved).length === 0) continue;
          (cellData[row] ??= {})[column] = resolved;
        }
      }
      const lines = (data: Record<string, any> | undefined) =>
        Object.fromEntries(
          Object.entries(data ?? {}).map(([i, line]) => [
            i,
            { ...line, ...(line?.s !== undefined && { s: style(line.s) }) },
          ]),
        );
      // Undo restores a merge with its keys in another order, so keys are sorted too.
      const mergeData = [...(sheet.mergeData ?? [])]
        .map((range) => JSON.stringify(Object.fromEntries(Object.entries(range).sort())))
        .sort();
      return [
        id,
        {
          ...sheet,
          cellData,
          rowData: lines(sheet.rowData),
          columnData: lines(sheet.columnData),
          mergeData,
          defaultStyle: style(sheet.defaultStyle),
        },
      ];
    }),
  );
  return { ...snapshot, styles: undefined, sheets };
}

/**
 * Applies `setup`, then `a` and `b` in both orders (`b` then `a` transformed
 * past it, and the reverse), checks the two copies agree, and returns the
 * snapshot.
 */
export function converges(
  a: Mutation | Mutation[],
  b: Mutation | Mutation[],
  {
    side = 'left',
    setup = [],
    document = { workbook: seededWorkbook() },
  }: { side?: Side; setup?: Mutation[]; document?: ConstructorParameters<typeof Replica>[0] } = {},
): any {
  const as = [a].flat();
  const bs = [b].flat();
  const first = new Replica(document);
  const second = new Replica(document);
  first.apply(setup);
  second.apply(setup);
  // Each transform reads the cells both were made on, before either lands.
  first.apply([...bs, ...transform(as, bs, side, { cells: liveCells(first) })]);
  second.apply([...as, ...transform(bs, as, flip(side), { cells: liveCells(second) })]);
  expect(first.snapshot()).toEqual(second.snapshot());
  return first.snapshot();
}

/**
 * The cells of `replica`'s workbook as it is when read, styles inline, as a
 * transform reads them (BaseCells). A transform reads them while it runs, so
 * the replica must not change meanwhile.
 */
export function liveCells(replica: Replica): BaseCells {
  return (unitId, subUnitId, row, col) => {
    const workbook = replica.workbook();
    if (workbook?.getUnitId() !== unitId) return null;
    const cell = workbook.getSheetBySheetId(subUnitId)?.getCellRaw(row, col);
    if (!cell) return null;
    const s = typeof cell.s === 'string' ? workbook.getStyles().get(cell.s) : cell.s;
    return { ...cell, s };
  };
}

/** The cells of a workbook snapshot (IWorkbookData), styles inline (see `liveCells`). */
export function snapshotCells(data: IWorkbookData | undefined): BaseCells {
  return (unitId, subUnitId, row, col) => {
    if (data?.id !== unitId) return null;
    const cell = data.sheets[subUnitId]?.cellData?.[row]?.[col];
    if (!cell) return null;
    const s = typeof cell.s === 'string' ? data.styles?.[cell.s] : cell.s;
    return { ...cell, s };
  };
}

const isEmptyObject = (value: unknown) =>
  typeof value === 'object' && value !== null && Object.keys(value).length === 0;

/**
 * Expects `x` and `y` refused for `reason`, both ways round and on either
 * side, reading `cells` where two writes meet before the refusal.
 */
export function refusedBothWays(
  x: Mutation | Mutation[],
  y: Mutation | Mutation[],
  reason: RefusalReason = 'moved-cells',
  cells?: BaseCells,
) {
  const [a, b] = [[x].flat(), [y].flat()];
  for (const side of ['left', 'right'] as const) {
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      expect(() => transform(p, q, side, { cells }), side).toThrow(
        expect.objectContaining({ reason }),
      );
    }
  }
}
