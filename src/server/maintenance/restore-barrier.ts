import { lstatSync } from 'node:fs';

export const restoreBarrierPath = (databasePath: string) => `${databasePath}.restore-pending`;

/** An interrupted in-place restore may retain the same inode and pass quick_check.
 * Only supervised restore completion can remove this durable opening barrier.
 * Any object at this path, including a malformed file or symlink, closes admission.
 */
export function assertNoPendingRestore(databasePath: string) {
  try {
    lstatSync(restoreBarrierPath(databasePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('An unfinished workspace restore requires supervised recovery before opening.');
}
