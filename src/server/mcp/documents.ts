import { createHash } from 'node:crypto';
import { JSONX, TextX } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { UniverType } from '@univerjs/protocol';
import type { IChangeset } from '@univerjs/protocol';
import { AuthError } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { currentMcpIdentity } from '../auth/mcpIdentity.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { WorkspaceSearch } from '../workspace/search.ts';

export type TokenIdentity = {
  id: string;
  userId: string;
  hash: string;
  connectionId?: string;
  resource?: string;
};
const credentialData = (identity: TokenIdentity) => ({
  mcpTokenHash: identity.hash,
  ...(identity.connectionId
    ? { mcpConnectionId: identity.connectionId, mcpResource: identity.resource }
    : {}),
});
type Input = Record<string, unknown>;
// Document control characters identify structural objects; only paragraph breaks are editable.
// eslint-disable-next-line no-control-regex
const structuralMarkers = /[\x00-\x0c\x0e-\x1f]/;
const invalid = () => new AuthError(400, 'Invalid tool arguments.');
const changed = () => new AuthError(409, 'The document changed. Read it again before editing.');
export function object(value: unknown, keys: string[]): Input {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw invalid();
  return value as Input;
}
export function text(value: unknown, max = 100) {
  if (typeof value !== 'string' || !value || value.length > max) throw invalid();
  return value;
}
function integer(value: unknown, min: number, max: number, fallback?: number) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max) throw invalid();
  return n;
}

