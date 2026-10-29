import { join } from 'node:path';
import { rm, stat } from 'node:fs/promises';
import { DatabaseSync } from '../../../server/database.ts';
import { digest, readKey, restoreArchive } from './archive.ts';
import { verifyInventory } from './inventory.ts';
import { verifySemantics } from './verification-semantics.ts';
import { RecoveryResourceError } from './resource-error.ts';

const disconnected = () => process.exit(1);
process.once('disconnect', disconnected);
process.once(
  'message',
  async (value: {
    archive: string;
    keyFile: string;
    directory: string;
    expectedOrigin: string;
    expectedImage?: string;
    maxDatabaseBytes?: number;
    retain?: boolean;
  }) => {
    let database: DatabaseSync | undefined;
    try {
      const destination = join(value.directory, 'restored');
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
      process.removeListener('disconnect', disconnected);
      process.disconnect?.();
    }
  },
);
