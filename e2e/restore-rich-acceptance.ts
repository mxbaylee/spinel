/** Real authenticated API assertions around the shipped browser restore flow.
 * Callers supply browser-context request clients; no cookies or sessions are seeded. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { OfflineCreationRequest } from '../src/shared/offlineCreation.ts';
import type { RestoreRichMetadata } from '../src/server/maintenance/restore-rich-fixture.ts';

type DocumentRead = { snapshot: IDocumentData; revision: number };
type SheetRead = { snapshot: IWorkbookData; revision: number };
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function json<T>(response: APIResponse, expected = 200): Promise<T> {
  assert.equal(response.status(), expected, 'Unexpected rich-restore API status.');
  return response.json() as Promise<T>;
}
async function api(request: APIRequestContext, origin: string, actor: string) {
  const maintenance = await json<{ epoch: string }>(
    await request.get(`${origin}/api/maintenance`, { timeout: 15_000 }),
  );
  assert.match(maintenance.epoch, /^[a-f\d-]{36}$/);
  const headers = {
    Origin: origin,
    'X-Spinel-Account': actor,
    'X-Spinel-Epoch': maintenance.epoch,
  };
  return {
    get: (path: string) => request.get(origin + path, { headers, timeout: 15_000 }),
    post: (path: string, data: unknown, extra: Record<string, string> = {}) =>
      request.post(origin + path, { headers: { ...headers, ...extra }, data, timeout: 15_000 }),
    put: (path: string, data: unknown) =>
      request.put(origin + path, { headers, data, timeout: 15_000 }),
  };
}

export interface RichRestoreBoundary {
  request: OfflineCreationRequest;
  acknowledged: true;
  previousEpoch: string;
}

/** Create an actual201-acknowledged item after the archive was made. Its lost
 * content must not be recreated by the identical old receipt after restore. */
export async function prepareRichRestoreBoundary(
  metadata: RestoreRichMetadata,
  request: APIRequestContext,
  origin: string,
): Promise<RichRestoreBoundary> {
  const owner = await api(request, origin, metadata.ownerId);
  const current = await json<DocumentRead>(await owner.get(`/api/items/${metadata.docId}/doc`));
  assert.equal(current.snapshot.body?.dataStream, metadata.currentDocText);
  const sheet = await json<SheetRead>(await owner.get(`/api/items/${metadata.sheetId}/sheet`));
  assert.equal(
    sheet.snapshot.sheets[metadata.sheetTabId].cellData?.[0]?.[0]?.v,
    metadata.currentSheetValue,
  );
  const payload: OfflineCreationRequest = {
    version: 1,
    itemId: randomUUID(),
    unitId: randomUUID(),
    kind: 'doc',
    name: 'Acknowledged after the archived backup',
    parentId: null,
  };
  const accepted = await json<{ item: { id: string }; unitId: string; revision: number }>(
    await owner.post('/api/items/offline-create', payload, {
      'X-Spinel-Offline-Account': metadata.ownerId,
    }),
    201,
  );
  assert.equal(accepted.item.id, payload.itemId);
  assert.equal(accepted.unitId, payload.unitId);
  assert.equal(accepted.revision, 1);
  assert.equal((await owner.get(`/api/items/${payload.itemId}/doc`)).status(), 200);
  const maintenance = await json<{ epoch: string }>(await owner.get('/api/maintenance'));
  return { request: payload, acknowledged: true, previousEpoch: maintenance.epoch };
}

