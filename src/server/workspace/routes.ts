import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AuthError, AuthStore } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import { WorkspaceStore } from './store.ts';
import { SheetStore } from './sheets.ts';
import { DocumentStore } from './documents.ts';
import { TrashStore } from './trash.ts';

export function workspaceRoutes(auth: AuthStore, origin: string, store = new WorkspaceStore(auth)) {
  const router = express.Router();
  const trash = new TrashStore(store);
  const sheets = new SheetStore(store);
  const documents = new DocumentStore(store);
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
      (request.headers.origin !== origin ||
        (!request.is('application/json') &&
          !(
            request.method === 'POST' &&
            /^\/[^/]+\/images$/.test(request.path) &&
            request.is(['image/png', 'image/jpeg', 'image/webp'])
          )))
    )
      throw new AuthError(403, 'Open Spinel at its configured address and try again.');
    next();
  });
  router.get('/:id/sheet', (request, response) =>
    response.json(sheets.load(owner(request), String(request.params.id))),
  );
  router.put('/:id/sheet', express.json({ limit: '10mb', strict: true }), (request, response) => {
    response.json(
      sheets.save(
        owner(request),
        String(request.params.id),
        payload(request, ['snapshot', 'revision', 'writeId']),
      ),
    );
  });
  router.get('/:id/doc', (request, response) =>
    response.json(documents.load(owner(request), String(request.params.id))),
  );
  router.put('/:id/doc', express.json({ limit: '10mb', strict: true }), (request, response) => {
    response.json(
      documents.save(
        owner(request),
        String(request.params.id),
        payload(request, ['snapshot', 'revision', 'writeId']),
      ),
    );
  });
  router.post(
    '/:id/images',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
    async (request, response) => {
      response
        .status(201)
        .json(
          await documents.upload(
            owner(request),
            String(request.params.id),
            request.body,
            String(request.headers['content-type'] ?? '').split(';')[0],
          ),
        );
    },
  );
  router.get('/:id/images/:imageId', (request, response) => {
    const image = documents.image(
      owner(request),
      String(request.params.id),
      String(request.params.imageId),
    );
    response
      .set('X-Content-Type-Options', 'nosniff')
      .type(image.mime)
      .send(Buffer.from(image.data));
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
  router.get('/trash', (request, response) => response.json(trash.list(owner(request))));
  router.post('/trash/empty', (request, response) => {
    response.json(trash.empty(owner(request), payload(request, ['version']).version));
  });
  router.post('/:id/trash', (request, response) =>
    response.json(trash.trash(owner(request), String(request.params.id))),
  );
  router.post('/:id/restore', (request, response) =>
    response.json({ item: trash.restore(owner(request), String(request.params.id)) }),
  );
  router.get('/:id', (request, response) => {
    const user = owner(request),
      id = String(request.params.id);
    response.json({
      item: store.get(user, id),
      children: store.children(user, id),
      ancestors: store.ancestors(user, id),
    });
  });
  router.get('/:id/sharing', (request, response) =>
    response.json({ people: store.sharing(owner(request), String(request.params.id)) }),
  );
  router.put('/:id/sharing', (request, response) => {
    const body = payload(request, ['userId', 'role']);
    response.json({
      people: store.share(owner(request), String(request.params.id), body.userId, body.role),
    });
  });
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
  router.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const status =
      error instanceof AuthError
        ? error.status
        : (error as { status?: number })?.status === 413
          ? 413
          : 400;
    response.status(status).json({
      error:
        error instanceof AuthError
          ? error.message
          : status === 413
            ? request.path.endsWith('/images')
              ? 'Choose an image no larger than 5 MiB.'
              : 'This document is too large to save. Changes have not been saved.'
            : 'Could not save this change. Try again.',
    });
  });
  return router;
}
