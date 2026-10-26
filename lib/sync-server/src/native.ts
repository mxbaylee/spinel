import {
  ICommandService,
  ILogService,
  IResourceLoaderService,
  IResourceManagerService,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
} from '@univerjs/core';
import type { IDocumentData, IWorkbookData, Workbook } from '@univerjs/core';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsHyperLinkPlugin } from '@univerjs/docs-hyper-link';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsDrawingPlugin } from '@univerjs/sheets-drawing';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import type { Mutation } from '@spinel/sync-transform';
import type { DocumentKind, NativeSnapshot } from './types.ts';
import { MAX_MERGE_CELLS, MAX_SNAPSHOT_BYTES, MAX_WORKSHEETS, SyncError } from './types.ts';
import { applySheetOrder } from './order.ts';

type Invariant = 'no-sheet' | 'no-visible-sheet' | 'worksheet-identity' | 'worksheet-name';
export class InvariantError extends SyncError {
  readonly invariant: Invariant;
  constructor(invariant: Invariant) {
    super('invariant');
    this.invariant = invariant;
  }
}

/** A compact merge range expands into native row/column/cell cache entries. */
function mergeFootprint(merges: unknown): number {
  if (merges === undefined) return 0;
  if (!Array.isArray(merges)) throw new SyncError('malformed');
  const span = (start: unknown, end: unknown, maximum: number) => {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      (start as number) < 0 ||
      (end as number) < (start as number)
    )
      throw new SyncError('malformed');
    if ((end as number) > maximum) throw new SyncError('capacity');
    return (end as number) - (start as number) + 1;
  };
  let cells = 0;
  for (const range of merges) {
    if (!range || typeof range !== 'object' || Array.isArray(range))
      throw new SyncError('malformed');
    const type = range.rangeType === undefined ? 0 : range.rangeType;
    if (![0, 1, 2, 3].includes(type)) throw new SyncError('malformed');
    const rows = type === 0 || type === 1 ? span(range.startRow, range.endRow, 1_048_575) : 1;
    const columns = type === 0 || type === 2 ? span(range.startColumn, range.endColumn, 16_383) : 1;
    cells += rows * columns;
    if (cells > MAX_MERGE_CELLS) throw new SyncError('capacity');
  }
  return cells;
}

function validateMergeBudget(merges: unknown[]) {
  let cells = 0;
  for (const data of merges) {
    cells += mergeFootprint(data);
    if (cells > MAX_MERGE_CELLS) throw new SyncError('capacity');
  }
}

export function validateSnapshot(
  snapshot: NativeSnapshot,
  kind: DocumentKind,
  unitId = snapshot.id,
) {
  if (snapshot.id !== unitId || Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES)
    throw new SyncError('malformed');
  if (kind === 'doc') {
    const doc = snapshot as IDocumentData;
    // Match the existing native save boundary: a forged JSONX edit may not
    // remove the body or its mandatory terminal paragraph/section markers.
    if (typeof doc.body?.dataStream !== 'string' || !doc.body.dataStream.endsWith('\r\n'))
      throw new SyncError('malformed');
    return;
  }
  const book = snapshot as IWorkbookData;
  if (!Array.isArray(book.sheetOrder) || !book.sheets || typeof book.sheets !== 'object')
    throw new InvariantError('worksheet-identity');
  if (!book.sheetOrder.length) throw new InvariantError('no-sheet');
  if (book.sheetOrder.length > MAX_WORKSHEETS) throw new SyncError('capacity');
  const ids = Object.keys(book.sheets);
  if (
    new Set(book.sheetOrder).size !== book.sheetOrder.length ||
    ids.length !== book.sheetOrder.length ||
    ids.some((id) => !book.sheetOrder.includes(id) || book.sheets[id]?.id !== id)
  )
    throw new InvariantError('worksheet-identity');
  const names = new Set<string>();
  let visible = false;
  validateMergeBudget(Object.values(book.sheets).map((sheet) => sheet.mergeData));
  for (const sheet of Object.values(book.sheets)) {
    for (const [field, maximum] of [
      ['rowCount', 1_048_576],
      ['columnCount', 16_384],
    ] as const) {
      const count = sheet[field];
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 1))
        throw new SyncError('malformed');
      if (count !== undefined && count > maximum) throw new SyncError('capacity');
    }
    if (typeof sheet.name !== 'string' || !sheet.name || names.has(sheet.name.toLowerCase()))
      throw new InvariantError('worksheet-name');
    names.add(sheet.name.toLowerCase());
    if (sheet.hidden === undefined || sheet.hidden === 0) visible = true;
  }
  if (!visible) throw new InvariantError('no-visible-sheet');
}

