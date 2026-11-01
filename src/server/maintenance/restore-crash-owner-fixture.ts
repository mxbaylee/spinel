/** Add only a public credential to the existing Owner after archive creation.
 * No session or verification is seeded: acceptance uses real Owner WebAuthn. */
import { once } from 'node:events';
import { openDatabase } from '../../../server/database.ts';
import { acquireColdWorkspace } from './journal.ts';

if (!process.send || !process.env.DATABASE_PATH || !process.env.SPINEL_TEST_FOLDER_ID)
  throw new Error('Private Owner credential fixture required.');
try {
  const [input] = await once(process, 'message');
  if (
    input?.kind !== 'credential' ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.id) ||
    typeof input.publicKey !== 'string'
  )
    throw new Error('Invalid fixture credential.');
  const key = Buffer.from(input.publicKey, 'base64url');
  if (key.length !== 77) throw new Error('Invalid public credential.');
  const release = await acquireColdWorkspace(process.env.DATABASE_PATH);
  try {
    const database = openDatabase(process.env.DATABASE_PATH);
    try {
      const owner = database
        .prepare(
          `SELECT u.id FROM workspace_items i
        JOIN auth_users u ON u.id=i.owner_id WHERE i.id=? AND u.is_admin=0`,
        )
        .get(process.env.SPINEL_TEST_FOLDER_ID);
      if (typeof owner?.id !== 'string')
        throw new Error('Expected the original non-Operator Owner.');
      database
        .prepare(
          `INSERT INTO auth_passkeys
        (id,user_id,public_key,counter,transports,name,provider,created_at,last_used_at,backed_up,device_type)
        VALUES(?,?,?,0,'[]','Crash Owner fixture','Browser',?,NULL,0,'singleDevice')`,
        )
        .run(input.id, owner.id, key, Date.now());
      await new Promise<void>((resolve, reject) =>
        process.send!({ ownerId: owner.id }, (error) => (error ? reject(error) : resolve())),
      );
    } finally {
      database.close();
    }
  } finally {
    await release();
  }
} catch {
  process.exitCode = 1;
} finally {
  process.disconnect?.();
}
