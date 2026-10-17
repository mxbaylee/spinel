export const ITEM_KINDS = ['folder', 'sheet', 'doc', 'slides'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export interface WorkspaceItem {
  id: string;
  parentId: string | null;
  kind: ItemKind;
  name: string;
  createdAt: number;
  updatedAt: number;
}
export const kindLabel: Record<ItemKind, string> = {
  folder: 'Folder',
  sheet: 'Sheet',
  doc: 'Doc',
  slides: 'Slides',
};
