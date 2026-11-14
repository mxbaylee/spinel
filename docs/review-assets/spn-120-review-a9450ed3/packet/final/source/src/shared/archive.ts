/** Archive totals may exceed the server's memory budget; members are processed one at a time. */
export const ARCHIVE_LIMIT = 8 * 1024 * 1024 * 1024;
export const ARCHIVE_ITEM_LIMIT = 10_000;
export const ARCHIVE_MANIFEST_LIMIT = 8 * 1024 * 1024;

export type ArchiveTask = {
  id: string;
  state: 'ready' | 'exporting' | 'completed' | 'failed' | 'cancelled';
  completed: number;
  total: number | null;
  downloadUrl: string;
  error?: string;
};

export type ArchiveImportResult = {
  items: number;
  files: number;
  folders: number;
  spaces: number;
};
