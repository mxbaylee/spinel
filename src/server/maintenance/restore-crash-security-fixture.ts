/** A closed bootstrap process gives the preserved original an active link and
 * guest session. Account sessions still come from real HTTP/WebAuthn. */
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { acquireColdWorkspace } from './journal.ts';

if (!process.send || !process.env.DATABASE_PATH || !process.env.SPINEL_TEST_OWNER_ID)
  throw new Error('Private crash security fixture required.');
const release = await acquireColdWorkspace(process.env.DATABASE_PATH);
try {
  const database = openDatabase(process.env.DATABASE_PATH);
  try {
    const workspace = new WorkspaceStore(new AuthStore(database), { spacesEnabled: true });
    const linked = workspace.create(process.env.SPINEL_TEST_OWNER_ID, {
      kind: 'doc', name: 'Retained linked document', parentId: null,
    });
    const change = workspace.links.begin(linked.id, 'viewer');
    workspace.links.finish(linked.id, change.epoch, true);
    workspace.links.exchange(linked.id, change.token);
    await new Promise<void>((resolve, reject) =>
      process.send!({ linkedId: linked.id }, (error) => error ? reject(error) : resolve()),
    );
  } finally {
    database.close();
  }
} finally {
  await release();
  process.disconnect?.();
}
