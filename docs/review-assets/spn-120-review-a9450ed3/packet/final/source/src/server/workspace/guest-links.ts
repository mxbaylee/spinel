import type { GuestLinkEntry, GuestLinkExpiryDays } from '../../shared/guestLinks.ts';
import type { FileItem, GuestRole } from '../../shared/workspace.ts';
import { AuthError } from '../auth/store.ts';
import { WorkspaceFiles } from './files.ts';
import type { WorkspaceStore } from './store.ts';

/** Account-only inventory, separate from delegated per-file sharing controls. */
export class GuestLinks {
  private readonly workspace: WorkspaceStore;
  private readonly files: WorkspaceFiles;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
    this.files = new WorkspaceFiles(workspace);
  }
  private entry(item: FileItem): GuestLinkEntry | undefined {
    if (item.kind === 'folder') return undefined;
    // Every caller has just resolved this owned live FileItem. Repeating a
    // separate ancestry walk per row would defeat the catalog's shared budget.
    const link = this.workspace.auth.database
      .prepare(
        'SELECT epoch,state,role,enabled_at AS enabledAt,expires_at AS expiresAt FROM workspace_links WHERE item_id=?',
      )
      .get(item.id) as
      | {
          epoch: number;
          state: string;
          role: GuestRole;
          enabledAt: number | null;
          expiresAt: number | null;
        }
      | undefined;
    if (!link) return undefined;
    const expired = link.expiresAt !== null && link.expiresAt <= this.workspace.auth.now();
    if (link.state !== 'active' && !expired) return undefined;
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      role: link.role,
      epoch: link.epoch,
      enabledAt: link.enabledAt,
      expiresAt: link.expiresAt,
      status: expired ? 'expired' : 'active',
    };
  }
  list(user: string): GuestLinkEntry[] {
    return this.workspace.auth.transaction(() =>
      this.files.list(user).flatMap((item) => {
        const entry = this.entry(item);
        return entry ? [entry] : [];
      }),
    );
  }
  owned(user: string, id: string) {
    const item = this.files.get(user, id, 'owner');
    if (item.kind === 'folder') throw new AuthError(404, 'This guest link is not available.');
    return item;
  }
  changeExpiry(
    user: string,
    id: string,
    epoch: number,
    expectedExpiresAt: number | null,
    expiryDays: GuestLinkExpiryDays,
  ) {
    return this.workspace.auth.transaction(() => {
      const item = this.owned(user, id);
      this.workspace.links.changeExpiry(id, epoch, expiryDays, expectedExpiresAt);
      return this.entry(item)!;
    });
  }
}
