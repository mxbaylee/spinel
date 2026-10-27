import { join } from 'node:path';
import { DatabaseSync } from '../../../server/database.ts';
import { readKey, restoreArchive } from './archive.ts';
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
      process.send?.({
        ok: true,
        result: { ...inventory, ...semantics, ...(recovery.keyId && { keyId: recovery.keyId }) },
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
