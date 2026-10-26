import { LocaleType, getDocsEmptySnapshot } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { inlineSnapshotCell, normalizedCell, normalizedDocBody } from '@spinel/sync-transform';
import type { Mutation } from '@spinel/sync-transform';
import { materialize, SyncServer } from '@spinel/sync-server';
import type { SyncCommit, SyncRevision, SyncStorage, SyncUnit } from '@spinel/sync-server';
import { NativeReplica, SyncClient } from '../index.ts';
import type {
  ClientFailure,
  ClientState,
  DocumentKind,
  NativeSnapshot,
  OutgoingFrame,
  SubmitFrame,
  SyncClientOptions,
  WireRevision,
} from '../index.ts';

export function book(): IWorkbookData {
  return {
    id: 'book',
    name: 'Book',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['one', 'two'],
    styles: {},
    sheets: {
      one: {
        id: 'one',
        name: 'One',
        rowCount: 12,
        columnCount: 6,
        cellData: { 0: { 0: { v: 'base', t: 1, fd: 1 } }, 1: { 0: { v: 'below' } } },
      },
      two: { id: 'two', name: 'Two', rowCount: 12, columnCount: 6, cellData: {} },
    },
  };
}
export function doc() {
  const snapshot = getDocsEmptySnapshot('doc');
  snapshot.body = {
    dataStream: 'Hello\r\n',
    paragraphs: [{ startIndex: 5, paragraphId: 'paragraph-1' }],
    sectionBreaks: [{ startIndex: 6, sectionId: 'section-1' }],
  };
  return snapshot;
}
export function write(value: object | null, row = 0, column = 0): Mutation {
  return {
    id: 'sheet.mutation.set-range-values',
    params: {
      unitId: 'book',
      subUnitId: 'one',
      cellValue: { [row]: { [column]: value } },
      trigger: 'sheet.command.set-range-values',
    },
  };
}
export const wire = (edit: SyncRevision): WireRevision => ({
  revision: edit.revision,
  mutations: structuredClone(edit.mutations),
  touched: structuredClone(edit.touched),
  hash: edit.hash,
});

export class MemoryStorage implements SyncStorage {
  unit: SyncUnit;
  readonly history: SyncRevision[] = [];
  constructor(snapshot: NativeSnapshot, kind: DocumentKind) {
    this.unit = {
      unitId: snapshot.id,
      kind,
      revision: 1,
      retainedFrom: 1,
      snapshot: materialize(snapshot, kind),
    };
  }
  load() {
    return structuredClone(this.unit);
  }
  revisions(_unitId: string, after: number, through: number) {
    return structuredClone(
      this.history.filter((edit) => edit.revision > after && edit.revision <= through),
    );
  }
  receipt(_unitId: string, actorId: string, mutationId: string) {
    return structuredClone(
      this.history.find((edit) => edit.actorId === actorId && edit.mutationId === mutationId),
    );
  }
  commit(commit: SyncCommit, guard: () => void) {
    guard();
    if (commit.expectedRevision !== this.unit.revision) throw new Error('Unexpected revision');
    this.unit = structuredClone(commit.unit);
    this.history.push(structuredClone(commit.edit));
  }
}

export function fixture(snapshot: NativeSnapshot = book(), kind: DocumentKind = 'sheet') {
  const storage = new MemoryStorage(snapshot, kind);
  const server = new SyncServer(storage, { authorize() {} });
  const clients: { sync: SyncClient; live: NativeReplica }[] = [];
  let nextId = 0;
  function client(overrides: Partial<SyncClientOptions> = {}) {
    const live = new NativeReplica(storage.unit.snapshot, kind);
    const outgoing: OutgoingFrame[] = [];
    const states: ClientState[] = [];
    const failures: ClientFailure[] = [];
    const sync = new SyncClient({
      unitId: snapshot.id,
      revision: storage.unit.revision,
      confirmed: new NativeReplica(storage.unit.snapshot, kind),
      applyRemote: (mutations) => live.apply(mutations),
      visibleSnapshot: () => live.snapshot(),
      send: (frame) => outgoing.push(structuredClone(frame)),
      onState: (state) => states.push(state),
      onResync: (reason) => failures.push(reason),
      mutationId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
      batchDelayMs: 100_000,
      ...overrides,
    });
    const result = {
      sync,
      live,
      outgoing,
      states,
      failures,
      edit(mutations: Mutation[]) {
        live.apply(mutations);
        sync.enqueue(mutations);
      },
      resume() {
        sync.setConnected(true);
        sync.receive({
          type: 'resume',
          version: 1,
          unitId: snapshot.id,
          fromRevision: sync.confirmedRevision,
          revision: storage.unit.revision,
          edits: storage.history.filter((edit) => edit.revision > sync.confirmedRevision).map(wire),
        });
      },
      submits() {
        return outgoing.filter((frame): frame is SubmitFrame => frame.type === 'submit');
      },
    };
    clients.push(result);
    return result;
  }
  return {
    storage,
    server,
    client,
    async accept(request: SubmitFrame, actorId = 'a') {
      return server.submit(
        { ...structuredClone(request), unitId: snapshot.id, actorId },
        undefined,
      );
    },
    close() {
      for (const client of clients) {
        client.sync.dispose();
        client.live.dispose();
      }
      server.close();
    },
  };
}

export async function turns() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

export function comparable(snapshot: NativeSnapshot): unknown {
  if (!('sheets' in snapshot))
    return {
      ...snapshot,
      rev: undefined,
      body: normalizedDocBody(snapshot.body),
    };
  const sheets = Object.fromEntries(
    Object.entries(snapshot.sheets).map(([sheetId, sheet]) => [
      sheetId,
      {
        ...sheet,
        cellData: Object.fromEntries(
          Object.entries(sheet.cellData ?? {})
            .map(([r, columns]) => [
              r,
              Object.fromEntries(
                Object.entries(columns ?? {}).flatMap(([c]) => {
                  const value = normalizedCell(
                    inlineSnapshotCell(snapshot, { sheetId, row: Number(r), column: Number(c) }),
                  );
                  return value ? [[c, value]] : [];
                }),
              ),
            ])
            .filter(([, row]) => Object.keys(row as object).length),
        ),
      },
    ]),
  );
  return { ...snapshot, rev: undefined, styles: {}, sheets };
}