/** Tools expose plain content, not private plugin resources, image URLs or snapshot writers. */
export class McpDocuments {
  private readonly workspace: WorkspaceStore;
  private readonly collaboration: CollaborationStore;
  constructor(workspace: WorkspaceStore, collaboration: CollaborationStore) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    new AccessTokens(workspace.auth);
    workspace.auth.database.exec(`CREATE TABLE IF NOT EXISTS mcp_writes (
      actor_id TEXT NOT NULL,
      request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(actor_id,request_id)
    ) STRICT;`);
  }
  verify(identity: TokenIdentity, edit = false) {
    if (
      currentMcpIdentity(this.workspace.auth, credentialData(identity), edit).userId !==
      identity.userId
    )
      throw new AuthError(401, 'This access token is no longer available.');
  }
  list(identity: TokenIdentity, input: unknown) {
    this.verify(identity);
    const args = object(input, ['after']);
    const after = args.after === undefined ? '' : text(args.after);
    const items = new WorkspaceSearch(this.workspace)
      .find(identity.userId, {})
      .filter((item) => item.kind === 'sheet' || item.kind === 'doc')
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((item) => item.id > after);
    const page = items
      .slice(0, 100)
      .map(({ id, name, kind, access }) => ({ id, name, kind, access }));
    return { documents: page, next: items.length > 100 ? page.at(-1)!.id : null };
  }
  private async load(identity: TokenIdentity, id: string) {
    this.verify(identity);
    this.workspace.get(identity.userId, id);
    await this.collaboration.prepare(identity.userId, id);
    this.verify(identity);
    const generation = this.collaboration.generations.active(id);
    const loaded = await this.collaboration.load(identity.userId, id);
    this.verify(identity);
    if (
      this.collaboration.generations.active(id).unitId !== generation.unitId ||
      this.collaboration.generations.restoring(id)
    )
      throw changed();
    return {
      ...loaded,
      unitId: generation.unitId,
      offset: generation.offset,
      kind: this.workspace.get(identity.userId, id).kind,
    };
  }
  async readSheet(identity: TokenIdentity, input: unknown) {
    const args = object(input, ['id', 'sheetId', 'row', 'column', 'rows', 'columns']);
    const loaded = await this.load(identity, text(args.id));
    if (loaded.kind !== 'sheet') throw invalid();
    const snapshot = loaded.snapshot as IWorkbookData;
    const sheetId = args.sheetId === undefined ? snapshot.sheetOrder[0] : text(args.sheetId);
    const sheet = snapshot.sheets[sheetId];
    if (!sheet) throw invalid();
    const rowCount = sheet.rowCount ?? 1000,
      columnCount = sheet.columnCount ?? 26;
    const row = integer(args.row, 0, rowCount - 1, 0),
      column = integer(args.column, 0, columnCount - 1, 0);
    const rows = integer(args.rows, 1, 100, Math.min(20, rowCount - row));
    const columns = integer(args.columns, 1, 100, Math.min(10, columnCount - column));
    if (rows * columns > 1000 || row + rows > rowCount || column + columns > columnCount)
      throw invalid();
    const cells = [];
    for (let r = row; r < row + rows; r++)
      for (let c = column; c < column + columns; c++) {
        const cell = sheet.cellData?.[r]?.[c];
        if (cell)
          cells.push({
            row: r,
            column: c,
            value: cell.v ?? null,
            formula: cell.f ?? null,
            text: cell.p?.body?.dataStream ?? null,
          });
      }
    return this.bounded({
      unitId: loaded.unitId,
      revision: loaded.revision,
      access: loaded.access,
      worksheets: snapshot.sheetOrder.map((id) => ({
        id,
        name: snapshot.sheets[id].name,
        rows: snapshot.sheets[id].rowCount ?? 1000,
        columns: snapshot.sheets[id].columnCount ?? 26,
      })),
      sheetId,
      row,
      column,
      rows,
      columns,
      cells,
    });
  }
  async readDoc(identity: TokenIdentity, input: unknown) {
    const args = object(input, ['id', 'offset', 'limit']);
    const loaded = await this.load(identity, text(args.id));
    if (loaded.kind !== 'doc') throw invalid();
    const content = (loaded.snapshot as IDocumentData).body?.dataStream ?? '';
    const length = Math.max(0, content.length - 2);
    const offset = integer(args.offset, 0, length, 0),
      limit = integer(args.limit, 1, 20000, 10000);
    const end = Math.min(length, offset + limit);
    return {
      unitId: loaded.unitId,
      revision: loaded.revision,
      access: loaded.access,
      offset,
      text: content.slice(offset, end),
      length,
      next: end < length ? end : null,
    };
  }
  private bounded<T>(value: T): T {
    if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024)
      throw new AuthError(413, 'This result is too large. Request fewer cells.');
    return value;
  }
  async edit(identity: TokenIdentity, kind: 'sheet' | 'doc', input: unknown) {
    const args = object(input, [
      'id',
      'unitId',
      'revision',
      'requestId',
      ...(kind === 'sheet' ? ['sheetId', 'cells'] : ['offset', 'deleteCount', 'text']),
    ]);
    const id = text(args.id),
      unitId = text(args.unitId),
      requestId = text(args.requestId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
      throw invalid();
    const revision = integer(args.revision, 1, Number.MAX_SAFE_INTEGER);
    // Normalize arguments before fingerprinting so JSON property order never changes retry identity.
    let mutation: { id: string; data: string };
    let validate: (snapshot: IWorkbookData | IDocumentData) => void;
    if (kind === 'sheet') {
      const sheetId = text(args.sheetId);
      if (!Array.isArray(args.cells) || !args.cells.length || args.cells.length > 100)
        throw invalid();
      const cells = args.cells
        .map((value) => {
          const cell = object(value, ['row', 'column', 'value']);
          const row = integer(cell.row, 0, 99999),
            column = integer(cell.column, 0, 1023),
            v = cell.value;
          if (
            v !== null &&
            typeof v !== 'boolean' &&
            !(typeof v === 'number' && Number.isFinite(v)) &&
            !(typeof v === 'string' && v.length <= 10000)
          )
            throw invalid();
          return { row, column, value: v as string | number | boolean | null };
        })
        .sort((a, b) => a.row - b.row || a.column - b.column);
      const cellValue: Record<number, Record<number, unknown>> = {};
      for (const cell of cells) {
        const row = (cellValue[cell.row] ??= {});
        if (Object.hasOwn(row, cell.column)) throw invalid();
        // Explicitly clear a previous formula/rich body while preserving unrelated cell styles.
        row[cell.column] = {
          v: cell.value,
          f: null,
          si: null,
          ft: null,
          fd: null,
          ref: null,
          xf: null,
          p: null,
          t:
            typeof cell.value === 'string'
              ? 1
              : typeof cell.value === 'number'
                ? 2
                : typeof cell.value === 'boolean'
                  ? 3
                  : null,
        };
      }
      mutation = {
        id: SetRangeValuesMutation.id,
        data: JSON.stringify({ unitId, subUnitId: sheetId, cellValue }),
      };
      validate = (snapshot) => {
        const sheet = (snapshot as IWorkbookData).sheets[sheetId];
        if (
          !sheet ||
          cells.some(
            (cell) =>
              cell.row >= (sheet.rowCount ?? 1000) || cell.column >= (sheet.columnCount ?? 26),
          )
        )
          throw invalid();
      };
    } else {
      const offset = integer(args.offset, 0, 1000000),
        deleteCount = integer(args.deleteCount, 0, 10000, 0);
      if (typeof args.text !== 'string' || args.text.length > 10000) throw invalid();
      const inserted = args.text.replace(/\r\n|\n/g, '\r');
      if ((!deleteCount && !inserted) || structuralMarkers.test(inserted)) throw invalid();
      const change = new TextX();
      if (offset) change.retain(offset);
      if (deleteCount) change.delete(deleteCount);
      if (inserted)
        change.insert(inserted.length, {
          dataStream: inserted,
          paragraphs: [...inserted.matchAll(/\r/g)].map((match) => ({
            startIndex: match.index,
            paragraphId: `${requestId}:${match.index}`,
          })),
        });
      mutation = {
        id: RichTextEditingMutation.id,
        data: JSON.stringify({
          unitId,
          actions: new JSONX().editOp(change.serialize()),
          textRanges: [],
        }),
      };
      validate = (snapshot) => {
        const body = (snapshot as IDocumentData).body;
        const content = body?.dataStream;
        if (
          !content ||
          offset + deleteCount > content.length - 2 ||
          structuralMarkers.test(content.slice(offset, offset + deleteCount))
        )
          throw invalid();
        // Formula objects are atomic source expressions. A plain-text tool can
        // replace a whole object, but cannot leave a partially edited annotation.
        for (const range of body?.customRanges ?? []) {
          if (!range.properties || !Object.hasOwn(range.properties, 'spinelFormula')) continue;
          const start = range.startIndex;
          const end = range.endIndex + 1;
          if (
            (offset > start && offset < end) ||
            (offset + deleteCount > start && offset + deleteCount < end)
          )
            throw new AuthError(400, 'Replace the entire formula, or edit it in Spinel.');
        }
        // UTF-16 offsets cannot split an existing surrogate pair.
        for (const at of [offset, offset + deleteCount])
          if (
            at > 0 &&
            /[\uD800-\uDBFF]/.test(content[at - 1]) &&
            /[\uDC00-\uDFFF]/.test(content[at])
          )
            throw invalid();
      };
    }
    if (Buffer.byteLength(mutation.data) > 64 * 1024)
      throw new AuthError(413, 'Use a smaller edit.');
    this.verify(identity, true);
    const actor = identity.connectionId ? `oauth:${identity.connectionId}` : `token:${identity.id}`;
    const item = this.workspace.get(identity.userId, id, 'edit');
    const generation = this.collaboration.generations.active(id);
    if (
      item.kind !== kind ||
      generation.unitId !== unitId ||
      this.collaboration.generations.restoring(id)
    )
      throw changed();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ id, unitId, revision, mutation }))
      .digest('hex');
    const db = this.workspace.auth.database;
    const prior = db
      .prepare('SELECT payload_hash FROM mcp_writes WHERE actor_id=? AND request_id=?')
      .get(actor, requestId);
    if (prior && prior.payload_hash !== fingerprint)
      throw new AuthError(409, 'This request ID was used for a different edit.');
    if (!prior) {
      const current = await this.load(identity, id);
      if (current.unitId !== unitId || current.revision !== revision) throw changed();
      validate(current.snapshot);
      this.verify(identity, true);
      this.workspace.get(identity.userId, id, 'edit');
      this.workspace.auth.transaction(() => {
        // Retain fingerprints for 30 days. An older retry still cannot reapply at its stale revision.
        db.prepare('DELETE FROM mcp_writes WHERE created_at<?').run(
          this.workspace.auth.now() - 30 * 24 * 60 * 60_000,
        );
        if (Number(db.prepare('SELECT count(*) AS n FROM mcp_writes').get()!.n) >= 100000)
          throw new AuthError(429, 'Too many recent assistant edits. Try again later.');
        db.prepare('INSERT OR IGNORE INTO mcp_writes VALUES(?,?,?,?)').run(
          actor,
          requestId,
          fingerprint,
          this.workspace.auth.now(),
        );
        if (
          db
            .prepare('SELECT payload_hash FROM mcp_writes WHERE actor_id=? AND request_id=?')
            .get(actor, requestId)!.payload_hash !== fingerprint
        )
          throw new AuthError(409, 'This request ID was used for a different edit.');
      });
    }
    const changeset: IChangeset = {
      unitID: unitId,
      type: kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC,
      baseRev: revision - generation.offset,
      revision: 0,
      userID: identity.userId,
      memberID: `mcp:${actor}`,
      sid: `mcp:${actor}:${requestId}`,
      reqId: 1,
      mutations: [mutation],
    };
    const result = await this.collaboration.service.submitChangeset(
      { changeset },
      {
        userID: identity.userId,
        memberID: changeset.memberID,
        customData: credentialData(identity),
      },
    );
    this.verify(identity, true);
    this.workspace.get(identity.userId, id, 'edit');
    if (result.status === 'rejected' || result.status === 'retry')
      throw new AuthError(409, result.error.message);
    if (this.collaboration.generations.active(id).unitId !== unitId) throw changed();
    return {
      unitId,
      revision: result.changeset.revision + generation.offset,
      requestId,
      status: result.status,
    };
  }
}