/** Return only safe synthetic outcome evidence, never the old guest capability. */
export async function verifyRestoredRichWorkspace(
  metadata: RestoreRichMetadata,
  requests: { owner: APIRequestContext; reader: APIRequestContext },
  origin: string,
  prior: RichRestoreBoundary,
) {
  assert.equal(prior.acknowledged, true);
  const owner = await api(requests.owner, origin, metadata.ownerId);
  const reader = await api(requests.reader, origin, metadata.readerId);
  const maintenance = await json<{ epoch: string }>(await owner.get('/api/maintenance'));
  assert.notEqual(maintenance.epoch, prior.previousEpoch);
  const docPath = `/api/items/${metadata.docId}/doc`;
  const sheetPath = `/api/items/${metadata.sheetId}/sheet`;
  const doc = await json<DocumentRead>(await owner.get(docPath));
  const sheet = await json<SheetRead>(await owner.get(sheetPath));
  for (const [id, sourceUnit] of [
    [metadata.docId, metadata.sourceDocUnitId],
    [metadata.sheetId, metadata.sourceSheetUnitId],
  ]) {
    const item = await json<{ live: { unitId: string; restoring: boolean } }>(
      await owner.get(`/api/items/${id}`),
    );
    assert.match(item.live.unitId, /^[a-f\d-]{36}$/);
    assert.notEqual(item.live.unitId, sourceUnit);
    assert.equal(item.live.restoring, false);
  }
  assert.equal(doc.snapshot.body?.dataStream, metadata.expectedDocText);
  assert.equal(
    sheet.snapshot.sheets[metadata.sheetTabId].cellData?.[0]?.[0]?.v,
    metadata.expectedSheetValue,
  );
  const imagePath = `/api/items/${metadata.docId}/images/${metadata.imageId}`;
  for (const actor of [owner, reader]) {
    const image = await actor.get(imagePath);
    assert.equal(image.status(), 200);
    assert.match(image.headers()['content-type'], /^image\/png(?:;|$)/);
    assert.equal(hash(await image.body()), metadata.imageSha256);
  }
  const readerDoc = await json<DocumentRead>(await reader.get(docPath));
  assert.deepEqual(readerDoc.snapshot, doc.snapshot);
  const shared = await json<{ item: { access: string } }>(
    await reader.get(`/api/items/${metadata.docId}`),
  );
  assert.equal(shared.item.access, 'viewer');
  assert.equal((await reader.get(sheetPath)).status(), 404, 'Revoked grant returned.');
  assert.equal(
    (
      await reader.put(docPath, {
        snapshot: doc.snapshot,
        revision: doc.revision,
        writeId: randomUUID(),
      })
    ).status(),
    403,
    'Retained viewer gained write access.',
  );
  const versions = await json<{ versions: Array<{ id: string; name: string | null }> }>(
    await owner.get(`/api/items/${metadata.docId}/history`),
  );
  assert.ok(versions.versions.some((version) => version.id === metadata.historyCheckpointId));
  const historical = await json<{ snapshot: IDocumentData }>(
    await owner.get(`/api/items/${metadata.docId}/history/${metadata.historyCheckpointId}`),
  );
  assert.equal(historical.snapshot.body?.dataStream, metadata.expectedDocText);
  assert.equal(
    (
      await reader.post(`/api/guest/${metadata.docId}/session`, {
        token: metadata.revokedGuestToken,
      })
    ).status(),
    404,
    'Revoked guest capability returned.',
  );

  assert.equal((await owner.get(`/api/items/${prior.request.itemId}`)).status(), 404);
  const repeated = await owner.post('/api/items/offline-create', prior.request, {
    'X-Spinel-Offline-Account': metadata.ownerId,
  });
  const conflict = await json<{ code: string }>(repeated, 409);
  assert.equal(conflict.code, 'creation-conflict');
  assert.equal((await owner.get(`/api/items/${prior.request.itemId}`)).status(), 404);
  assert.deepEqual((await json<DocumentRead>(await owner.get(docPath))).snapshot, doc.snapshot);
  assert.deepEqual((await json<SheetRead>(await owner.get(sheetPath))).snapshot, sheet.snapshot);
  return {
    sheetContent: true,
    docContent: true,
    imageSha256: metadata.imageSha256,
    historyCheckpoint: true,
    retainedViewer: true,
    revokedGrantDenied: true,
    viewerWriteDenied: true,
    revokedGuestDenied: true,
    acknowledgedOldCreationRetryDenied: true,
    nativeGenerationRenewed: true,
    restoredContentUnchanged: true,
    documentSnapshotSha256: hash(JSON.stringify(doc.snapshot)),
    sheetSnapshotSha256: hash(JSON.stringify(sheet.snapshot)),
  };
}
