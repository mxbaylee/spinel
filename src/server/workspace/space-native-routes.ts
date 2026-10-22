import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { CollabError } from '@univerjs-pro/collaboration-service';
import { AuthError } from '../auth/store.ts';
import { documentIdentity } from '../collaboration/identity.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from './store.ts';
import { SpaceStore } from './spaces.ts';

/** Review-only metadata and native admission. No image/history/export APIs are mounted. */
export function spaceNativeRoutes(
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  origin: string,
  options: { spaceReview?: boolean } = {},
) {
  const router = express.Router({ mergeParams: true });
  const spaces = new SpaceStore(workspace);
  const scopeOf = (request: Request) => {
    const spaceId = String(request.params.spaceId),
      spaceItem = String(request.params.itemId);
    if (!/^[a-f\d-]{36}$/.test(spaceId) || !/^[a-f\d-]{36}$/.test(spaceItem))
      throw new AuthError(404, 'This Space is not available.');
    return { spaceId, spaceItem };
  };
  const identity = (request: Request) =>
    documentIdentity(workspace, request.headers, undefined, scopeOf(request));
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (!options.spaceReview) throw new AuthError(404, 'This Space is not available.');
    if (request.method !== 'GET' && request.headers.origin !== origin)
      throw new AuthError(403, 'Open Spinel at its configured address.');
    next();
  });
  router.get('/', (request, response) => {
    const account = identity(request);
    const { spaceId, spaceItem } = scopeOf(request);
    const scope = spaces.get(account.userId, spaceId, spaceItem);
    const native = scope.item.kind === 'doc' || scope.item.kind === 'sheet';
    response.json({
      item: { ...scope.item, access: scope.access },
      ...(native
        ? {
            live: {
              unitId: collaboration.generations.active(scope.item.id).unitId,
              restoring: collaboration.generations.restoring(scope.item.id),
            },
          }
        : {}),
    });
  });
  router.post(
    '/collaboration',
    express.json({ limit: '8kb', strict: true }),
    async (request, response) => {
      if (
        !request.is('application/json') ||
        !request.body ||
        Array.isArray(request.body) ||
        Object.keys(request.body).length
      )
        throw new AuthError(400, 'Send an empty JSON object.');
      const account = identity(request),
        id = scopeOf(request).spaceItem;
      await collaboration.prepare(account.userId, id, account.customData);
      const item = collaboration.access(
        account.userId,
        collaboration.generations.active(id).unitId,
        false,
        account.customData,
      );
      response.json({
        unitId: collaboration.generations.active(id).unitId,
        access: item.access,
        user: { id: account.userId, name: workspace.auth.user(account.userId)!.name },
      });
    },
  );
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status =
      error instanceof AuthError
        ? error.status
        : error instanceof CollabError
          ? 403
          : error instanceof SyntaxError
            ? 400
            : (error as { status?: number })?.status === 413
              ? 413
              : 500;
    response.status(status).json({
      error:
        error instanceof AuthError
          ? error.message
          : status === 403
            ? 'This document is not available.'
            : status === 400
              ? 'Invalid request.'
              : status === 413
                ? 'This request is too large.'
                : 'Could not open this document. Try again.',
    });
  });
  return router;
}
