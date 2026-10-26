import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JSONX } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { formulaBody, docFormulas } from '@spinel/doc-formulas';
import { openDatabase } from '../../server/database.ts';
import { AuthStore, hashToken } from '../../src/server/auth/store.ts';
import { AccessTokens } from '../../src/server/auth/tokens.ts';
import { OwnershipTransfer } from '../../src/server/auth/ownership.ts';
import { CollaborationStore } from '../../src/server/collaboration/service.ts';
import { WorkspaceStore } from '../../src/server/workspace/store.ts';
import { DocumentStore } from '../../src/server/workspace/documents.ts';
import { SpaceRecoveryStore } from '../../src/server/workspace/space-recovery.ts';
import { SpaceStore } from '../../src/server/workspace/spaces.ts';
import { HistoryStore } from '../../src/server/history/store.ts';
import { makeArchive, restoreArchive } from '../../src/server/backup/archive.ts';
import type { transitionFixture } from './fixture.ts';

/** Actual replacement boundaries, independently observed from source snapshot
 * contents. Kept outside the importer so its self-verification is not the test. */
export async function verifyTransitionFixture(path: string, fixture: ReturnType<typeof transitionFixture>, temporary: string) {
  const db = openDatabase(path);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const collab = new CollaborationStore(workspace, path);
  const history = new HistoryStore(workspace, collab);
  try {
    assert.deepEqual(collab.generations.active(fixture.doc.id), { itemId: fixture.doc.id, unitId: fixture.generation, offset: 7 });
    const document = await collab.load(fixture.owner.id, fixture.doc.id, fixture.custom());
    assert.equal(document.revision, 8);
    assert.deepEqual(docFormulas((document.snapshot as IDocumentData).body)[0]?.definition, fixture.formula);
    assert.equal(document.snapshot.resources?.find((resource) => resource.name === 'SPINEL_TRANSITION_FIXTURE')?.data,
      JSON.stringify({ retained: 'opaque metadata' }));
    const named = await history.load(fixture.viewer.id, fixture.doc.id, fixture.named, fixture.custom(fixture.viewer.id));
    assert.equal((named as IDocumentData).body?.dataStream, 'Earlier named content\r\n');
    const before = await history.load(fixture.owner.id, fixture.doc.id, fixture.beforeRestore, fixture.custom());
    assert.equal((before as IDocumentData).body?.dataStream, 'Before retained restore\r\n');
    assert.equal(history.list(fixture.owner.id, fixture.doc.id, fixture.custom()).find((point) => point.id === fixture.beforeRestore)?.beforeRestore, 1);
    assert.equal(db.prepare('SELECT status FROM spinel_restore_jobs WHERE id=?').get(fixture.restoreId)?.status, 'complete');
    const child = await collab.load(fixture.editor.id, fixture.child.id, fixture.custom(fixture.editor.id, fixture.child.id));
    assert.deepEqual(docFormulas((child.snapshot as IDocumentData).body)[0]?.definition, fixture.formula);
    assert.deepEqual(Buffer.from(new DocumentStore(workspace).image(fixture.owner.id, fixture.child.id, fixture.imageId, fixture.custom(fixture.owner.id, fixture.child.id)).data), fixture.image);
    const spaces = new SpaceStore(workspace);
    assert.equal(spaces.list(fixture.editor.id, fixture.root.id).items.find((item) => item.id === fixture.child.id)?.parentId, fixture.folder.id);
    assert.equal(db.prepare('SELECT 1 FROM workspace_grants WHERE item_id IN (?,?)').get(fixture.child.id, fixture.deleted.id), undefined);
    const recovery = new SpaceRecoveryStore(workspace);
    assert.equal(recovery.list(fixture.owner.id, fixture.root.id).items[0]?.id, fixture.deleted.id);
    recovery.restore(fixture.editor.id, fixture.root.id, fixture.deleted.id);
    await collab.prepare(fixture.owner.id, fixture.deleted.id, fixture.custom(fixture.owner.id, fixture.deleted.id));
    assert.equal(((await collab.load(fixture.owner.id, fixture.deleted.id, fixture.custom(fixture.owner.id, fixture.deleted.id))).snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v, 'Retained private cell');
    // Disabled-owner content survives while the current access policy still hides it.
    assert.equal(db.prepare('SELECT disabled FROM auth_users WHERE id=?').get(fixture.disabled.id)?.disabled, 1);
    assert.ok(db.prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=?').get(fixture.disabledDoc.id));
    const handover = new OwnershipTransfer(auth);
    const preview = handover.preview(fixture.operator.id, fixture.disabled.id);
    assert.equal(preview.counts.items, 1);
    handover.transfer(fixture.operator.id, fixture.disabled.id, fixture.owner.id, preview.confirmation);
    assert.deepEqual(docFormulas(((await collab.load(fixture.owner.id, fixture.disabledDoc.id, fixture.custom())).snapshot as IDocumentData).body)[0]?.definition, fixture.formula);
    for (const user of [fixture.outsider, fixture.operator])
      await assert.rejects(collab.load(user.id, fixture.doc.id, fixture.custom(user.id)));
    await assert.rejects(collab.load(fixture.owner.id, fixture.child.id, fixture.custom()));
    await assert.rejects(collab.load(fixture.owner.id, fixture.child.id, { ...fixture.custom(fixture.owner.id, fixture.child.id), spaceId: fixture.sheet.id }));
    await collab.load(fixture.guest.userId, fixture.child.id, fixture.guestCustom(fixture.child.id));
    await assert.rejects(collab.load(fixture.guest.userId, fixture.doc.id, fixture.guestCustom(fixture.doc.id)));
    await collab.prepare(fixture.owner.id, fixture.native.id, fixture.custom());
    assert.equal(((await collab.load(fixture.owner.id, fixture.native.id, fixture.custom())).snapshot as IDocumentData).body?.dataStream, 'Existing native\r\n');
    await collab.prepare(fixture.owner.id, fixture.unopened.id, fixture.custom());
    assert.equal(((await collab.load(fixture.owner.id, fixture.unopened.id, fixture.custom())).snapshot as IDocumentData).body?.dataStream, 'Unopened native save\r\n');

    const change = async (userId: string, value: string) => {
      const current = await collab.load(userId, fixture.sheet.id, fixture.custom(userId));
      return collab.submitSync({ unitId: fixture.sheet.id, baseRevision: current.revision,
        mutationId: randomUUID(), mutations: [{ id: 'sheet.mutation.set-range-values', params: {
          unitId: fixture.sheet.id, subUnitId: 'first', cellValue: { 1: { 0: { v: value } } },
        } }] }, { userID: userId, customData: fixture.custom(userId) });
    };
    await assert.rejects(change(fixture.viewer.id, 'Must refuse'));
    await change(fixture.owner.id, 'Owner edit after cutover');
    await change(fixture.editor.id, 'Peer edit after cutover');
    assert.equal(((await collab.load(fixture.owner.id, fixture.sheet.id, fixture.custom())).snapshot as IWorkbookData).sheets.first.cellData?.[1]?.[0]?.v, 'Peer edit after cutover');

    const tokenContext = { mcpTokenHash: hashToken(fixture.token.token), spaceId: fixture.root.id, spaceItem: fixture.child.id };
    const current = await collab.load(fixture.editor.id, fixture.child.id, tokenContext);
    const replacement = { ...formulaBody('updated-retained-formula', { version: 1, expression: '=7+8', references: [] }), dataStream: '=7+8\r\n' };
    const request = { unitId: fixture.child.id, baseRevision: current.revision, mutationId: randomUUID(), mutations: [{
      id: 'doc.mutation.rich-text-editing', params: { unitId: fixture.child.id,
        actions: new JSONX().replaceOp(['body'], (current.snapshot as IDocumentData).body, replacement), textRanges: [] },
    }] };
    const identity = { userID: fixture.editor.id, customData: tokenContext };
    const accepted = await collab.submitSync(request, identity);
    assert.equal(accepted.duplicate, false);
    assert.equal((await collab.submitSync(request, identity)).duplicate, true);
    await assert.rejects(collab.submitSync({ ...request, mutationId: randomUUID() }, identity));
    assert.equal(docFormulas(((await collab.load(fixture.owner.id, fixture.child.id, fixture.custom(fixture.owner.id, fixture.child.id))).snapshot as IDocumentData).body)[0]?.definition.expression, '=7+8');
    await assert.rejects(collab.load(fixture.editor.id, fixture.doc.id, { ...tokenContext, spaceItem: fixture.doc.id }));
    new AccessTokens(auth).revoke(fixture.editor.id, fixture.token.id);
    await assert.rejects(collab.submitSync(request, identity));
    const revoke = workspace.links.begin(fixture.root.id, null);
    workspace.links.finish(fixture.root.id, revoke.epoch, false);
    await assert.rejects(collab.load(fixture.guest.userId, fixture.child.id, fixture.guestCustom(fixture.child.id)));

    const restored = await history.restore(fixture.owner.id, fixture.doc.id, fixture.named,
      fixture.generation, randomUUID(), () => {}, fixture.custom());
    assert.equal(restored.revision, 9);
    assert.notEqual(restored.nextUnit, fixture.generation);
    assert.equal(((await collab.load(fixture.owner.id, fixture.doc.id, fixture.custom())).snapshot as IDocumentData).body?.dataStream, 'Earlier named content\r\n');
    assert.ok(history.list(fixture.owner.id, fixture.doc.id, fixture.custom()).find((point) => point.revision === 8 && point.beforeRestore));
    await assert.rejects(collab.submitSync({ ...request, unitId: fixture.generation }, { userID: fixture.owner.id, customData: fixture.custom() }));

    const key = randomBytes(32);
    const archive = await makeArchive(db, temporary, key, { format: 1, createdAt: new Date().toISOString(), origin: 'https://transition.example',
      image: `sha256:${'a'.repeat(64)}`, runtimeEnvironment: 'SYNTHETIC_TRANSITION=1\n' });
    try {
      const recoveryDirectory = join(temporary, `verified-backup-${randomUUID()}`);
      await restoreArchive(archive.archive, key, temporary, recoveryDirectory);
      const recovered = openDatabase(join(recoveryDirectory, 'spinel.sqlite'));
      try {
        assert.equal(recovered.prepare('SELECT count(*) AS count FROM spinel_sync_units').get()?.count,
          db.prepare('SELECT count(*) AS count FROM spinel_sync_units').get()?.count);
        assert.deepEqual(recovered.prepare('SELECT * FROM history_checkpoints ORDER BY id').all(), db.prepare('SELECT * FROM history_checkpoints ORDER BY id').all());
        assert.deepEqual(recovered.prepare('SELECT * FROM doc_images ORDER BY item_id,id').all(), db.prepare('SELECT * FROM doc_images ORDER BY item_id,id').all());
      } finally { recovered.close(); }
    } finally { await archive.dispose(); }
    return { documents: 7, legacy: fixture.units.length, accountChecks: true, guestChecks: true, mcpChecks: true, historyAndRecovery: true };
  } finally {
    await history.close();
    await collab.close();
    db.close();
  }
}
