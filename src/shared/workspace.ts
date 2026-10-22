export const ITEM_KINDS = ['folder', 'sheet', 'doc'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type GuestRole = 'viewer' | 'editor';
export type GrantRole = GuestRole | 'admin';
export type ItemAccess = GrantRole | 'owner';
export const canAdminister = (access: ItemAccess | undefined) =>
  access === 'owner' || access === 'admin';
export const accessLabel = (access: ItemAccess) =>
  access === 'owner'
    ? 'Owner'
    : access === 'admin'
      ? 'File admin'
      : access === 'editor'
        ? 'Can edit'
        : 'View only';
export interface SharePerson {
  id: string;
  name: string;
  disabled: number;
  directRole: GrantRole | null;
  effectiveRole: GrantRole | null;
}
export interface WorkspaceItem {
  access: ItemAccess;
  id: string;
  parentId: string | null;
  kind: ItemKind;
  name: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  ownerName?: string;
  sharedAt?: number;
  placementParentId?: string | null;
}
/** Outer file metadata only; Space members keep the narrower native item union. */
export type SpaceFile = Omit<WorkspaceItem, 'kind'> & { kind: 'space' };
export type FileItem = WorkspaceItem | SpaceFile;
export const FILE_KINDS = [...ITEM_KINDS, 'space'] as const;
export type FileKind = FileItem['kind'];
export const kindLabel: Record<ItemKind, string> = {
  folder: 'Folder',
  sheet: 'Sheet',
  doc: 'Doc',
};
export const fileKindLabel: Record<FileKind, string> = { ...kindLabel, space: 'Space' };

export type TrashedItem = FileItem & {
  trashedAt: number;
  /** Space recovery groups are retained until explicitly deleted. */
  expiresAt: number | null;
};
export interface TrashListing {
  items: TrashedItem[];
  version: string;
  /** The complete exact deletion preview, including retained Space contents. */
  deletion?: {
    count: number;
    items: { id: string; name: string; kind: FileKind }[];
  };
}
