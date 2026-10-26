import {
  ICommandService,
  ILogService,
  IResourceLoaderService,
  IResourceManagerService,
  IUndoRedoService,
  IUniverInstanceService,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
} from '@univerjs/core';
import type { IDocumentData, IWorkbookData, Workbook } from '@univerjs/core';
import { DocStateChangeManagerService, UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsHyperLinkPlugin } from '@univerjs/docs-hyper-link';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsDrawingPlugin } from '@univerjs/sheets-drawing';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import type { BaseCells, Mutation } from '@spinel/sync-transform';
import { SyncClient } from './client.ts';
import { captureNative } from './capture.ts';
import { byteBudget } from './hash.ts';
import { ClientError } from './types.ts';
import type { DocumentKind, NativeSnapshot, NativeSyncOptions, SyncReplica } from './types.ts';

/** Compact native merge ranges must be bounded before SpanModel expands them. */
function admitSnapshot(snapshot: NativeSnapshot, kind: DocumentKind) {
  byteBudget()(snapshot);
  if (kind !== 'sheet') return;
  const sheets = Object.values((snapshot as IWorkbookData).sheets);
  if (sheets.length > 1024) throw new ClientError('capacity');
  const span = (start: number, end: number, maximum: number) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start)
      throw new ClientError('malformed');
    if (end > maximum) throw new ClientError('capacity');
    return end - start + 1;
  };
  let mergeCells = 0;
  for (const sheet of sheets) {
    for (const [count, maximum] of [
      [sheet.rowCount, 1_048_576],
      [sheet.columnCount, 16_384],
    ] as const) {
      if (count === undefined) continue;
      if (!Number.isSafeInteger(count) || count < 1) throw new ClientError('malformed');
      if (count > maximum) throw new ClientError('capacity');
    }
    if (sheet.mergeData !== undefined && !Array.isArray(sheet.mergeData))
      throw new ClientError('malformed');
    for (const range of sheet.mergeData ?? []) {
      const type = range.rangeType ?? 0;
      if (![0, 1, 2, 3].includes(type)) throw new ClientError('malformed');
      const rows = type === 0 || type === 1 ? span(range.startRow, range.endRow, 1_048_575) : 1;
      const columns =
        type === 0 || type === 2 ? span(range.startColumn, range.endColumn, 16_383) : 1;
      mergeCells += rows * columns;
      if (mergeCells > 250_000) throw new ClientError('capacity');
    }
  }
}

/** Save resources through the public loader, including plugin-owned names/drawings. */
export function nativeSnapshot(univer: Univer, unitId: string): NativeSnapshot {
  const snapshot = univer
    .__getInjector()
    .get(IResourceLoaderService)
    .saveUnit<NativeSnapshot>(unitId);
  if (!snapshot) throw new ClientError('unavailable');
  byteBudget()(snapshot);
  return structuredClone(snapshot);
}

/** Remote styles need onlyLocal for native formula recalculation; fromCollab prevents echo. */
export function applyNative(univer: Univer, mutations: readonly Mutation[]) {
  const commands = univer.__getInjector().get(ICommandService);
  for (const mutation of mutations) {
    const accepted = commands.syncExecuteCommand(mutation.id, structuredClone(mutation.params), {
      onlyLocal: true,
      fromCollab: true,
    });
    if (!accepted) throw new ClientError('malformed');
  }
}

/** A bounded, disposable confirmed copy using the same OSS native handlers as the server. */
export class NativeReplica implements SyncReplica {
  readonly univer: Univer;
  private readonly unitId: string;
  private readonly opaque: NonNullable<NativeSnapshot['resources']>;

