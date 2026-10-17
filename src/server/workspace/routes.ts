import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AuthError, AuthStore } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import { WorkspaceStore } from './store.ts';

export function workspaceRoutes(auth: AuthStore, origin: string) {
  const router = express.Router();
  const store = new WorkspaceStore(auth);
  const owner = (request: Request) => {
    const id = auth.session(cookieToken(request))?.user_id;
    if (!id) throw new AuthError(401, 'Sign in to continue.');
    store.owner(id);
    return id;
  };
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    owner(request);
    if (
      request.method !== 'GET' &&
      (request.headers.origin !== origin || !request.is('application/json'))
    )
      throw new AuthError(403, 'Open Spinel at its configured address and try again.');
    next();
  });
  router.use(express.json({ limit: '8kb', strict: true }));
  function payload(request: Request, allowed: string[]) {
    const body = request.body;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key)) ||
      !Object.keys(body).length
    )
      throw new AuthError(400, 'Invalid item changes.');
    return body;
  }
  router.get('/', (request, response) => response.json({ items: store.list(owner(request)) }));
  router.get('/:id', (request, response) =>
    response.json({ item: store.get(owner(request), String(request.params.id)) }),
  );
  router.post('/', (request, response) =>
    response
      .status(201)
      .json({ item: store.create(owner(request), payload(request, ['name', 'kind', 'parentId'])) }),
  );
  router.patch('/:id', (request, response) =>
    response.json({
      item: store.update(
        owner(request),
        String(request.params.id),
        payload(request, ['name', 'parentId']),
      ),
    }),
  );
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof AuthError ? error.status : 400;
    response.status(status).json({
      error: error instanceof AuthError ? error.message : 'Could not save this change. Try again.',
    });
  });
  return router;
}
