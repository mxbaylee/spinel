import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createApp, projectRoot } from './app.ts';
import { applicationPolicy } from './application-policy.ts';
import { connectMaintenance } from '../src/server/maintenance/supervisor-client.ts';
import {
  acquireColdWorkspaceLease,
  acquireLiveWorkspace,
  canonicalDatabasePath,
} from '../src/server/maintenance/journal.ts';
import type { WorkspaceLease } from '../src/server/maintenance/journal.ts';
import { closeSync, constants, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RestoreStopRequest } from '../src/shared/maintenance.ts';
import type { RestoreTrialStopRequest } from '../src/server/maintenance/restore-trial-stop.ts';

const development = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}
const host = process.env.HOST ?? '127.0.0.1';
const configuredPath = resolve(
  process.env.DATABASE_PATH ?? resolve(projectRoot, 'data/spinel.sqlite'),
);
mkdirSync(dirname(configuredPath), { recursive: true });
const databasePath = canonicalDatabasePath(configuredPath);
const maintenance = process.env.SPINEL_SUPERVISED === '1' ? await connectMaintenance() : undefined;
// Live ownership remains until this process exits, independently of the cold
// startup lease. A supervisor in another PID namespace cannot inspect our FDs.
// Unref'd kernel listeners do not themselves keep a shut-down process alive.
let liveWorkspace: WorkspaceLease | undefined;
let stopping = false;
let shutdownTask: Promise<void> | undefined;
const app = await (async () => {
  let startupLease: WorkspaceLease | undefined;
  let opened = false;
  let starting: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    if (!maintenance && process.platform === 'linux') {
      liveWorkspace = await acquireLiveWorkspace(databasePath);
      startupLease = await acquireColdWorkspaceLease(databasePath);
      // First startup must bind inode ownership before any SQLite connection is
      // opened, including an alias pointing at this newly created file.
      try {
        closeSync(
          openSync(
            databasePath,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o600,
          ),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      await liveWorkspace.bindFile();
      await startupLease.bindFile();
      // A supervised app/verifier inherits both leases before its first DB
      // open, so an orphan continues excluding this startup after parent death.
    }
    opened = true;
    starting = await createApp({
      maintenance,
      restoreOpening: maintenance?.takeRestoreOpening(),
      development,
      ...applicationPolicy(port),
      backupConfigPath: process.env.BACKUP_CONFIG_PATH,
      databasePath,
    });
    if (starting.restoreTrial) {
      const trialApplication = starting;
      maintenance!.onRestoreTrialStop(starting.restoreTrial, (stop) =>
        shutdownApplication(trialApplication, undefined, stop),
      );
      maintenance!.onRestoreTrialRelease((reference) =>
        trialApplication.releaseRestoreTrial(reference),
      );
    }
    const server = starting.server;
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolveListen();
      });
    });
    if (stopping) throw new Error('Application stopped during private trial startup.');
    if (starting.restoreTrial) {
      const trial = starting.restoreTrial;
      starting.verifyPausedRestore({
        fingerprint: trial.output.fingerprint,
        epoch: trial.epoch,
        generationId: trial.generationId,
      });
      maintenance!.restoreTrialReady(trial);
    } else maintenance?.ready();
    await startupLease?.release();
    return starting;
  } catch (error) {
    if (shutdownTask) await shutdownTask;
    else await starting?.close().catch(() => {});
    await startupLease?.release().catch(() => {});
    // After any SQLite open, even a failed startup keeps live ownership until
    // process exit because native descriptors can remain after close().
    if (!opened) await liveWorkspace?.release().catch(() => {});
    maintenance?.close();
    throw error;
  }
})();

const address = app.server.address() as AddressInfo;
const url = process.env.APP_ORIGIN ?? `http://localhost:${address.port}`;
console.log(`Spinel is running at ${url}`);

if (development && !process.argv.includes('--no-open')) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  execFile(command, args, (error) => {
    if (error) console.log(`Open ${url} in your browser.`);
  });
}

async function shutdownApplication(
  application: Awaited<ReturnType<typeof createApp>>,
  restore?: RestoreStopRequest,
  trialStop?: RestoreTrialStopRequest,
) {
  if (stopping) {
    if (restore || trialStop) throw new Error('Application shutdown has already started.');
    return shutdownTask;
  }
  stopping = true;
  shutdownTask = (async () => {
    try {
      await application.close(
        restore || trialStop
          ? {
              acceptRestoreWitness: (fingerprint) => {
                if (trialStop) {
                  if (!maintenance?.acceptRestoreTrialWitness)
                    throw new Error('Restore trial control is unavailable.');
                  return maintenance.acceptRestoreTrialWitness(trialStop, fingerprint);
                }
                if (!maintenance?.acceptRestoreWitness)
                  throw new Error('Restore control is unavailable.');
                return maintenance.acceptRestoreWitness(restore!, fingerprint);
              },
            }
          : undefined,
      );
    } catch (error) {
      console.error(
        restore || trialStop ? new Error('Supervised restore shutdown did not complete.') : error,
      );
      process.exitCode = 1;
    } finally {
      maintenance?.close();
    }
  })();
  return shutdownTask;
}
maintenance?.onRestoreAuthority?.((proof) => app.verifyRestoreAuthority(proof));
maintenance?.onRestoreStop?.((request) => shutdownApplication(app, request));
process.on('SIGINT', () => void shutdownApplication(app));
process.on('SIGTERM', () => void shutdownApplication(app));
