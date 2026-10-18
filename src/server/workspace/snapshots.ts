import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from './store.ts';

export function commitSnapshot(
  workspace: WorkspaceStore,
  table: 'sheet_snapshots' | 'doc_snapshots',
  id: string,
  text: string,
  revision: number,
  writeId: string,
) {
  return workspace.auth.transaction(() => {
    const db = workspace.auth.database;
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_collaboration'",
        )
        .get() &&
      db.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id)
    )
      throw new AuthError(
        409,
        'This document now uses live collaboration. Keep this tab open and copy unsaved changes before reloading.',
      );
    const current = workspace.auth.database
      .prepare(`SELECT snapshot, revision, write_id FROM ${table} WHERE item_id=?`)
      .get(id) as { snapshot: string; revision: number; write_id: string } | undefined;
    // Preserve the SPN-007 lost-acknowledgement contract for every native editor.
    if (current?.write_id === writeId && current.snapshot === text)
      return { revision: current.revision };
    if ((current?.revision ?? 0) !== revision || current?.write_id === writeId)
      throw new AuthError(
        409,
        'Another tab or device saved a newer version. Your changes are not saved. Keep this tab open and copy your changes before reloading.',
      );
    const next = revision + 1;
    workspace.auth.database
      .prepare(
        `INSERT INTO ${table} VALUES(?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET snapshot=excluded.snapshot,revision=excluded.revision,write_id=excluded.write_id`,
      )
      .run(id, text, next, writeId);
    workspace.auth.database
      .prepare('UPDATE workspace_items SET updated_at=? WHERE id=?')
      .run(workspace.auth.now(), id);
    return { revision: next };
  });
}
