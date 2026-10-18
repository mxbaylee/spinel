import type { IWorkbookData } from '@univerjs/core';
import { AuthError } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { commitSnapshot } from './snapshots.ts';

interface SheetRow {
  snapshot: string;
  revision: number;
  write_id: string;
}
export class SheetStore {
  workspace: WorkspaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
    workspace.auth.database.exec(`CREATE TABLE IF NOT EXISTS sheet_snapshots (
      item_id TEXT PRIMARY KEY REFERENCES workspace_items(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL, revision INTEGER NOT NULL, write_id TEXT NOT NULL
    ) STRICT;`);
  }
  sheet(owner: string, id: string) {
    const item = this.workspace.get(owner, id);
    if (item.kind !== 'sheet') throw new AuthError(400, 'This item is not a spreadsheet.');
    return item;
  }
  row(id: string) {
    return this.workspace.auth.database
      .prepare('SELECT snapshot,revision,write_id FROM sheet_snapshots WHERE item_id=?')
      .get(id) as unknown as SheetRow | undefined;
  }
  load(owner: string, id: string) {
    this.sheet(owner, id);
    const row = this.row(id);
    return {
      snapshot: row ? (JSON.parse(row.snapshot) as IWorkbookData) : null,
      revision: row?.revision ?? 0,
    };
  }
  save(
    owner: string,
    id: string,
    input: { snapshot?: unknown; revision?: unknown; writeId?: unknown },
  ) {
    this.sheet(owner, id);
    const { snapshot, revision, writeId } = input;
    if (
      !Number.isSafeInteger(revision) ||
      (revision as number) < 0 ||
      typeof writeId !== 'string' ||
      !/^[\da-f-]{36}$/i.test(writeId)
    )
      throw new AuthError(400, 'Invalid save request. Changes have not been saved.');
    const data = snapshot as IWorkbookData | null;
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      data.id !== id ||
      typeof data.name !== 'string' ||
      !Array.isArray(data.sheetOrder) ||
      !data.sheetOrder.length ||
      !data.sheets ||
      typeof data.sheets !== 'object' ||
      Array.isArray(data.sheets) ||
      new Set(data.sheetOrder).size !== data.sheetOrder.length ||
      data.sheetOrder.some(
        (sheetId) =>
          typeof sheetId !== 'string' ||
          !Object.hasOwn(data.sheets, sheetId) ||
          data.sheets[sheetId]?.id !== sheetId,
      )
    )
      throw new AuthError(400, 'Invalid spreadsheet data. Changes have not been saved.');
    const text = JSON.stringify(snapshot);
    if (Buffer.byteLength(text) > 10 * 1024 * 1024)
      throw new AuthError(
        413,
        'This spreadsheet is too large to save. Changes have not been saved.',
      );
    return commitSnapshot(this.workspace, 'sheet_snapshots', id, text, revision as number, writeId);
  }
}
