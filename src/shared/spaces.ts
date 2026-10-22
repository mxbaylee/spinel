import type { ItemAccess, ItemKind } from './workspace.ts';

/** Browser projections only. Every server operation resolves current access again. */
export interface SpaceRoot {
  id: string;
  parentId: string | null;
  spaceId: null;
  kind: 'space';
  position: null;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceNode {
  id: string;
  parentId: string;
  spaceId: string;
  kind: ItemKind;
  position: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceTreeData {
  space: SpaceRoot;
  access: ItemAccess;
  items: SpaceNode[];
}

export interface SpaceBootstrap {
  spaces: { space: SpaceRoot; access: ItemAccess }[];
  folders: { id: string; name: string; parentId: string | null }[];
}

export interface SpaceRecoveryItem {
  id: string;
  kind: ItemKind;
  name: string;
  trashedAt: number;
  descendantCount: number;
  originalLocation: { id: string; name: string } | null;
}

export interface SpaceTrashListing {
  access: 'owner' | 'editor';
  items: SpaceRecoveryItem[];
}

export interface SpaceRestoreResult {
  item: SpaceNode;
  restoredCount: number;
  destination: 'original' | 'space-root';
  reason?: 'original-location-unavailable';
}

export interface SpaceDeletePreview {
  root: { id: string; name: string; kind: ItemKind };
  counts: { total: number; docs: number; sheets: number; folders: number };
  items: { id: string; name: string; kind: ItemKind }[];
  version: string;
}
