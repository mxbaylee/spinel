import { admitTransfer, transfers } from '../workspace/transfers.ts';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../auth/store.ts';
import { documentIdentity } from '../collaboration/identity.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { AppearanceStore } from './store.ts';
export function appearanceRoutes(
  workspace: WorkspaceStore,
  origin: string,
  store = new AppearanceStore(workspace),
) {
  const router = express.Router();
  for (const guest of [false, true])
    for (const scoped of [false, true]) {
      const prefix = `${guest ? '/guest' : ''}${scoped ? '/spaces/:spaceId' : ''}/items/:id`;
      const identity = (request: Request) => {
        const id = String(request.params.id),
          spaceId = scoped ? String(request.params.spaceId) : undefined;
        return documentIdentity(
          workspace,
          request.headers,
          guest ? (spaceId ?? id) : undefined,
          spaceId ? { spaceId, spaceItem: id } : undefined,
        );
      };
      router.use(prefix, (request, response, next) => {
        response.set('Cache-Control', 'no-store');
        store.authorize(identity(request), String(request.params.id), request.method !== 'GET');
        if (
          request.method !== 'GET' &&
          (request.headers.origin !== origin || !request.is('application/json'))
        )
          throw new AuthError(403, 'Open Spinel at its configured address and try again.');
        next();
      });
      router.get(prefix, (request, response) =>
        response.json(store.get(identity(request), String(request.params.id))),
      );
      router.get(prefix + '/assets/:hash', (request, response) =>
        response
          .set('X-Content-Type-Options', 'nosniff')
          .type('image/webp')
          .send(
            store.asset(identity(request), String(request.params.id), String(request.params.hash)),
          ),
      );
      router.get(prefix + '/unsplash', async (request, response) =>
        response.json({
          photos: await store.search(
            identity(request),
            String(request.params.id),
            typeof request.query.q === 'string' ? request.query.q : '',
          ),
        }),
      );
      router.patch(
        prefix,
        admitTransfer,
        express.json({ limit: '24mb', strict: true }),
        async (request, response) => {
          const transfer = transfers.get(response)!;
          transfer.start();
          try {
            response.json(
              await store.update(identity(request), String(request.params.id), request.body),
            );
          } finally {
            transfer.finish();
          }
        },
      );
    }
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status =
      error instanceof AuthError
        ? error.status
        : [400, 413].includes((error as { status?: number })?.status ?? 0)
          ? (error as { status: number }).status
          : 500;
    response.status(status).json({
      error:
        error instanceof AuthError
          ? error.message
          : status === 413
            ? 'Choose a smaller cover image.'
            : 'Could not save appearance. Try again.',
    });
  });
  return router;
}
