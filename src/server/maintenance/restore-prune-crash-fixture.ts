import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RecoveryJournal } from './journal.ts';
import { RestoreJobs } from './restore-jobs.ts';
import { pruneRestoreEvidence } from './restore-prune.ts';

// Real-process crash fixture for SPN-125 pruning. The child kills itself with
// SIGKILL at the first durable sync that follows a named step, so the parent can
// inspect exactly the files a restart would find. Without a cut it runs to
// completion, which is also how the parent restarts after a kill.
const [root, databasePath, cut, oldest] = process.argv.slice(2);
const pruned = join(root!, 'restore-pruned');
const list = () => (existsSync(pruned) ? readdirSync(pruned).sort() : null);
const stepReached: Record<string, () => boolean> = {
  // restore-pruned exists and is empty; the oldest evidence is still in place.
  'tombstone-dir': () =>
    list()?.length === 0 &&
    existsSync(join(root!, `restore-${oldest}`)) &&
    existsSync(join(root!, 'restore-jobs', oldest!)),
  // Evidence moved; its record is still in the inventory.
  'evidence-moved': () =>
    JSON.stringify(list()) === JSON.stringify([`${oldest}.evidence`]) &&
    existsSync(join(root!, 'restore-jobs', oldest!)),
  // Both tombstones exist and nothing has been deleted.
  'job-moved': () =>
    JSON.stringify(list()) === JSON.stringify([`${oldest}.evidence`, `${oldest}.job`]),
  // The evidence tombstone is deleted and the record tombstone remains.
  'evidence-deleted': () => JSON.stringify(list()) === JSON.stringify([`${oldest}.job`]),
  // The whole first restore is gone and its tombstone directory is empty.
  done: () =>
    list()?.length === 0 &&
    !existsSync(join(root!, `restore-${oldest}`)) &&
    !existsSync(join(root!, 'restore-jobs', oldest!)),
};

const journal = await RecoveryJournal.open(root!, databasePath!);
const jobs = new RestoreJobs(journal);
try {
  if (cut) {
    const reached = stepReached[cut];
    if (!reached) throw new Error('Unknown crash cut.');
    const sync = journal.syncRoot.bind(journal);
    journal.syncRoot = () => {
      // Kill before this sync completes: the rename or delete already happened,
      // which is what an interrupted process leaves behind.
      if (reached()) process.kill(process.pid, 'SIGKILL');
      sync();
    };
  }
  const result = pruneRestoreEvidence(journal, jobs);
  if (cut) throw new Error('The crash cut was never reached.');
  process.stdout.write(JSON.stringify(result) + '\n');
} finally {
  jobs.close();
  await journal.close();
}
