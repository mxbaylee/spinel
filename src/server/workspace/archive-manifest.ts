import { ARCHIVE_ITEM_LIMIT, ARCHIVE_MANIFEST_LIMIT } from '../../shared/archive.ts';
import type { FileKind } from '../../shared/workspace.ts';
import { AuthError } from '../auth/store.ts';
import { classifyOrdinaryItems } from './ordinary-scope.ts';
import { readSpaceStructure } from './space-structure.ts';
import type { WorkspaceStore } from './store.ts';

export const ARCHIVE_MANIFEST = 'spinel-manifest.json';
export interface ArchiveItem {
  id: string;
  parentId: string | null;
  spaceId: string | null;
  position: number | null;
  kind: FileKind;
  name: string;
  createdAt: number;
  updatedAt: number;
  path: string;
}
export interface ArchiveManifest {
  format: 'spinel-archive';
  version: 1;
  exportedAt: number;
  items: ArchiveItem[];
}
type Metadata = Omit<ArchiveItem, 'path'>;
const invalid = () => new AuthError(400, 'Choose a valid, complete Spinel archive.');
const oversized = () =>
  new AuthError(413, 'This archive contains too many items or too much metadata.');
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** The manifest preserves exact names; portable path components add stable collision suffixes. */
function component(item: Metadata) {
  let name = '';
  for (const character of item.name.normalize('NFC').replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')) {
    // Leave room for the UUID inside the single-file importer's 120-character
    // fallback name, including an extracted Doc whose native title is absent.
    if (Buffer.byteLength(name + character) > 80) break;
    name += character;
  }
  name = name.replace(/[. ]+$/g, '');
  return `${name || item.kind}--${item.id}`;
}

/** Validate the entire graph iteratively before making a path or accepting a new item. */
function ordered(items: readonly Metadata[], workspace: WorkspaceStore): Metadata[] {
  if (items.length > ARCHIVE_ITEM_LIMIT) throw oversized();
  const byId = new Map<string, Metadata>();
  const children = new Map<string | null, Metadata[]>();
  for (const item of items) {
    if (
      !object(item) ||
      !uuid(item.id) ||
      byId.has(item.id) ||
      (item.parentId !== null && !uuid(item.parentId)) ||
      (item.spaceId !== null && !uuid(item.spaceId)) ||
      !['folder', 'sheet', 'doc', 'space'].includes(item.kind) ||
      (item.spaceId === null ? item.position !== null : !integer(item.position)) ||
      (item.kind === 'space' && item.spaceId !== null) ||
      !integer(item.createdAt) ||
      !integer(item.updatedAt)
    )
      throw invalid();
    if (workspace.name(item.name) !== item.name) throw invalid();
    byId.set(item.id, item);
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  for (const item of items) {
    if (item.spaceId !== null) {
      const space = byId.get(item.spaceId);
      if (!space || space.kind !== 'space' || space.spaceId !== null) throw invalid();
    }
    if (item.parentId === null) {
      if (item.spaceId !== null) throw invalid();
      continue;
    }
    const parent = byId.get(item.parentId);
    if (!parent) throw invalid();
    if (parent.kind === 'space') {
      if (item.spaceId !== parent.id) throw invalid();
    } else if (parent.spaceId !== null) {
      if (item.spaceId !== parent.spaceId) throw invalid();
    } else if (parent.kind !== 'folder' || item.spaceId !== null) throw invalid();
  }
  for (const siblings of children.values())
    siblings.sort((a, b) =>
      a.spaceId !== null
        ? a.position! - b.position! || a.id.localeCompare(b.id)
        : a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  const result: Metadata[] = [];
  const pending = [...(children.get(null) ?? [])].reverse();
  while (pending.length) {
    const item = pending.pop()!;
    result.push(item);
    const nested = children.get(item.id) ?? [];
    for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]);
  }
  if (result.length !== items.length) throw invalid();
  return result;
}

function paths(items: readonly Metadata[], workspace: WorkspaceStore): ArchiveItem[] {
  const directories = new Map<string, string>();
  let bytes = 0;
  return ordered(items, workspace).map((item) => {
    const prefix = item.parentId === null ? '' : directories.get(item.parentId);
    if (prefix === undefined) throw invalid();
    const name = prefix + component(item);
    const file = item.kind === 'doc' || item.kind === 'sheet';
    // A native Space page may itself have children. Its content and its children
    // share a directory; the manifest retains the page's kind and exact name.
    const directory = `${name}/`;
    const path = file
      ? item.spaceId === null
        ? `${name}.univer.json`
        : `${directory}content.univer.json`
      : directory;
    if (Buffer.byteLength(path) > 0xffff) throw oversized();
    bytes += Buffer.byteLength(path) + Buffer.byteLength(item.name) + 300;
    if (bytes > ARCHIVE_MANIFEST_LIMIT) throw oversized();
    if (!file || item.spaceId !== null) directories.set(item.id, directory);
    return { ...item, path };
  });
}

export function archiveDirectories(items: readonly ArchiveItem[]): string[] {
  return items.flatMap((item) =>
    item.path.endsWith('/')
      ? [item.path]
      : item.spaceId === null
        ? []
        : [item.path.slice(0, item.path.lastIndexOf('/') + 1)],
  );
}

