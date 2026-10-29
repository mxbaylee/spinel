import { join } from 'node:path';
import { rm, stat } from 'node:fs/promises';
import { DatabaseSync } from '../../../server/database.ts';
import { digest, readKey, restoreArchive } from './archive.ts';
import { verifyInventory } from './inventory.ts';
import { verifySemantics } from './verification-semantics.ts';
import { RecoveryResourceError } from './resource-error.ts';
import { assertSelfContained } from './restore-input.ts';
import type { ClosedRestoreInput } from './restore-input.ts';
import type { PreparedRestore } from './verification.ts';
import type { FreezeWorkerInput } from './restore-freeze-worker.ts';
import type { RollbackWorkerInput } from './restore-rollback.ts';

type WorkerInput = {
  directory: string;
  expectedOrigin: string;
  expectedImage?: string;
  maxDatabaseBytes?: number;
  retain?: boolean;
} & (
  | { kind?: 'archive'; archive: string; keyFile: string }
  | {
      kind: 'reconcile';
      current: ClosedRestoreInput;
      candidate: ClosedRestoreInput & { recovery: PreparedRestore['recovery'] };
      spacesEnabled: boolean;
      now: number;
    }
);

const disconnected = () => process.exit(1);
process.once('disconnect', disconnected);
process.once('message', async (value: WorkerInput | FreezeWorkerInput | RollbackWorkerInput) => {
  let database: DatabaseSync | undefined;
  let current: DatabaseSync | undefined;
  try {
    if (value.kind === 'freeze') {
      const { freezeWorkingRestore } = await import('./restore-freeze-worker.ts');
      process.send?.({ ok: true, result: await freezeWorkingRestore(value) });
      return;
    }
    if (value.kind === 'rollback') {
      const { prepareWorkingRollback } = await import('./restore-rollback-worker.ts');
      process.send?.({ ok: true, result: await prepareWorkingRollback(value) });
      return;
    }
    const destination = join(value.directory, 'restored');
    if (value.kind === 'reconcile') {
      const databasePath = join(destination, 'spinel.sqlite');
      if (
        value.current.databasePath !== join(value.directory, 'current.sqlite') ||
        value.candidate.databasePath !== databasePath ||
        value.candidate.recovery.origin !== value.expectedOrigin ||
        value.candidate.recovery.image !== value.expectedImage
      )
        throw new Error('Invalid reconciliation input.');
      for (const input of [value.current, value.candidate]) {
        await assertSelfContained(input.databasePath);
        if (
          (await stat(input.databasePath)).size !== input.databaseBytes ||
          (await digest(input.databasePath)) !== input.databaseSha256
        )
          throw new Error('Changed reconciliation input.');
      }
      // Only these disposable private copies are in the worker's read set.
      current = new DatabaseSync(value.current.databasePath);
      database = new DatabaseSync(databasePath);
      database.exec('PRAGMA journal_mode=DELETE');
      const pageSize = Number(database.prepare('PRAGMA page_size').get()!.page_size);
      const maximum = value.maxDatabaseBytes ?? 8 * 1024 ** 3;
      database.exec(`PRAGMA max_page_count=${Math.floor(maximum / pageSize)}`);
      const { reconcileRestoreCandidate } = await import('./restore-candidate.ts');
      const result = await reconcileRestoreCandidate(current, database, {
        spacesEnabled: value.spacesEnabled,
        now: value.now,
      });
      const { inventory, semantics, ...reconciliation } = result;
      database.close();
      database = undefined;
      current.close();
      current = undefined;
      await assertSelfContained(databasePath);
      // Do not retain the frozen current credentials beside successful output.
      for (const suffix of ['', '-wal', '-shm', '-journal'])
        await rm(value.current.databasePath + suffix, { force: true });
      const bytes = (await stat(databasePath)).size;
      if (bytes > maximum) throw new RecoveryResourceError('database-size');
      process.send?.({
        ok: true,
        result: {
          ...inventory,
          ...semantics,
          prepared: {
            databaseSha256: await digest(databasePath),
            databaseBytes: bytes,
            recovery: value.candidate.recovery,
            reconciliation,
          },
        },
      });
      return;
    }
    const recovery = await restoreArchive(
      value.archive,
      await readKey(value.keyFile),
      value.directory,
      destination,
      {
        requireInventory: true,
        preserveJobState: true,
        maxDatabaseBytes: value.maxDatabaseBytes,
      },
    );
    if (
      recovery.origin !== value.expectedOrigin ||
      (value.expectedImage !== undefined && recovery.image !== value.expectedImage)
    )
      throw new Error('Incompatible recovery metadata.');
    database = new DatabaseSync(join(destination, 'spinel.sqlite'), { readOnly: true });
    const inventory = verifyInventory(database)!;
    const semantics = await verifySemantics(database);
    database.close();
    database = undefined;
    const databasePath = join(destination, 'spinel.sqlite');
    // Archived endpoints, secrets and schedules are evidence, not deployment
    // instructions. Assisted activation must retain the current deployment.
    if (value.retain) await rm(join(destination, 'recovery.json'));
    process.send?.({
      ok: true,
      result: {
        ...inventory,
        ...semantics,
        ...(recovery.keyId && { keyId: recovery.keyId }),
        ...(value.retain && {
          prepared: {
            databaseSha256: await digest(databasePath),
            databaseBytes: (await stat(databasePath)).size,
            recovery: {
              createdAt: recovery.createdAt,
              origin: recovery.origin,
              image: recovery.image,
            },
          },
        }),
      },
    });
  } catch (error) {
    // Raw SQLite/native errors can contain document content and credentials.
    process.send?.({
      ok: false,
      ...(error instanceof RecoveryResourceError && { resourceCode: error.code }),
    });
    process.exitCode = 1;
  } finally {
    database?.close();
    current?.close();
    process.removeListener('disconnect', disconnected);
    process.disconnect?.();
  }
});
