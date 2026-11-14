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
import type { IDocumentData, IUniverConfig, IWorkbookData, Workbook } from '@univerjs/core';
import { DocStateChangeManagerService, UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsDrawingPlugin } from '@univerjs/docs-drawing';
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
import { validateRecoverySnapshot } from './recovery.ts';
import { byteBudget } from './hash.ts';
import { admitNativeMutation, admitSnapshot } from './admission.ts';
import { ClientError } from './types.ts';
import type { DocumentKind, NativeSnapshot, NativeSyncOptions, SyncReplica } from './types.ts';

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

function executeNative(univer: Univer, mutations: readonly Mutation[], onlyLocal: boolean) {
  const injector = univer.__getInjector();
  const commands = injector.get(ICommandService);
  const instances = injector.get(IUniverInstanceService);
  for (const mutation of mutations) {
    // A valid server edit can exceed the visible model's budget when combined
    // with optimistic local work. Refuse before the native handler allocates.
    admitNativeMutation(
      mutation,
      instances.getUnit<Workbook>(mutation.params.unitId, UniverInstanceType.UNIVER_SHEET) ?? null,
    );
    const accepted = commands.syncExecuteCommand(
      mutation.id,
      structuredClone(mutation.params),
      onlyLocal ? { onlyLocal: true, fromCollab: true } : { fromCollab: true },
    );
    if (!accepted) throw new ClientError('malformed');
  }
}

/** Live peer edits need native formula registration and dirty-range calculation.
 * fromCollab prevents capture echo; onlyLocal would suppress that calculation. */
export function applyNative(univer: Univer, mutations: readonly Mutation[]) {
  executeNative(univer, mutations, false);
}

/** A bounded, disposable confirmed copy using the same OSS native handlers as the server. */
export class NativeReplica implements SyncReplica {
  readonly univer: Univer;
  private readonly unitId: string;
  private readonly opaque: NonNullable<NativeSnapshot['resources']>;

  constructor(
    snapshot: NativeSnapshot,
    kind: DocumentKind,
    // Live native regression clients can exercise the editor's public retention
    // policy at construction. Confirmed/server copies keep the SDK default.
    options: Pick<IUniverConfig, 'undoRedoHistoryLimit'> = {},
  ) {
    admitSnapshot(snapshot, kind);
    this.unitId = snapshot.id;
    this.univer = new Univer({
      locale: LocaleType.EN_US,
      undoRedoHistoryLimit: options.undoRedoHistoryLimit,
    });
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
      // Its resource is a serialized copy of the canonical Doc drawing map.
      // Keep it current so reloading cannot restore an older opaque copy.
      this.univer.registerPlugin(UniverDocsDrawingPlugin);
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
    // Keep confirmed authored-state application separate from live calculation.
    executeNative(this.univer, mutations, true);
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
  if (options.checkpoint) validateRecoverySnapshot(options.checkpoint);
  const snapshot = options.checkpoint?.snapshot ?? options.snapshot;
  if (
    !snapshot ||
    snapshot.id !== options.unitId ||
    (options.kind === 'sheet') !== 'sheets' in snapshot
  )
    throw new ClientError('malformed');
  const canonical = <T>(value: T) => options.toCanonical?.(value) ?? value;
  const visible = <T>(value: T) => options.toVisible?.(value) ?? value;
  const confirmed = new NativeReplica(snapshot, options.kind);
  let client: SyncClient | undefined;
  try {
    client = new SyncClient({
      ...options,
      confirmed,
      applyRemote: (mutations) => {
        applyNative(options.univer, visible(mutations));
        // OSS history stores native inverse coordinates, not rebased operations.
        // Even a peer write hidden by an optimistic deletion invalidates its saved
        // inverse: Undo would restore pre-peer content. Own acks do not call here.
        options.univer.__getInjector().get(IUndoRedoService).clearUndoRedo(options.unitId);
        if (options.kind === 'doc')
          options.univer
            .__getInjector()
            .get(DocStateChangeManagerService)
            .clearHistory(options.unitId);
      },
      visibleSnapshot: () => canonical(nativeSnapshot(options.univer, options.unitId)),
    });
    // The host opened either the confirmed base or a complete local recovery
    // snapshot. Only the base needs its optimistic queue applied before capture.
    if (options.checkpoint && !options.checkpoint.recoverySnapshot) {
      const restored = client.checkpoint();
      applyNative(options.univer, visible([...restored.inflight, ...restored.buffer.flat()]));
    }
  } catch (error) {
    if (client) client.dispose();
    else confirmed.dispose();
    throw error;
  }
  const ready = client;
  const capture = captureNative({
    univer: options.univer,
    unitId: options.unitId,
    onMutation: (mutation) => ready.enqueue([canonical(mutation)]),
    onFailure: (reason) => ready.refuse(reason),
    canEdit: () => ready.accepting,
  });
  ready.addCleanup(() => capture.dispose());
  return ready;
}
