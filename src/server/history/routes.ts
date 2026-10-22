import express from 'express';
import type { Request } from 'express';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { resolveDocument } from '../workspace/document-access.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import type { HistoryStore } from './store.ts';

export type HistoryRouteIdentity = {
  userId: string;
  itemId: string;
  customData: Record<string, unknown>;
};

/**
 * Account history for one exact document. The parent owns the account session,
 * origin and no-store ingress; identity reads only trusted route parameters and
 * rechecks the current account whenever called. Guest namespaces never mount it.
 */
export function historyRoutes(
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  history: HistoryStore,
  identity: (request: Request) => HistoryRouteIdentity,
) {
  const router = express.Router({ mergeParams: true });
  router.use(express.json({ limit: '8kb', strict: true }));
  const check = (request: Request, original: HistoryRouteIdentity) => {
    const current = identity(request);
    if (
      current.userId !== original.userId ||
      current.itemId !== original.itemId ||
      current.customData.spaceId !== original.customData.spaceId ||
      current.customData.spaceItem !== original.customData.spaceItem
    )
      throw new AuthError(401, 'Sign in to continue.');
  };
  router.get('/', (request, response) => {
    const { userId, itemId, customData } = identity(request);
    const versions = history.list(userId, itemId, customData);
    const item = resolveDocument(workspace, userId, itemId, 'read', customData);
    response.json({ versions, canName: item.access !== 'viewer' });
  });
  router.post('/', async (request, response) => {
    const actor = identity(request);
    const version = await history.nameCurrent(
      actor.userId,
      actor.itemId,
      payload(request, ['name']).name,
      () => check(request, actor),
      actor.customData,
    );
    check(request, actor);
    response.status(201).json({ version });
  });
  router.patch('/:checkpoint', (request, response) => {
    const actor = identity(request);
    history.rename(
      actor.userId,
      actor.itemId,
      String(request.params.checkpoint),
      payload(request, ['name']).name,
      actor.customData,
    );
    response.json({ ok: true });
  });
  router.get('/:checkpoint', async (request, response) => {
    const actor = identity(request);
    const snapshot = await history.load(
      actor.userId,
      actor.itemId,
      String(request.params.checkpoint),
      actor.customData,
    );
    check(request, actor);
    response.json({
      snapshot,
      item: resolveDocument(workspace, actor.userId, actor.itemId, 'read', actor.customData),
      unitId: collaboration.generations.active(actor.itemId).unitId,
    });
  });
  router.post('/:checkpoint/restore', async (request, response) => {
    const actor = identity(request);
    const body = payload(request, ['requestId', 'unitId']);
    if (typeof body.requestId !== 'string' || typeof body.unitId !== 'string')
      throw new AuthError(400, 'Invalid restore request.');
    const result = await history.restore(
      actor.userId,
      actor.itemId,
      String(request.params.checkpoint),
      body.unitId,
      body.requestId,
      () => check(request, actor),
      actor.customData,
    );
    check(request, actor);
    response.json({ revision: result.revision, unitId: result.nextUnit });
  });
  return router;
}

function payload(request: Request, allowed: string[]): Record<string, unknown> {
  const body: unknown = request.body;
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key)) ||
    !Object.keys(body).length
  )
    throw new AuthError(400, 'Invalid item changes.');
  return body as Record<string, unknown>;
}
