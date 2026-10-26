import type { ArchiveImportResult, ArchiveTask } from '../src/shared/archive.ts';
import { clearDashboardNavigation } from './dashboardNavigation.ts';

export class ArchiveRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function archiveRequest<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(`/api/items/${path}`, {
    credentials: 'same-origin',
    ...options,
  });
  options.signal?.throwIfAborted();
  if (response.status === 401 && !options.keepalive) {
    clearDashboardNavigation();
    location.assign('/sign-in');
  }
  const body = await response.json();
  options.signal?.throwIfAborted();
  if (!response.ok)
    throw new ArchiveRequestError(
      body.error ?? 'This archive request could not be completed. Try again.',
      response.status,
    );
  return body;
}

export const startArchiveExport = (signal: AbortSignal) =>
  archiveRequest<{ task: ArchiveTask }>('archive-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  });

export const readArchiveExport = (id: string, signal: AbortSignal) =>
  archiveRequest<{ task: ArchiveTask }>(`archive-export/${encodeURIComponent(id)}`, { signal });

export const cancelArchiveExport = (id: string, signal?: AbortSignal, keepalive = false) =>
  archiveRequest<{ task: ArchiveTask }>(`archive-export/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal,
    keepalive,
  });

export const importWorkspaceArchive = (file: File, signal: AbortSignal) =>
  archiveRequest<{ result: ArchiveImportResult }>('archive-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
    signal,
  });

/** Let the browser stream the download; never materialize the archive in a Blob. */
export function downloadWorkspaceArchive(task: ArchiveTask) {
  const expected = `/api/items/archive-export/${encodeURIComponent(task.id)}/download`;
  const address = new URL(task.downloadUrl, location.href);
  if (
    address.origin !== location.origin ||
    address.pathname !== expected ||
    address.search ||
    address.hash
  )
    throw new ArchiveRequestError('Could not start this archive download. Try again.', 400);
  const link = document.createElement('a');
  link.href = address.href;
  link.download = 'spinel-files.zip';
  document.body.append(link);
  link.click();
  link.remove();
}
