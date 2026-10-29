import { RecoveryJournal } from './journal.ts';
import { RestoreJobs } from './restore-jobs.ts';

// Isolate malformed-file refusal: a regression must time out only this child,
// never block the test runner's synchronous filesystem calls.
const [root, databasePath, id, kind] = process.argv.slice(2);
let journal: RecoveryJournal | undefined;
let jobs: RestoreJobs | undefined;
try {
  journal = await RecoveryJournal.open(root, databasePath);
  if (kind !== 'journal') jobs = new RestoreJobs(journal);
  let refused = false;
  try {
    if (kind === 'journal') journal.acceptJournal();
    else jobs!.read(id);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      ![
        'Restore job custody is unavailable or changed.',
        'Invalid journal type or permissions need explicit cold-host filesystem repair.',
      ].includes(error.message)
    )
      throw error;
    refused = true;
  }
  process.send?.({ refused });
} catch {
  process.exitCode = 1;
} finally {
  jobs?.close();
  await journal?.close();
  process.disconnect?.();
}
