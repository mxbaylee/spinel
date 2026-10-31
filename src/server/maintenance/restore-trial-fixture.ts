/** Real-process trial transport fixture; it does not implement durable controller decisions. */
import type { AddressInfo } from 'node:net';
import { createApp } from '../../../server/app.ts';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { restoreSnapshotFingerprint } from '../backup/inventory.ts';
import { connectMaintenance } from './supervisor-client.ts';

if (!process.send || !process.env.DATABASE_PATH || !process.env.SPINEL_STATIC_DIR)
  throw new Error('Private restore trial fixture required.');
const options = {
  databasePath: process.env.DATABASE_PATH,
  staticDirectory: process.env.SPINEL_STATIC_DIR,
  origin: 'http://localhost:3000',
  image: `sha256:${'a'.repeat(64)}`,
  backupConfigPath: process.env.BACKUP_CONFIG_PATH,
};
if (process.env.SPINEL_TEST_TRIAL_ROLE === 'seed') {
  const app = await createApp(options);
  await app.close();
  const reader = new DatabaseSync(options.databasePath);
  new AuthStore(reader).createUser('Preserved owner', true);
  const fingerprint = restoreSnapshotFingerprint(reader);
  reader.prepare('VACUUM INTO ?').run(options.databasePath + '.prepared');
  reader.close();
  process.send({ kind: 'seeded', fingerprint }, () => process.disconnect?.());
} else {
  const bridge = await connectMaintenance();
  const opening = bridge.takeRestoreOpening();
  const app = await createApp({ ...options, maintenance: bridge, restoreOpening: opening });
  if (!app.restoreTrial || !opening) throw new Error('Trial fixture did not receive its opening.');
  let closing = false;
  bridge.onRestoreTrialStop(app.restoreTrial, async (stop) => {
    if (closing) throw new Error('Trial is already stopping.');
    closing = true;
    try {
      await app.close({
        acceptRestoreWitness: (fingerprint) => bridge.acceptRestoreTrialWitness(stop, fingerprint),
      });
      process.send?.({ kind: 'trial-stopped' });
    } finally {
      bridge.close();
      process.disconnect?.();
    }
  });
  let refusedReuse = false,
    refusedOrdinary = false;
  try {
    await createApp({ ...options, maintenance: bridge, restoreOpening: opening });
  } catch {
    refusedReuse = true;
  }
  try {
    bridge.ready();
  } catch {
    refusedOrdinary = true;
  }
  bridge.onRestoreTrialRelease((reference) => app.releaseRestoreTrial(reference));
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  app.verifyPausedRestore({
    fingerprint: app.restoreTrial.output.fingerprint,
    epoch: app.restoreTrial.epoch,
    generationId: app.restoreTrial.generationId,
  });
  bridge.restoreTrialReady(app.restoreTrial);
  process.send({
    kind: 'listening',
    port: (app.server.address() as AddressInfo).port,
    refusedReuse,
    refusedOrdinary,
  });
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    bridge.close();
    process.disconnect?.();
  };
  const actualNow = Date.now;
  process.on('message', (value: unknown) => {
    if (!value || typeof value !== 'object' || !('kind' in value)) return;
    if (value.kind === 'fixture-expire') Date.now = () => actualNow() + 120_000;
    if (value.kind === 'fixture-ping' || value.kind === 'fixture-expire')
      process.send?.({ kind: 'fixture-pong' });
  });
  process.once('SIGTERM', () => {
    void close();
  });
}
