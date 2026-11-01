import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { DrawingTypeEnum } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { HistoryStore } from '../history/store.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { makeArchive, restoreArchive } from '../backup/archive.ts';
import { authenticator } from './restore-http-test-client.ts';
import { mutateRestoreRichCurrent, seedRestoreRichFixture } from './restore-rich-fixture.ts';

test('rich phases retain real archived native content, PNG and history while current credentials and revocations differ', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-rich-fixture-'));
  const path = join(directory, 'current.sqlite');
  const assets = join(directory, 'assets');
  await mkdir(assets);
  await writeFile(join(assets, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath: path, staticDirectory: assets });
  await app.close();
  const db = openDatabase(path);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  auth.createUser('Operator', true);
  const owner = auth.createUser('Owner');
  const key = randomBytes(32);
  try {
    const metadata = await seedRestoreRichFixture({ auth, workspace, ownerId: owner.id });
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(auth.database.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n).toBe(0);
    const archive = await makeArchive(db, directory, key, {
      format: 1,
      createdAt: new Date().toISOString(),
      origin: 'https://spinel.example',
      image: `spinel@sha256:${'a'.repeat(64)}`,
      runtimeEnvironment: 'NODE_ENV=production\n',
      keyId: 'rich-fixture',
    });
    const ownerKey = authenticator(),
      readerKey = authenticator();
    const credentials = {
      owner: { id: ownerKey.id, publicKey: Buffer.from(ownerKey.publicKey, 'base64url') },
      reader: { id: readerKey.id, publicKey: Buffer.from(readerKey.publicKey, 'base64url') },
    };
    // Conflicting IDs refuse before creating keys or changing archived content.
    await expect(
      mutateRestoreRichCurrent({
        auth,
        workspace,
        metadata,
        credentials: { owner: credentials.owner, reader: credentials.owner },
      }),
    ).rejects.toThrow('distinct');
    expect(db.prepare('SELECT count(*) AS n FROM auth_passkeys').get()!.n).toBe(0);
    await mutateRestoreRichCurrent({ auth, workspace, metadata, credentials });
    expect(db.prepare('SELECT count(*) AS n FROM auth_passkeys').get()!.n).toBe(2);
    expect(db.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n).toBe(0);
    expect(workspace.get(metadata.readerId, metadata.docId).access).toBe('viewer');
    expect(() => workspace.get(metadata.readerId, metadata.sheetId)).toThrow('not available');
    expect(() => workspace.links.exchange(metadata.docId, metadata.revokedGuestToken)).toThrow();
    await expect(
      mutateRestoreRichCurrent({ auth, workspace, metadata, credentials }),
    ).rejects.toThrow('new public COSE');
    const current = new CollaborationStore(workspace, path);
    try {
      expect(
        ((await current.load(owner.id, metadata.docId)).snapshot as IDocumentData).body!.dataStream,
      ).toBe(metadata.currentDocText);
      expect(
        ((await current.load(owner.id, metadata.sheetId)).snapshot as IWorkbookData).sheets[
          metadata.sheetTabId
        ].cellData![0][0].v,
      ).toBe(metadata.currentSheetValue);
    } finally {
      await current.close();
    }
    const restored = join(directory, 'archive');
    await restoreArchive(archive.archive, key, directory, restored, { requireInventory: true });
    const archived = openDatabase(join(restored, 'spinel.sqlite'));
    const archivedAuth = new AuthStore(archived),
      archivedWorkspace = new WorkspaceStore(archivedAuth);
    const native = new CollaborationStore(archivedWorkspace, archived.path);
    const history = new HistoryStore(archivedWorkspace, native);
    try {
      expect(archived.prepare('SELECT count(*) AS n FROM auth_passkeys').get()!.n).toBe(0);
      const doc = (await native.load(owner.id, metadata.docId)).snapshot as IDocumentData;
      expect(doc.body!.dataStream).toBe(metadata.expectedDocText);
      expect(createHash('sha256').update(JSON.stringify(doc.body)).digest('hex')).toBe(
        metadata.expectedDocBodySha256,
      );
      expect(doc.body!.customBlocks).toEqual([
        { startIndex: metadata.expectedDocText.length - 3, blockId: 'restore-image' },
      ]);
      expect(doc.drawings!['restore-image']).toMatchObject({
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        source: metadata.imageUrl,
      });
      const image = new DocumentStore(archivedWorkspace).image(
        metadata.readerId,
        metadata.docId,
        metadata.imageId,
      );
      expect(image.mime).toBe('image/png');
      expect(image.data.length).toBe(metadata.imageBytes);
      expect(createHash('sha256').update(image.data).digest('hex')).toBe(metadata.imageSha256);
      const checkpoint = (await history.load(
        metadata.readerId,
        metadata.docId,
        metadata.historyCheckpointId,
      )) as IDocumentData;
      expect(checkpoint.body!.dataStream).toBe(metadata.expectedDocText);
      expect(
        history
          .list(metadata.readerId, metadata.docId)
          .find((point) => point.id === metadata.historyCheckpointId)?.name,
      ).toBe(metadata.historyCheckpointName);
      expect(
        ((await native.load(owner.id, metadata.sheetId)).snapshot as IWorkbookData).sheets[
          metadata.sheetTabId
        ].cellData![0][0].v,
      ).toBe(metadata.expectedSheetValue);
      expect(archivedWorkspace.get(metadata.readerId, metadata.sheetId).access).toBe('viewer');
      expect(archivedWorkspace.links.state(metadata.docId)?.state).toBe('active');
    } finally {
      try {
        await history.close();
      } finally {
        await native.close();
        archived.close();
      }
    }
    await archive.dispose();
  } finally {
    key.fill(0);
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
