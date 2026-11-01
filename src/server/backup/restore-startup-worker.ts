import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../../../server/app.ts';
import type { MaintenanceAdminStatus, MaintenanceBridge } from '../../shared/maintenance.ts';
import { publicMaintenance } from '../../shared/maintenance.ts';
import { digest } from './archive.ts';
import { assertSelfContained, validateClosedRestoreInput } from './restore-input.ts';
import type { StartupWorkerInput } from './restore-startup.ts';

/** Only the disposable copy is opened; process exit is the closure boundary. */
export async function rehearseWorkingStartup(input: StartupWorkerInput) {
  if (input.candidate.databasePath !== join(input.directory, 'startup.sqlite'))
    throw new Error('Invalid startup copy.');
  validateClosedRestoreInput(input.candidate, input.maxDatabaseBytes);
  await assertSelfContained(input.candidate.databasePath);
  if (
    (await stat(input.candidate.databasePath)).size !== input.candidate.databaseBytes ||
    (await digest(input.candidate.databasePath)) !== input.candidate.databaseSha256
  )
    throw new Error('Startup copy changed.');
  const state: MaintenanceAdminStatus = {
    available: true,
    phase: 'starting',
    epoch: randomUUID(),
    generationId: randomUUID(),
    operationId: randomUUID(),
    authorityExpiresAt: null,
    notice: null,
    lastFailure: null,
    readyToResume: false,
  };
  const bridge: MaintenanceBridge = {
    status: () => publicMaintenance(state),
    adminStatus: () => ({ ...state }),
    subscribe: () => () => {},
    async control() {
      throw new Error('Rehearsal cannot change maintenance.');
    },
    ready() {},
    drained() {},
    fail() {
      throw new Error('Rehearsal storage failed.');
    },
    close() {},
  };
  const app = await createApp({
    databasePath: input.candidate.databasePath,
    origin: input.expectedOrigin,
    image: input.expectedImage,
    staticDirectory: input.staticDirectory,
    spaceReview: input.spacesEnabled,
    maintenance: bridge,
    restoreMaximumBytes: input.maxDatabaseBytes,
  });
  let fingerprint: string | undefined;
  try {
    app.verifyPausedRestore({
      fingerprint: input.candidate.logicalFingerprint,
      epoch: state.epoch,
      generationId: state.generationId,
    });
  } finally {
    await app.close({
      async acceptRestoreWitness(value) {
        if (value !== input.candidate.logicalFingerprint)
          throw new Error('Shutdown changed prepared content.');
        fingerprint = value;
      },
    });
  }
  if (!fingerprint) throw new Error('Rehearsal did not close its snapshot.');
  return { logicalFingerprint: fingerprint };
}