/** Check the requested final identities before native handlers can normalize them. */
function validateWorksheetPlan(
  snapshot: NativeSnapshot,
  mutations: Mutation[],
  kind: DocumentKind,
) {
  if (kind !== 'sheet') return;
  const book = snapshot as IWorkbookData;
  const sheets = Object.fromEntries(
    Object.entries(book.sheets).map(([id, sheet]) => [id, { ...sheet }]),
  );
  const sheetOrder = applySheetOrder(book.sheetOrder, mutations);
  for (const mutation of mutations) {
    const p = mutation.params;
    if (mutation.id === 'sheet.mutation.insert-sheet') {
      if (!p.sheet || typeof p.sheet.id !== 'string' || Object.hasOwn(sheets, p.sheet.id))
        throw new InvariantError('worksheet-identity');
      sheets[p.sheet.id] = p.sheet;
    } else if (mutation.id === 'sheet.mutation.remove-sheet') {
      if (!Object.hasOwn(sheets, p.subUnitId)) throw new InvariantError('worksheet-identity');
      delete sheets[p.subUnitId];
    } else if (mutation.id === 'sheet.mutation.set-worksheet-name') {
      if (!Object.hasOwn(sheets, p.subUnitId)) throw new InvariantError('worksheet-identity');
      sheets[p.subUnitId] = { ...sheets[p.subUnitId], name: p.name };
    } else if (mutation.id === 'sheet.mutation.set-worksheet-hidden') {
      if (!Object.hasOwn(sheets, p.subUnitId)) throw new InvariantError('worksheet-identity');
      sheets[p.subUnitId] = { ...sheets[p.subUnitId], hidden: p.hidden };
    }
  }
  validateSnapshot({ ...book, sheets, sheetOrder }, kind);
}

/** Each cache entry owns one headless OSS instance; no Pro code or browser engine. */
export class NativeModel {
  private readonly univer: Univer;
  private readonly commands: ICommandService;
  private readonly loader: IResourceLoaderService;
  private readonly opaque: NonNullable<NativeSnapshot['resources']>;
  private readonly unitId: string;
  private readonly kind: DocumentKind;
  private readonly workbook?: Workbook;

