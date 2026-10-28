/** Test-only interruption of the real public Node server-handle transfer. */
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../../server/database.ts';
import {
  RecoveryJournal,
  workspaceOwnershipAddresses,
  workspaceOwnershipRoles,
} from './journal.ts';
import { OWNERSHIP_CHANNEL, receiveWorkspaceOwnership } from './ownership.ts';

if (!process.send || !process.env.DATABASE_PATH || !process.env.SPINEL_MAINTENANCE_ROOT)
  throw new Error('Private ownership fixture required.');
if (process.env.SPINEL_TEST_OWNERSHIP_ROLE === 'parent') {
  const journal = await RecoveryJournal.open(
    process.env.SPINEL_MAINTENANCE_ROOT,
    process.env.DATABASE_PATH,
  );
  await journal.bindWorkspace();
  const ownership = journal.workspaceOwnership();
  const transferId = randomUUID();
  const addresses = workspaceOwnershipAddresses(ownership.databasePath, ownership.databaseIdentity);
  const count = Number(process.env.SPINEL_TEST_TRANSFER_COUNT);
  if (![0, 2].includes(count)) throw new Error('Invalid transfer fixture.');
  const child = fork(fileURLToPath(import.meta.url), [], {
    env: { ...process.env, SPINEL_TEST_OWNERSHIP_ROLE: 'child' },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  let sent = false;
  child.on('message', (value: unknown) => {
    if (
      value &&
      typeof value === 'object' &&
      'received' in value &&
      value.received === workspaceOwnershipRoles[count - 1] &&
      'transferId' in value &&
      value.transferId === transferId
    ) {
      process.send!({ waiting: true, childPid: child.pid });
      return;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('channel' in value) ||
      value.channel !== OWNERSHIP_CHANNEL ||
      !('kind' in value) ||
      value.kind !== 'request' ||
      sent
    )
      return;
    sent = true;
    void (async () => {
      for (const role of workspaceOwnershipRoles.slice(0, count))
        await new Promise<void>((resolve, reject) =>
          child.send(
            {
              channel: OWNERSHIP_CHANNEL,
              kind: 'handle',
              transferId,
              role,
              databasePath: ownership.databasePath,
              databaseIdentity: ownership.databaseIdentity,
              addresses,
            },
            ownership.handles[role],
            (error) => (error ? reject(error) : resolve()),
          ),
        );
      if (count === 0) process.send!({ waiting: true, childPid: child.pid });
    })();
  });
  process.on('SIGTERM', () => {
    child.kill('SIGKILL');
    void journal.close().then(() => process.disconnect?.());
  });
} else if (process.env.SPINEL_TEST_OWNERSHIP_ROLE === 'child') {
  try {
    const receiving = receiveWorkspaceOwnership(process.env.DATABASE_PATH);
    // Installed after the real receiver: the fixture's barrier proves each
    // indicated listener was actually received before the parent is killed.
    process.on('message', (value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'channel' in value &&
        value.channel === OWNERSHIP_CHANNEL &&
        'kind' in value &&
        value.kind === 'handle' &&
        'role' in value &&
        'transferId' in value
      )
        process.send?.({ received: value.role, transferId: value.transferId }, () => {});
    });
    await receiving;
    writeFileSync(`${process.env.DATABASE_PATH}.opened`, 'opened', { flag: 'wx' });
    const database = openDatabase(process.env.DATABASE_PATH);
    database.close();
  } catch {
    process.exitCode = 1;
  }
  if (process.connected) process.disconnect?.();
} else throw new Error('Invalid ownership fixture role.');