export function parseArchiveManifest(text: string, workspace: WorkspaceStore): ArchiveManifest {
  if (Buffer.byteLength(text) > ARCHIVE_MANIFEST_LIMIT) throw oversized();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (
    !object(value) ||
    Object.keys(value).some((key) => !['format', 'version', 'exportedAt', 'items'].includes(key)) ||
    value.format !== 'spinel-archive' ||
    value.version !== 1 ||
    !integer(value.exportedAt) ||
    !Array.isArray(value.items)
  )
    throw invalid();
  const keys = [
    'id',
    'parentId',
    'spaceId',
    'position',
    'kind',
    'name',
    'createdAt',
    'updatedAt',
    'path',
  ];
  for (const item of value.items)
    if (
      !object(item) ||
      Object.keys(item).length !== keys.length ||
      Object.keys(item).some((key) => !keys.includes(key))
    )
      throw invalid();
  const items = paths(value.items as ArchiveItem[], workspace);
  const original = new Map((value.items as ArchiveItem[]).map((item) => [item.id, item.path]));
  for (const item of items) if (item.path !== original.get(item.id)) throw invalid();
  if (!workspace.spacesEnabled && items.some((item) => item.kind === 'space'))
    throw new AuthError(400, 'Enable Spaces on this instance before importing this archive.');
  return { format: 'spinel-archive', version: 1, exportedAt: value.exportedAt, items };
}

/** Owned discovery never considers placements, grants, guest links or a shared catalog. */
export function ownedArchiveManifest(workspace: WorkspaceStore, user: string): ArchiveManifest {
  return workspace.auth.transaction(() => {
    workspace.owner(user);
    const database = workspace.auth.database;
    const columns = new Set(
      database
        .prepare('PRAGMA table_info(workspace_items)')
        .all()
        .map((row) => row.name),
    );
    const space = columns.has('space_id') ? 'space_id' : 'NULL';
    const position = columns.has('space_position') ? 'space_position' : 'NULL';
    const candidates = database
      .prepare(
        `
      SELECT id,parent_id AS parentId,${space} AS spaceId,${position} AS position,
        kind,name,created_at AS createdAt,updated_at AS updatedAt
      FROM workspace_items WHERE owner_id=? AND trashed_at IS NULL AND trash_batch IS NULL
      LIMIT ?
    `,
      )
      .all(user, ARCHIVE_ITEM_LIMIT + 1) as unknown as Metadata[];
    if (candidates.length > ARCHIVE_ITEM_LIMIT) throw oversized();
    const ordinary = classifyOrdinaryItems(
      database,
      candidates
        .filter((item) => item.kind !== 'space' && item.spaceId === null)
        .map((item) => item.id),
      'live',
    );
    if (!ordinary) throw oversized();
    const items = candidates.filter((item) => ordinary.has(item.id));
    let work = items.length;
    for (const root of candidates) {
      if (
        root.kind !== 'space' ||
        root.spaceId !== null ||
        root.position !== null ||
        (root.parentId !== null && !ordinary.has(root.parentId))
      )
        continue;
      if (!workspace.spacesEnabled)
        throw new AuthError(400, 'Enable Spaces on this instance before exporting all files.');
      // This transaction has established the live root's owner and complete
      // ordinary ancestry. Inspect the all-status graph before projecting live nodes.
      const structure = readSpaceStructure(database, root.id, user);
      work += 1 + structure.items.length;
      if (work > ARCHIVE_ITEM_LIMIT) throw oversized();
      items.push(
        root,
        ...structure.items
          .filter((item) => item.trashedAt === null)
          .map((item) => ({
            id: item.id,
            parentId: item.parentId,
            spaceId: item.spaceId,
            position: item.position,
            kind: item.kind,
            name: item.name,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          })),
      );
    }
    const manifest: ArchiveManifest = {
      format: 'spinel-archive',
      version: 1,
      exportedAt: workspace.auth.now(),
      items: paths(items, workspace),
    };
    if (Buffer.byteLength(JSON.stringify(manifest)) > ARCHIVE_MANIFEST_LIMIT) throw oversized();
    return manifest;
  });
}

/** A complete ZIP is emitted only while its selected owned tree is still live. */
export function verifyArchivePlan(
  workspace: WorkspaceStore,
  user: string,
  items: readonly ArchiveItem[],
) {
  workspace.auth.transaction(() => {
    workspace.owner(user);
    const read = workspace.auth.database.prepare('SELECT * FROM workspace_items WHERE id=?');
    for (const item of items) {
      const row = read.get(item.id);
      if (
        !row ||
        row.owner_id !== user ||
        row.trashed_at !== null ||
        row.trash_batch !== null ||
        row.parent_id !== item.parentId ||
        row.kind !== item.kind ||
        row.name !== item.name ||
        (row.space_id ?? null) !== item.spaceId ||
        (row.space_position ?? null) !== item.position
      )
        throw new AuthError(409, 'Your files changed during export. Start a new archive.');
    }
  });
}
