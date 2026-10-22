import type { SpaceFile } from '../../src/shared/workspace.ts';
import type { SpaceLocation } from '../spaceNavigation.ts';
import type { LocalStart } from './localStart.ts';
import type { OfflineDownload } from './offlineStore.ts';

/** A prepared child stays attached to the exact Space that authorized its copy. */
export function spaceCopies(downloads: Iterable<OfflineDownload>, spaceId: string) {
  return [...downloads]
    .filter(
      (download) =>
        download.spaceId === spaceId &&
        download.itemId !== spaceId &&
        typeof download.itemId === 'string' &&
        Boolean(download.itemId) &&
        (download.kind === 'doc' || download.kind === 'sheet'),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.itemId.localeCompare(right.itemId),
    );
}

export type OfflineSpaceSelection = {
  spaceId: string | null;
  root: SpaceFile | null;
  copies: OfflineDownload[];
  selected: OfflineDownload | null;
  problem: 'account' | 'index' | 'route' | 'trash' | 'missing' | 'empty' | null;
};

/** No explicit link may fall back to a different prepared document or account. */
export function selectOfflineSpace(
  local: LocalStart,
  accountId: string,
  route: SpaceLocation,
): OfflineSpaceSelection {
  const empty = { spaceId: null, root: null, copies: [], selected: null };
  if (local.user.id !== accountId) return { ...empty, problem: 'account' };
  if (route.kind === 'index') return { ...empty, problem: 'index' };
  if (route.kind === 'unavailable') return { ...empty, problem: 'route' };
  const { spaceId, selection } = route;
  const metadata = [
    ...local.catalog.items,
    ...local.catalog.shared,
    ...Object.values(local.catalog.views).flat(),
  ];
  const root =
    metadata.find((item): item is SpaceFile => item.kind === 'space' && item.id === spaceId) ??
    null;
  const copies = spaceCopies(local.downloads, spaceId);
  const scoped = { spaceId, root, copies, selected: null };
  if (selection.kind === 'trash') return { ...scoped, problem: 'trash' };
  if (selection.kind === 'page') {
    const selected = copies.find((copy) => copy.itemId === selection.id) ?? null;
    return { ...scoped, selected, problem: selected ? null : 'missing' };
  }
  const selected = copies[0] ?? null;
  return { ...scoped, selected, problem: selected ? null : 'empty' };
}
