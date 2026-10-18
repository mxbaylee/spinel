export const ITEM_KINDS = ['folder', 'sheet', 'doc', 'slides'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type GrantRole = 'viewer' | 'editor';
export type ItemAccess = GrantRole | 'owner';
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
}
export const kindLabel: Record<ItemKind, string> = {
  folder: 'Folder',
  sheet: 'Sheet',
  doc: 'Doc',
  slides: 'Slides',
};

export interface TrashedItem extends WorkspaceItem {
  trashedAt: number;
  expiresAt: number;
}
export interface TrashListing {
  items: TrashedItem[];
  version: string;
}
