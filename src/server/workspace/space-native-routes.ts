import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { CollabError } from '@univerjs-pro/collaboration-service';
import { AuthError } from '../auth/store.ts';
import { documentIdentity } from '../collaboration/identity.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from './store.ts';
import { SpaceStore } from './spaces.ts';
import { DocumentStore } from './documents.ts';
import { PortableFiles } from './portable.ts';
import { formulaRoutes } from '../formulas/routes.ts';
import type { FormulaDiagnostics } from '../formulas/routes.ts';
import { historyRoutes } from '../history/routes.ts';
import type { HistoryStore } from '../history/store.ts';
import { admitTransfer, transfers } from './transfers.ts';

/** Existing native integrations, admitted through one exact Space + child namespace. */
export function spaceNativeRoutes(
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  origin: string,
  options: {
    spaceReview?: boolean;
    guest?: boolean;
    history?: HistoryStore;
    diagnostics?: FormulaDiagnostics;
  } = {},
) {
  const router = express.Router({ mergeParams: true });
  const spaces = new SpaceStore(workspace);
  const documents = new DocumentStore(workspace);
  const files = new PortableFiles(workspace, collaboration);
  const scopeOf = (request: Request) => {
    const spaceId = String(request.params.spaceId),
      spaceItem = String(request.params.itemId);
    if (!/^[a-f\d-]{36}$/.test(spaceId) || !/^[a-f\d-]{36}$/.test(spaceItem))
      throw new AuthError(404, 'This Space is not available.');
    return { spaceId, spaceItem };
  };
  const identity = (request: Request) =>
    documentIdentity(
      workspace,
      request.headers,
      options.guest ? scopeOf(request).spaceId : undefined,
      scopeOf(request),
    );
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (!options.spaceReview || !workspace.spacesEnabled)
      throw new AuthError(404, 'This Space is not available.');
    if (request.method !== 'GET' && request.headers.origin !== origin)
      throw new AuthError(403, 'Open Spinel at its configured address.');
    next();
  });
  router.use(
    '/formulas',
    formulaRoutes(
      workspace,
      collaboration,
      identity,
      options.guest,
      'itemId',
      options.guest ? undefined : options.diagnostics,
    ),
  );
  router.post(
    '/images',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
    async (request, response) => {
      const actor = identity(request);
      const image = await documents.upload(
        actor.userId,
        scopeOf(request).spaceItem,
        request.body,
        String(request.headers['content-type'] ?? '').split(';')[0],
        actor.customData,
      );
      response.status(201).json(image);
    },
  );
  router.get('/images/:imageId', (request, response) => {
    const actor = identity(request);
    const image = documents.image(
      actor.userId,
      scopeOf(request).spaceItem,
      String(request.params.imageId),
      actor.customData,
    );
    response
      .set('X-Content-Type-Options', 'nosniff')
      .type(image.mime)
      .send(Buffer.from(image.data));
  });
  if (!options.guest) {
    if (options.history)
      router.use(
        '/history',
        historyRoutes(workspace, collaboration, options.history, (request) => ({
          ...identity(request),
          itemId: scopeOf(request).spaceItem,
        })),
      );
    router.get('/export', admitTransfer, async (request, response) => {
      const transfer = transfers.get(response)!;
      transfer.start();
      try {
        const actor = identity(request);
        const verify = () => {
          if (response.destroyed || identity(request).userId !== actor.userId)
            throw new AuthError(401, 'Sign in to continue.');
        };
        const file = await files.export(
          actor.userId,
          scopeOf(request).spaceItem,
          verify,
          actor.customData,
        );
        response
          .attachment(file.filename)
          .type('application/json')
          .set('X-Content-Type-Options', 'nosniff')
          .send(file.text);
      } finally {
        transfer.finish();
      }
    });
    router.get('/offline-bundle', admitTransfer, async (request, response) => {
      const transfer = transfers.get(response)!;
      transfer.start();
      try {
        const actor = identity(request);
        const verify = () => {
          if (response.destroyed || identity(request).userId !== actor.userId)
            throw new AuthError(401, 'Sign in to continue.');
        };
        const bundle = await collaboration.offlineBundle(
          actor.userId,
          scopeOf(request).spaceItem,
          verify,
          actor.customData,
        );
        verify();
        response.json(bundle);
      } finally {
        transfer.finish();
      }
    });
  }
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
        ...(collaboration.sync && { syncVersion: 1 }),
        access: item.access,
        user: {
          id: account.userId,
          name: options.guest ? 'Guest' : workspace.auth.user(account.userId)!.name,
        },
      });
    },
  );
  router.use((request, _response, next) => {
    if (request.path === '/' && ['PATCH', 'DELETE'].includes(request.method)) return next('router');
    throw new AuthError(404, 'This Space action is not available.');
  });
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
