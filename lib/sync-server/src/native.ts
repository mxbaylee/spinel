import {
  ICommandService,
  IResourceLoaderService,
  IResourceManagerService,
  LocaleType,
  Univer,
  UniverInstanceType,
} from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
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
import { MAX_SNAPSHOT_BYTES, SyncError } from './types.ts';

type Invariant = 'no-sheet' | 'no-visible-sheet' | 'worksheet-identity' | 'worksheet-name';
export class InvariantError extends SyncError {
  readonly invariant: Invariant;
  constructor(invariant: Invariant) {
    super('invariant');
    this.invariant = invariant;
  }
}

export function validateSnapshot(snapshot: NativeSnapshot, kind: DocumentKind, unitId = snapshot.id) {
  if (snapshot.id !== unitId || Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES)
    throw new SyncError('malformed');
  if (kind === 'doc') return;
  const book = snapshot as IWorkbookData;
  if (!Array.isArray(book.sheetOrder) || !book.sheets || typeof book.sheets !== 'object')
    throw new InvariantError('worksheet-identity');
  if (!book.sheetOrder.length) throw new InvariantError('no-sheet');
  const ids = Object.keys(book.sheets);
  if (
    new Set(book.sheetOrder).size !== book.sheetOrder.length ||
    ids.length !== book.sheetOrder.length ||
    ids.some((id) => !book.sheetOrder.includes(id) || book.sheets[id]?.id !== id)
  ) throw new InvariantError('worksheet-identity');
  const names = new Set<string>();
  let visible = false;
  for (const sheet of Object.values(book.sheets)) {
    if (typeof sheet.name !== 'string' || !sheet.name || names.has(sheet.name.toLowerCase()))
      throw new InvariantError('worksheet-name');
    names.add(sheet.name.toLowerCase());
    if (sheet.hidden === undefined || sheet.hidden === 0) visible = true;
  }
  if (!visible) throw new InvariantError('no-visible-sheet');
}

/** Check the requested final identities before native handlers can normalize them. */
function validateWorksheetPlan(snapshot: NativeSnapshot, mutations: Mutation[], kind: DocumentKind) {
  if (kind !== 'sheet') return;
  const book = snapshot as IWorkbookData;
  const sheets = Object.fromEntries(Object.entries(book.sheets).map(([id, sheet]) => [id, { ...sheet }]));
  const sheetOrder = [...book.sheetOrder];
  for (const mutation of mutations) {
    const p = mutation.params;
    if (mutation.id === 'sheet.mutation.insert-sheet') {
      if (!p.sheet || typeof p.sheet.id !== 'string' || Object.hasOwn(sheets, p.sheet.id))
        throw new InvariantError('worksheet-identity');
      sheets[p.sheet.id] = p.sheet;
      if (!Number.isSafeInteger(p.index) || p.index < 0 || p.index > sheetOrder.length)
        throw new InvariantError('worksheet-identity');
      sheetOrder.splice(p.index, 0, p.sheet.id);
    } else if (mutation.id === 'sheet.mutation.remove-sheet') {
      if (!Object.hasOwn(sheets, p.subUnitId)) throw new InvariantError('worksheet-identity');
      delete sheets[p.subUnitId];
      sheetOrder.splice(sheetOrder.indexOf(p.subUnitId), 1);
    } else if (mutation.id === 'sheet.mutation.set-worksheet-name') {
      if (!Object.hasOwn(sheets, p.subUnitId)) throw new InvariantError('worksheet-identity');
      sheets[p.subUnitId] = { ...sheets[p.subUnitId], name: p.name };
    } else if (mutation.id === 'sheet.mutation.set-worksheet-hidden') {
      if (!Object.hasOwn(sheets, p.subUnitId)) throw new InvariantError('worksheet-identity');
      sheets[p.subUnitId] = { ...sheets[p.subUnitId], hidden: p.hidden };
    } else if (mutation.id === 'sheet.mutation.set-worksheet-order') {
      const position = sheetOrder.indexOf(p.subUnitId);
      if (position < 0 || !Number.isSafeInteger(p.toOrder) || p.toOrder < 0 || p.toOrder >= sheetOrder.length)
        throw new InvariantError('worksheet-identity');
      sheetOrder.splice(position, 1);
      sheetOrder.splice(p.toOrder, 0, p.subUnitId);
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

  constructor(snapshot: NativeSnapshot, kind: DocumentKind) {
    validateSnapshot(snapshot, kind);
    this.unitId = snapshot.id;
    this.kind = kind;
    this.univer = new Univer({ locale: LocaleType.EN_US });
    try {
      // Docs rich text resolves render services, but no DOM or canvas is created.
      this.univer.registerPlugin(UniverRenderEnginePlugin);
      this.univer.registerPlugin(UniverSheetsPlugin);
      this.univer.registerPlugin(UniverSheetsFormulaPlugin);
      this.univer.registerPlugin(UniverSheetsNumfmtPlugin);
      this.univer.registerPlugin(UniverDocsPlugin);
      this.univer.registerPlugin(UniverDocsHyperLinkPlugin);
      this.univer.registerPlugin(UniverDrawingPlugin);
      this.univer.registerPlugin(UniverSheetsDrawingPlugin);
      const injector = this.univer.__getInjector();
      this.loader = injector.get(IResourceLoaderService);
      const resources = injector.get(IResourceManagerService);
      const hooks = resources.getAllResourceHooks();
      // Native loading logs and ignores parse failures; the server refuses them.
      for (const resource of snapshot.resources ?? []) {
        const hook = hooks.find((entry) => entry.pluginName === resource.name);
        if (hook) hook.parseJson(resource.data);
      }
      const managed = new Set(hooks.map((hook) => String(hook.pluginName)));
      this.opaque = structuredClone((snapshot.resources ?? []).filter((resource) => !managed.has(resource.name)));
      this.univer.createUnit(
        kind === 'sheet' ? UniverInstanceType.UNIVER_SHEET : UniverInstanceType.UNIVER_DOC,
        structuredClone(snapshot),
      );
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
    snapshot.resources.push(...structuredClone(this.opaque.filter((resource) => !managed.has(resource.name))));
    return snapshot;
  }

  apply(mutations: Mutation[]): NativeSnapshot {
    validateWorksheetPlan(this.snapshot(), mutations, this.kind);
    for (const mutation of mutations) {
      // A handler may rewrite its params. Stored and broadcast output is immutable.
      const accepted = this.commands.syncExecuteCommand(mutation.id, structuredClone(mutation.params), {
        onlyLocal: true,
        fromCollab: true,
      });
      if (!accepted) throw new SyncError('malformed');
    }
    const snapshot = this.snapshot();
    validateSnapshot(snapshot, this.kind, this.unitId);
    return snapshot;
  }

  dispose() { this.univer.dispose(); }
}

/** Public preparation for initial or restored native units. */
export function materialize(snapshot: NativeSnapshot, kind: DocumentKind, mutations: Mutation[] = []): NativeSnapshot {
  const model = new NativeModel(snapshot, kind);
  try { return model.apply(mutations); }
  finally { model.dispose(); }
}
