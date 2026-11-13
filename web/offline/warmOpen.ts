import type { FileItem } from '../../src/shared/workspace.ts';

export type WarmFailureView =
  /** Reuse the saved folder listing prepared earlier on this device. */
  | { kind: 'folder'; rows: FileItem[] }
  /** Open the downloaded Doc or Sheet from this device instead of the server. */
  | { kind: 'device'; rows: FileItem[] }
  | null;

/**
 * A warm Dashboard can lose its connection after it listed or prepared an item.
 * Decide what an item's failed server request may show instead of "not available".
 * Only a failed network round trip qualifies, and only for the prepared account;
 * a real server answer (denied, missing) stays authoritative even with cached rows.
 */
export function viewAfterNetworkFailure(input: {
  networkFailure: boolean;
  accountId: string;
  preparedAccountId: string | null;
  currentId: string;
  /** The folder listing saved for `currentId` itself, when one exists. */
  saved: FileItem[] | undefined;
  /** Every saved view on this Dashboard (ancestors, a folder, its children). */
  views: FileItem[][];
  /** Every other row this Dashboard already lists. */
  rows: FileItem[];
  /** Whether this device holds a usable downloaded copy of `currentId`. */
  downloaded: boolean;
}): WarmFailureView {
  if (!input.networkFailure || input.preparedAccountId !== input.accountId) return null;
  if (input.saved?.some((item) => item.id === input.currentId && item.kind === 'folder'))
    return { kind: 'folder', rows: input.saved };
  if (!input.downloaded) return null;
  const isDownloadable = (row: FileItem) =>
    row.id === input.currentId && (row.kind === 'doc' || row.kind === 'sheet');
  // The saved view that lists the item also carries its ancestors, so the frame
  // keeps its parent context offline; otherwise only the known row itself is used.
  const parent = input.views.find((view) => view.some(isDownloadable));
  if (parent) return { kind: 'device', rows: parent };
  const item = input.rows.find(isDownloadable);
  return item ? { kind: 'device', rows: [item] } : null;
}

/** A saved download counts unless the device marked it unavailable. */
export const hasUsableCopy = (copy: { available?: boolean } | undefined): boolean =>
  Boolean(copy && copy.available !== false);

/**
 * A request that hung until its own deadline never reached the server, so it is as
 * much an outage as a fast failure (captive Wi-Fi, a stalled radio).
 */
export const isRequestTimeout = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'TimeoutError';