  constructor(snapshot: NativeSnapshot, kind: DocumentKind) {
    validateSnapshot(snapshot, kind);
    this.unitId = snapshot.id;
    this.kind = kind;
    this.univer = new Univer({ locale: LocaleType.EN_US });
    try {
      const injector = this.univer.__getInjector();
      // The SDK's normal logger includes native resource errors and untrusted
      // snapshot values. Only our allowlisted observations may leave this host.
      // Pinned core ignores a constructor logLevel of 0, so use the public setter.
      injector.get(ILogService).setLogLevel(LogLevel.SILENT);
      // Docs rich text resolves render services, but no DOM or canvas is created.
      this.univer.registerPlugin(UniverRenderEnginePlugin);
      this.univer.registerPlugin(UniverSheetsPlugin);
      this.univer.registerPlugin(UniverSheetsFormulaPlugin);
      this.univer.registerPlugin(UniverSheetsNumfmtPlugin);
      this.univer.registerPlugin(UniverDocsPlugin);
      this.univer.registerPlugin(UniverDocsHyperLinkPlugin);
      this.univer.registerPlugin(UniverDrawingPlugin);
      this.univer.registerPlugin(UniverSheetsDrawingPlugin);
      this.loader = injector.get(IResourceLoaderService);
      const resources = injector.get(IResourceManagerService);
      const hooks = resources.getAllResourceHooks();
      // Native loading logs and ignores parse failures; the server refuses them.
      for (const resource of snapshot.resources ?? []) {
        const hook = hooks.find((entry) => entry.pluginName === resource.name);
        if (hook) hook.parseJson(resource.data);
      }
      const managed = new Set(hooks.map((hook) => String(hook.pluginName)));
      this.opaque = structuredClone(
        (snapshot.resources ?? []).filter((resource) => !managed.has(resource.name)),
      );
      if (kind === 'sheet')
        this.workbook = this.univer.createUnit(
          UniverInstanceType.UNIVER_SHEET,
          structuredClone(snapshot as IWorkbookData),
        );
      else
        this.univer.createUnit(
          UniverInstanceType.UNIVER_DOC,
          structuredClone(snapshot as IDocumentData),
        );
      // Business plugins may register their resource hooks only when the unit
      // starts. Their tolerant parsers must not silently discard malformed JSON.
      const startedHooks = resources.getAllResourceHooks();
      for (const resource of snapshot.resources ?? []) {
        const hook = startedHooks.find((entry) => entry.pluginName === resource.name);
        if (hook && resource.data) {
          JSON.parse(resource.data);
          hook.parseJson(resource.data);
        }
      }
      this.commands = injector.get(ICommandService);
    } catch {
      this.univer.dispose();
      throw new SyncError('malformed');
    }
  }

  snapshot(): NativeSnapshot {
    const snapshot = this.loader.saveUnit<NativeSnapshot>(this.unitId);
    if (!snapshot) throw new SyncError('unavailable');
    const managed = new Set(snapshot.resources.map((resource) => resource.name));
    snapshot.resources.push(
      ...structuredClone(this.opaque.filter((resource) => !managed.has(resource.name))),
    );
    return snapshot;
  }

  apply(mutations: Mutation[]): NativeSnapshot {
    validateWorksheetPlan(this.snapshot(), mutations, this.kind);
    for (const mutation of mutations) {
      if (
        this.workbook &&
        (mutation.id === 'sheet.mutation.insert-sheet' ||
          mutation.id === 'sheet.mutation.add-worksheet-merge')
      ) {
        // Use the live per-step merges, so an earlier removal really frees its
        // budget. Check before a handler can rebuild or construct a SpanModel.
        validateMergeBudget([
          ...this.workbook.getSheets().map((sheet) => sheet.getConfig().mergeData),
          mutation.id === 'sheet.mutation.insert-sheet'
            ? mutation.params.sheet?.mergeData
            : mutation.params.ranges,
        ]);
      }
      // A handler may rewrite its params. Stored and broadcast output is immutable.
      let accepted: boolean;
      try {
        accepted = this.commands.syncExecuteCommand(mutation.id, structuredClone(mutation.params), {
          onlyLocal: true,
          fromCollab: true,
        });
      } catch {
        // Native validation messages can include sender-controlled details.
        throw new SyncError('malformed');
      }
      if (!accepted) throw new SyncError('malformed');
    }
    const snapshot = this.snapshot();
    validateSnapshot(snapshot, this.kind, this.unitId);
    return snapshot;
  }

  dispose() {
    this.univer.dispose();
  }
}

/** Public preparation for initial or restored native units. */
export function materialize(
  snapshot: NativeSnapshot,
  kind: DocumentKind,
  mutations: Mutation[] = [],
): NativeSnapshot {
  const model = new NativeModel(snapshot, kind);
  try {
    return model.apply(mutations);
  } finally {
    model.dispose();
  }
}
