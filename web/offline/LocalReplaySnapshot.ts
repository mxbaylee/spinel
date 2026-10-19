import type { ILogContext, ISnapshotServerService } from '@univerjs-pro/collaboration';
import type {
  IFetchMissingChangesetsRequest,
  IGetResourcesRequest,
  IGetSheetBlockRequest,
  IGetUnitOnRevRequest,
  IGetResourcesResponse,
} from '@univerjs/protocol';
import type { OfflineReplay } from '../../src/shared/offlineReplay.ts';
import type { OfflineAccess } from './OfflineAccess.ts';

function dense<T>(value: readonly T[]): boolean {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function resourcesValid(resources: readonly { id?: string; name: string; data: string }[]) {
  if (!dense(resources)) return false;
  const names = new Set<string>(),
    ids = new Set<string>();
  for (const resource of resources) {
    if (
      !record(resource) ||
      typeof resource.name !== 'string' ||
      !resource.name ||
      typeof resource.data !== 'string' ||
      names.has(resource.name) ||
      (resource.id !== undefined &&
        (typeof resource.id !== 'string' || !resource.id || ids.has(resource.id)))
    )
      return false;
    names.add(resource.name);
    if (resource.id !== undefined) ids.add(resource.id);
  }
  return true;
}

/** Read-only public SDK adapter for one complete, pinned replay base.
 * No transport fallback: an uncovered read must never become an unvalidated
 * remote request. The coordinator must select the prepared revision explicitly.
 */
export class LocalReplaySnapshot implements ISnapshotServerService {
  private access: OfflineAccess;
  private bundle: OfflineReplay;
  private currentAccount: () => string | null;
  constructor(access: OfflineAccess, source: OfflineReplay, currentAccount: () => string | null) {
    this.access = access;
    this.currentAccount = currentAccount;
    this.bundle = structuredClone(source);
    const bundle = this.bundle;
    this.assertScope();
    const scope = access.scope,
      data = this.bundle.data,
      snapshot = data.snapshot;
    const type = scope.kind === 'doc' ? 1 : 2;
    if (
      bundle.version !== 1 ||
      bundle.sdkVersion !== scope.sdkVersion ||
      bundle.accountId !== scope.accountId ||
      bundle.itemId !== scope.itemId ||
      bundle.unitId !== scope.unitId ||
      bundle.access !== scope.access ||
      bundle.revisionOffset !== scope.revisionOffset ||
      snapshot.unitID !== scope.unitId ||
      snapshot.type !== type ||
      !Number.isSafeInteger(snapshot.rev) ||
      snapshot.rev < 0 ||
      !Number.isSafeInteger(data.targetRevision) ||
      data.targetRevision < snapshot.rev
    )
      throw new Error('Replay base does not match its prepared scope and revision.');
    const meta = type === 1 ? snapshot.doc : snapshot.workbook;
    if (
      !meta ||
      typeof meta.creator !== 'string' ||
      typeof meta.name !== 'string' ||
      meta.unitID !== scope.unitId ||
      meta.rev !== snapshot.rev ||
      !(meta.originalMeta instanceof Uint8Array) ||
      snapshot.slide ||
      snapshot.board ||
      snapshot.pdf ||
      (type === 1 ? snapshot.workbook : snapshot.doc)
    )
      throw new Error('Replay base metadata is incomplete or inconsistent.');
    if (!dense(data.changesets) || !dense(data.sheetBlocks))
      throw new Error('Replay collections must be complete dense arrays.');
    let revision = snapshot.rev;
    for (const cs of data.changesets) {
      if (
        !record(cs) ||
        cs.unitID !== scope.unitId ||
        cs.type !== type ||
        cs.revision !== revision + 1 ||
        !Number.isSafeInteger(cs.baseRev) ||
        cs.baseRev < 0 ||
        cs.baseRev > revision ||
        typeof cs.userID !== 'string' ||
        typeof cs.memberID !== 'string' ||
        (cs.sid !== undefined && typeof cs.sid !== 'string') ||
        (cs.reqId !== undefined && (!Number.isSafeInteger(cs.reqId) || cs.reqId < 1)) ||
        !dense(cs.mutations) ||
        cs.mutations.some(
          (mutation) =>
            !record(mutation) ||
            typeof mutation.id !== 'string' ||
            !mutation.id ||
            typeof mutation.data !== 'string',
        )
      )
        throw new Error('Replay tail is not a complete contiguous revision range.');
      revision = cs.revision;
    }
    if (revision !== data.targetRevision) throw new Error('Replay tail does not reach its target.');
    const ids = new Set<string>();
    for (const block of data.sheetBlocks) {
      if (
        !record(block) ||
        type !== 2 ||
        typeof block.id !== 'string' ||
        !block.id ||
        ids.has(block.id) ||
        !(block.data instanceof Uint8Array) ||
        !Number.isSafeInteger(block.startRow) ||
        !Number.isSafeInteger(block.endRow) ||
        block.startRow < 0 ||
        block.endRow < block.startRow
      )
        throw new Error('Replay block is malformed or duplicated.');
      ids.add(block.id);
    }
    if (snapshot.workbook) {
      const workbook = snapshot.workbook;
      if (
        !record(workbook.sheets) ||
        !record(workbook.blockMeta) ||
        !dense(workbook.sheetOrder) ||
        workbook.sheetOrder.some(
          (id) => typeof id !== 'string' || !Object.hasOwn(workbook.sheets, id),
        ) ||
        new Set(workbook.sheetOrder).size !== workbook.sheetOrder.length ||
        Object.keys(workbook.sheets).length !== workbook.sheetOrder.length
      )
        throw new Error('Replay worksheet order does not match its metadata.');
      for (const [sheetId, sheet] of Object.entries(workbook.sheets)) {
        if (
          !record(sheet) ||
          sheet.id !== sheetId ||
          !sheetId ||
          !Number.isSafeInteger(sheet.type) ||
          typeof sheet.name !== 'string' ||
          !Number.isSafeInteger(sheet.rowCount) ||
          sheet.rowCount < 0 ||
          !Number.isSafeInteger(sheet.columnCount) ||
          sheet.columnCount < 0 ||
          !(sheet.originalMeta instanceof Uint8Array)
        )
          throw new Error('Replay worksheet metadata is malformed.');
      }
      for (const [sheetId, blocks] of Object.entries(workbook.blockMeta)) {
        if (
          !Object.hasOwn(workbook.sheets, sheetId) ||
          !record(blocks) ||
          blocks.sheetID !== sheetId ||
          !dense(blocks.blocks) ||
          new Set(blocks.blocks).size !== blocks.blocks.length ||
          blocks.blocks.some((id) => typeof id !== 'string' || !ids.has(id))
        )
          throw new Error('Replay base is missing a required Sheet block.');
      }
    }
    if (!resourcesValid(meta.resources) || !resourcesValid(bundle.preservedResources))
      throw new Error('Replay resources are malformed or ambiguous.');
    const names = new Set(meta.resources.map((resource) => resource.name));
    for (const resource of bundle.preservedResources) {
      if (!names.has(resource.name)) {
        meta.resources.push(structuredClone(resource));
        names.add(resource.name);
      }
    }
    if (!resourcesValid(meta.resources))
      throw new Error('Combined replay resource identities are ambiguous.');
  }
  private assertScope(request?: { unitID: string; type: number }) {
    const account = this.currentAccount();
    if (
      !this.access.mayReadLocal ||
      account !== this.access.scope.accountId ||
      (request &&
        (request.unitID !== this.access.scope.unitId ||
          request.type !== (this.access.scope.kind === 'doc' ? 1 : 2)))
    )
      throw new Error('Local replay read left its prepared account or document.');
  }
  async getUnitOnRev(_context: ILogContext, request: IGetUnitOnRevRequest) {
    this.assertScope(request);
    // Zero is not an alias for a newer server revision. It is accepted only
    // when this prepared empty base itself has target revision zero.
    if (request.revision !== this.bundle.data.targetRevision)
      throw new Error('Choose the exact prepared replay revision.');
    return structuredClone({
      error: undefined,
      snapshot: this.bundle.data.snapshot,
      changesets: [...this.bundle.data.changesets],
    });
  }
  async getSheetBlock(_context: ILogContext, request: IGetSheetBlockRequest) {
    this.assertScope(request);
    const block = this.bundle.data.sheetBlocks.find((entry) => entry.id === request.blockID);
    if (!block || request.type !== 2) throw new Error('This Sheet block was not prepared.');
    return { error: undefined, block: structuredClone(block) };
  }
  getDeserializedSheetBlock(context: ILogContext, request: IGetSheetBlockRequest) {
    // The public interface explicitly permits the binary block response.
    return this.getSheetBlock(context, request);
  }
  async fetchMissingChangesets(_context: ILogContext, request: IFetchMissingChangesetsRequest) {
    this.assertScope(request);
    const data = this.bundle.data;
    if (
      !Number.isSafeInteger(request.from) ||
      !Number.isSafeInteger(request.to) ||
      request.from < data.snapshot.rev ||
      request.to < request.from ||
      request.to > data.targetRevision ||
      request.to === 0
    )
      throw new Error('This changeset range was not prepared.');
    return {
      error: undefined,
      latestRevision: data.targetRevision,
      changesets: structuredClone(
        data.changesets.filter((cs) => cs.revision > request.from && cs.revision <= request.to),
      ),
    };
  }
  async getResourcesRequest(_context: ILogContext, request: IGetResourcesRequest) {
    this.assertScope(request);
    const snapshot = this.bundle.data.snapshot;
    const available = (snapshot.doc ?? snapshot.workbook)!.resources;
    const resources: IGetResourcesResponse['resources'] = Object.create(null);
    for (const id of request.resourceIDs) {
      const matches = available.filter((resource) => resource.id === id);
      if (matches.length !== 1) throw new Error('This resource was not uniquely prepared.');
      resources[id] = structuredClone(matches[0]);
    }
    return { error: undefined, resources };
  }
  private denied(): never {
    throw new Error('Prepared replay bases are read-only.');
  }
  async saveSnapshot(): Promise<never> {
    return this.denied();
  }
  async updateSnapshot(): Promise<never> {
    return this.denied();
  }
  async saveSheetBlock(): Promise<never> {
    return this.denied();
  }
  async saveChangeset(): Promise<never> {
    return this.denied();
  }
  async copyFileMeta(): Promise<never> {
    return this.denied();
  }
  async getLatestCsReqIdBySid(): Promise<never> {
    return this.denied();
  }
}
