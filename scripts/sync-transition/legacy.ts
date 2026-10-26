import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { NativeSnapshot, DocumentKind } from '@spinel/sync-server';
import type { LegacyTransitionReaderFactory } from '../../src/server/sync/transition.ts';

type Load = { targetRevision: number; [key: string]: unknown };
type Materialized = { snapshot: unknown; sheetBlocks: unknown };
type Context = { userID: string; memberID?: string; customData: Record<string, unknown> };
interface PublicService {
  getUnitLoadDataWithBlocks(
    request: { unitID: string; type: number; revision: number },
    context: Context,
  ): Promise<Load>;
  createUnitFromData(
    request: { type: number; data: NativeSnapshot },
    context: Context,
  ): Promise<unknown>;
  submitChangeset(
    request: { changeset: Record<string, unknown> },
    context: Context,
  ): Promise<{ status: string }>;
  deleteUnits(
    request: { unitIDs: readonly string[]; hardDelete: true },
    context: Context,
  ): Promise<unknown>;
  dispose(): Promise<void>;
}
interface PublicMaterializer {
  materializeSnapshot(input: Load): Promise<Materialized>;
  dispose(): Promise<void>;
}
interface PublicAdapter {
  getUnit(context: Context & { request: object }, unitId: string): Promise<{ type: number } | null>;
  dispose(): Promise<void>;
}

/** Only named public exports and published declarations are used. The application
 * never imports these packages; the operator supplies the pinned legacy checkout. */
export function publicLegacyModules(checkout: string) {
  const root = realpathSync(checkout);
  const require = createRequire(join(root, 'package.json'));
  for (const name of [
    '@univerjs-pro/collaboration',
    '@univerjs-pro/collaboration-service',
    '@univerjs-pro/collaboration-database-sqlite',
    '@univerjs/protocol',
  ]) {
    const metadata = JSON.parse(
      readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'),
    );
    if (metadata.version !== '1.1.0') throw new Error('Use the pinned 1.1.0 legacy checkout.');
  }
  const service = require('@univerjs-pro/collaboration-service') as {
    UniverCollabService: new (options: Record<string, unknown>) => PublicService;
    UnitSnapshotMaterializer: new (options: Record<string, unknown>) => PublicMaterializer;
  };
  const database = require('@univerjs-pro/collaboration-database-sqlite') as {
    SQLiteDatabaseAdapter: new (options: {
      filename: string;
      busyTimeoutMs: number;
    }) => PublicAdapter;
  };
  const converters = require('@univerjs-pro/collaboration') as {
    transformSnapshotToDocumentData(snapshot: unknown): NativeSnapshot;
    transformSnapshotToWorkbookData(snapshot: unknown, blocks: unknown): Promise<NativeSnapshot>;
  };
  const { UniverType } = require('@univerjs/protocol') as {
    UniverType: { UNIVER_SHEET: number; UNIVER_DOC: number };
  };
  const runtime = { maxLoadedUnits: 1, idleTimeoutMs: 1_000, execution: { mode: 'in-process' } };
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const open = (filename: string) => {
    const adapter = new database.SQLiteDatabaseAdapter({ filename, busyTimeoutMs: 5_000 });
    const collab = new service.UniverCollabService({
      dbAdapter: adapter,
      runtime,
      logger,
      snapshotPolicy: false,
    });
    const materializer = new service.UnitSnapshotMaterializer(runtime);
    return { adapter, collab, materializer };
  };
  const type = (kind: DocumentKind) =>
    kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC;
  return { open, type, converters };
}

export function legacyTransitionReader(checkout: string): LegacyTransitionReaderFactory {
  return async (copy) => {
    const api = publicLegacyModules(checkout);
    const { adapter, collab, materializer } = api.open(copy);
    const context = { userID: 'spinel-offline-transition', customData: {} };
    const missing = async (unitIds: readonly string[]) => {
      for (const unitID of unitIds) {
        for (const kind of ['sheet', 'doc'] as const) {
          try {
            await collab.getUnitLoadDataWithBlocks(
              { unitID, type: api.type(kind), revision: 0 },
              context,
            );
          } catch (error) {
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'UNIT_NOT_FOUND'
            )
              continue;
            throw error;
          }
          throw new Error('Public SDK deletion verification failed.');
        }
      }
    };
    return {
      async load(unitId, kind) {
        // This is an offline copy with no application server or credentials.
        // Public SDK reads preserve trashed and disabled-owner documents too.
        const data = await collab.getUnitLoadDataWithBlocks(
          { unitID: unitId, type: api.type(kind), revision: 0 },
          context,
        );
        const result = await materializer.materializeSnapshot(data);
        const snapshot =
          kind === 'sheet'
            ? await api.converters.transformSnapshotToWorkbookData(
                result.snapshot,
                result.sheetBlocks,
              )
            : api.converters.transformSnapshotToDocumentData(result.snapshot);
        return { snapshot, revision: data.targetRevision };
      },
      async purge(unitIds) {
        for (const unitId of unitIds) {
          if (await adapter.getUnit({ ...context, request: {} }, unitId))
            await collab.deleteUnits({ unitIDs: [unitId], hardDelete: true }, context);
        }
      },
      assertMissing: missing,
      async close() {
        try {
          await materializer.dispose();
        } finally {
          try {
            await collab.dispose();
          } finally {
            await adapter.dispose();
          }
        }
      },
    };
  };
}
