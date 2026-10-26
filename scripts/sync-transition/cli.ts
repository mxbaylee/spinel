import { parseArgs } from 'node:util';
import { exportSyncTransition, importSyncTransition } from '../../src/server/sync/transition.ts';
import type { TransitionProgress } from '../../src/server/sync/transition.ts';
import { legacyTransitionReader } from './legacy.ts';

const progress: TransitionProgress = (event) => process.stdout.write(JSON.stringify(event) + '\n');
try {
  const command = process.argv[2];
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      source: { type: 'string' },
      bundle: { type: 'string' },
      destination: { type: 'string' },
      'legacy-checkout': { type: 'string' },
    },
  });
  if (
    command === 'export' &&
    values.source &&
    values.bundle &&
    values['legacy-checkout'] &&
    !values.destination
  ) {
    const result = await exportSyncTransition({
      source: values.source,
      directory: values.bundle,
      legacy: legacyTransitionReader(values['legacy-checkout']),
      progress,
    });
    process.stdout.write(
      JSON.stringify({
        event: 'sync_transition.export_complete',
        documents: result.documents,
        converted: result.converted,
      }) + '\n',
    );
  } else if (
    command === 'import' &&
    values.bundle &&
    values.destination &&
    !values.source &&
    !values['legacy-checkout']
  ) {
    const result = await importSyncTransition({
      directory: values.bundle,
      destination: values.destination,
      progress,
    });
    process.stdout.write(
      JSON.stringify({
        event: 'sync_transition.import_complete',
        documents: result.documents,
        converted: result.converted,
      }) + '\n',
    );
  } else throw new Error('Invalid transition command.');
} catch {
  // SDK/database errors may include document payloads. Report a fixed failure,
  // retaining the private source, receipts and unfinished target for inspection.
  process.stderr.write(
    'Sync transition stopped. Keep all source and destination files. Check the transition runbook and retry the same command after correcting the cause.\n',
  );
  process.exitCode = 1;
}
