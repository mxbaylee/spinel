import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { uuidPattern } from './journal.ts';
import type { RecoveryJournal } from './journal.ts';
import { isCommittedRestoreJob } from './restore-jobs.ts';
import type { RestoreJobRecord, RestoreJobs } from './restore-jobs.ts';

/** Resolved (committed or recovered) restores kept newest first. Older ones are
 * removed oldest first. See docs/backups.md for the capacity this implies. */
export const RESTORE_EVIDENCE_KEEP = 8;

export type RestorePruneRefusal = 'unresolved' | 'referenced' | 'ambiguous';
export interface RestorePruneResult {
  /** IDs whose evidence and journal record are both gone, oldest first. */
  removed: string[];
  /** Why the run stopped before removing every eligible restore, if it did. */
  refused?: RestorePruneRefusal;
}

const tombstoneName = /^([0-9a-f-]{36})\.(evidence|job)$/;
const refused = () => new Error('Restore evidence pruning refused an unexpected state.');

const resolvedOrder = (a: RestoreJobRecord, b: RestoreJobRecord) =>
  a.updatedAt - b.updatedAt ||
  a.intent.confirmedAt - b.intent.confirmedAt ||
  (a.intent.id < b.intent.id ? -1 : a.intent.id > b.intent.id ? 1 : 0);

/** Pure policy: which resolved restores fall outside the keep window, oldest
 * first. Unresolved records never appear. The caller adds the safety gates. */
export function selectRestorePrune(
  records: readonly RestoreJobRecord[],
  protectedIds: ReadonlySet<string> = new Set(),
  keep = RESTORE_EVIDENCE_KEEP,
) {
  const resolved = records.filter(isCommittedRestoreJob).sort(resolvedOrder);
  return resolved
    .slice(0, Math.max(0, resolved.length - keep))
    .filter((record) => !protectedIds.has(record.intent.id));
}

function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function exists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function ownedDirectory(path: string) {
  const info = lstatSync(path);
  return (
    info.isDirectory() &&
    !info.isSymbolicLink() &&
    info.uid === process.getuid!() &&
    (info.mode & 0o077) === 0
  );
}

/**
 * Remove resolved restore evidence past the keep window, with its journal
 * record, oldest first. The caller holds the journal's kernel lock and the
 * supervisor serial queue, exactly as for every other RestoreJobs mutation.
 *
 * Each restore moves by atomic renames into `restore-pruned/` (evidence first,
 * then the record) and the tombstones are deleted afterwards. Every durable step
 * ends with one `journal.syncRoot()`. A run that was interrupted at any step is
 * rolled forward here before anything new is selected: everything in
 * `restore-pruned/` is a tombstone, and a resolved record whose evidence
 * tombstone exists loses its record too.
 */
export function pruneRestoreEvidence(
  journal: RecoveryJournal,
  jobs: RestoreJobs,
  keep = RESTORE_EVIDENCE_KEEP,
): RestorePruneResult {
  journal.checkRoot();
  const pruned = journal.path('restore-pruned');
  const tombstones = () => {
    if (!exists(pruned)) return [];
    if (!ownedDirectory(pruned)) throw refused();
    const names = readdirSync(pruned);
    if (names.length > 4 || names.some((name) => !tombstoneName.test(name))) throw refused();
    return names;
  };
  const deleteTombstones = () => {
    for (const name of tombstones().sort()) {
      rmSync(`${pruned}/${name}`, { recursive: true, force: false });
      syncDirectory(pruned);
      journal.syncRoot();
    }
  };
  const removed: string[] = [];
  const inventory = () => {
    const records = jobs.list();
    if (records.some((record) => record.phase !== 'failed' && !isCommittedRestoreJob(record)))
      return undefined;
    return records;
  };

  // Roll an interrupted removal forward before selecting anything new.
  for (const name of tombstones()) {
    const match = tombstoneName.exec(name)!;
    const id = match[1]!;
    if (!uuidPattern.test(id)) throw refused();
    if (match[2] !== 'evidence') continue;
    const record = jobs.read(id);
    if (!record) continue;
    // The record may only follow its evidence tombstone while still resolved,
    // and the live evidence name must be gone (never two copies).
    if (!isCommittedRestoreJob(record) || exists(journal.path(`restore-${id}`))) throw refused();
    jobs.retire(id, record.intentHash, `${pruned}/${id}.job`);
    syncDirectory(pruned);
    journal.syncRoot();
  }
  deleteTombstones();

  const state = journal.state;
  if (state.restoreJob || state.restoreStop || state.operation) {
    return { removed, refused: 'referenced' };
  }
  const records = inventory();
  if (!records) return { removed, refused: 'unresolved' };
  const keepIds = new Set([state.completedOperationId].filter((id): id is string => !!id));
  for (const record of selectRestorePrune(records, keepIds, keep)) {
    const id = record.intent.id;
    const evidence = journal.path(`restore-${id}`);
    // Oldest first means an irregular older evidence tree also stops newer ones.
    if (!exists(evidence) || !ownedDirectory(evidence)) return { removed, refused: 'ambiguous' };
    if (!exists(pruned)) {
      mkdirSync(pruned, { mode: 0o700 });
      syncDirectory(pruned);
      journal.syncRoot();
    }
    if (!ownedDirectory(pruned)) throw refused();
    renameSync(evidence, `${pruned}/${id}.evidence`);
    syncDirectory(pruned);
    journal.syncRoot();
    jobs.retire(id, record.intentHash, `${pruned}/${id}.job`);
    syncDirectory(pruned);
    journal.syncRoot();
    deleteTombstones();
    removed.push(id);
  }
  return { removed };
}