  constructor(snapshot: NativeSnapshot, kind: DocumentKind) {
    admitSnapshot(snapshot, kind);
    this.unitId = snapshot.id;
    this.univer = new Univer({ locale: LocaleType.EN_US });
    try {
      const injector = this.univer.__getInjector();
      injector.get(ILogService).setLogLevel(LogLevel.SILENT);
      this.univer.registerPlugin(UniverRenderEnginePlugin);
      this.univer.registerPlugin(UniverSheetsPlugin);
      this.univer.registerPlugin(UniverSheetsFormulaPlugin);
      this.univer.registerPlugin(UniverSheetsNumfmtPlugin);
      this.univer.registerPlugin(UniverDocsPlugin);
      this.univer.registerPlugin(UniverDocsHyperLinkPlugin);
      this.univer.registerPlugin(UniverDrawingPlugin);
      this.univer.registerPlugin(UniverSheetsDrawingPlugin);
      const resources = injector.get(IResourceManagerService);
      const hooks = resources.getAllResourceHooks();
      for (const resource of snapshot.resources ?? []) {
        const hook = hooks.find((entry) => entry.pluginName === resource.name);
        if (hook) hook.parseJson(resource.data);
      }
      const managed = new Set(hooks.map((hook) => String(hook.pluginName)));
      this.opaque = structuredClone(
        (snapshot.resources ?? []).filter((resource) => !managed.has(resource.name)),
      );
      if (kind === 'sheet')
        this.univer.createUnit(
          UniverInstanceType.UNIVER_SHEET,
          structuredClone(snapshot as IWorkbookData),
        );
      else
        this.univer.createUnit(
          UniverInstanceType.UNIVER_DOC,
          structuredClone(snapshot as IDocumentData),
        );
      const startedHooks = resources.getAllResourceHooks();
      for (const resource of snapshot.resources ?? []) {
        const hook = startedHooks.find((entry) => entry.pluginName === resource.name);
        if (hook && resource.data) {
          JSON.parse(resource.data);
          hook.parseJson(resource.data);
        }
      }
    } catch (error) {
      this.univer.dispose();
      throw error;
    }
  }

  cells(): BaseCells {
    const charge = byteBudget();
    const workbook = this.univer
      .__getInjector()
      .get(IUniverInstanceService)
      .getUnit<Workbook>(this.unitId, UniverInstanceType.UNIVER_SHEET);
    return (unitId, sheetId, row, column) => {
      if (!workbook || unitId !== this.unitId) return null;
      charge([unitId, sheetId, row, column]);
      const cell = workbook.getSheetBySheetId(sheetId)?.getCellRaw(row, column);
      if (!cell) return null;
      const s = typeof cell.s === 'string' ? workbook.getStyles().get(cell.s) : cell.s;
      charge({ ...cell, s });
      return structuredClone({ ...cell, s });
    };
  }

  apply(mutations: readonly Mutation[]) {
    applyNative(this.univer, mutations);
  }

  snapshot(): NativeSnapshot {
    const snapshot = nativeSnapshot(this.univer, this.unitId);
    const managed = new Set((snapshot.resources ?? []).map((resource) => resource.name));
    snapshot.resources = [
      ...(snapshot.resources ?? []),
      ...structuredClone(this.opaque.filter((resource) => !managed.has(resource.name))),
    ];
    return snapshot;
  }

  dispose() {
    this.univer.dispose();
  }
}

/** The host owns the visible unit, sockets, access policy and reload UI. */
export function createNativeSyncClient(options: NativeSyncOptions): SyncClient {
  const client = new SyncClient({
    ...options,
    confirmed: new NativeReplica(options.snapshot, options.kind),
    applyRemote: (mutations) => {
      if (!mutations.length) return;
      applyNative(options.univer, mutations);
      // OSS history stores native inverse coordinates, not rebased operations.
      // A peer's structural/text edit can otherwise make Undo change another cell.
      options.univer.__getInjector().get(IUndoRedoService).clearUndoRedo(options.unitId);
      if (options.kind === 'doc')
        options.univer
          .__getInjector()
          .get(DocStateChangeManagerService)
          .clearHistory(options.unitId);
    },
    visibleSnapshot: () => nativeSnapshot(options.univer, options.unitId),
  });
  const capture = captureNative({
    univer: options.univer,
    unitId: options.unitId,
    onMutation: (mutation) => client.enqueue([mutation]),
    onFailure: (reason) => client.refuse(reason),
    canEdit: () => client.accepting,
  });
  client.addCleanup(() => capture.dispose());
  return client;
}
