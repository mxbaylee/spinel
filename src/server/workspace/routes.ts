import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AuthError, AuthStore } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import { WorkspaceStore } from './store.ts';
import { WorkspaceFiles } from './files.ts';
import { SheetStore } from './sheets.ts';
import { DocumentStore } from './documents.ts';
import { TrashStore } from './trash.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { HistoryStore } from '../history/store.ts';
import { PortableFiles, PORTABLE_LIMIT } from './portable.ts';
import { formulaRoutes } from '../formulas/routes.ts';
import type { FormulaDiagnostics } from '../formulas/routes.ts';
import { checkOfflineAccount, documentIdentity } from '../collaboration/identity.ts';
import { historyRoutes } from '../history/routes.ts';
import { admitTransfer, transfers } from './transfers.ts';
import { archiveRoutes } from './archive-routes.ts';
import { pdfRoutes } from '../pdf/routes.ts';

export function workspaceRoutes(
  auth: AuthStore,
  origin: string,
  store = new WorkspaceStore(auth),
  collaboration?: CollaborationStore,
  history?: HistoryStore,
  diagnostics?: FormulaDiagnostics,
) {
  const router = express.Router();
  const trash = new TrashStore(store);
  const catalog = new WorkspaceFiles(store);
  const sheets = new SheetStore(store);
  const documents = new DocumentStore(store);
  const files = new PortableFiles(store, collaboration);
  const account = (request: Request) => documentIdentity(store, request.headers);
  const owner = (request: Request) => {
    const id = auth.session(cookieToken(request))?.user_id;
    if (!id) throw new AuthError(401, 'Sign in to continue.');
    checkOfflineAccount(request.headers, id);
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
          ) &&
          !(
            request.method === 'POST' &&
            request.path === '/archive-import' &&
            request.is('application/zip')
          )))
    )
      throw new AuthError(403, 'Open Spinel at its configured address and try again.');
    next();
  });
  router.use(archiveRoutes(store, files));
  if (collaboration) router.use('/:id/pdf', pdfRoutes(store, collaboration, account));
  if (collaboration)
    router.use(
      '/:id/formulas',
      formulaRoutes(store, collaboration, account, false, 'id', diagnostics),
    );
  const native = async (request: Request, response: Response, kind: 'sheet' | 'doc') => {
    const identity = account(request),
      user = identity.userId,
      id = String(request.params.id);
    const original = kind === 'sheet' ? sheets.load(user, id) : documents.load(user, id);
    response.json(
      collaboration &&
        auth.database.prepare('SELECT 1 FROM workspace_collaboration WHERE item_id=?').get(id)
        ? await collaboration.load(user, id, identity.customData)
        : original,
    );
  };
  router.get('/search', (request, response) => {
    response.json({ items: catalog.find(owner(request), request.query) });
  });
  router.get('/:id/sheet', (request, response) => native(request, response, 'sheet'));
  router.put('/:id/sheet', express.json({ limit: '10mb', strict: true }), (request, response) => {
    response.json(
      sheets.save(
        owner(request),
        String(request.params.id),
        payload(request, ['snapshot', 'revision', 'writeId']),
      ),
    );
  });
  router.get('/:id/doc', (request, response) => native(request, response, 'doc'));
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
      const identity = account(request);
      response
        .status(201)
        .json(
          await documents.upload(
            identity.userId,
            String(request.params.id),
            request.body,
            String(request.headers['content-type'] ?? '').split(';')[0],
            identity.customData,
          ),
        );
    },
  );
  router.get('/:id/images/:imageId', (request, response) => {
    const identity = account(request);
    const image = documents.image(
      identity.userId,
      String(request.params.id),
      String(request.params.imageId),
      identity.customData,
    );
    response
      .set('X-Content-Type-Options', 'nosniff')
      .type(image.mime)
      .send(Buffer.from(image.data));
  });
  router.post(
    '/offline-recovery',
    admitTransfer,
    express.json({ limit: PORTABLE_LIMIT + 4096, strict: true }),
    async (request, response) => {
      const transfer = transfers.get(response)!;
      transfer.start();
      try {
        const user = owner(request);
        if (request.headers['x-spinel-offline-account'] !== user)
          throw new AuthError(409, 'The signed-in account changed. Reopen Spinel.');
        const item = await files.recover(
          user,
          payload(request, ['recoveryId', 'filename', 'snapshot', 'possibleReplayCrash']),
          () => {
            if (owner(request) !== user || response.destroyed)
              throw new AuthError(401, 'Sign in to continue.');
          },
        );
        response.status(201).json({ item });
      } finally {
        transfer.finish();
      }
    },
  );
  router.post(
    '/import',
    admitTransfer,
    express.json({ limit: PORTABLE_LIMIT + 4096, strict: true }),
    async (request, response) => {
      const transfer = transfers.get(response)!;
      transfer.start();
      try {
        const user = owner(request);
        const item = await files.import(
          user,
          payload(request, ['filename', 'parentId', 'snapshot']),
          () => {
            if (owner(request) !== user || response.destroyed)
              throw new AuthError(401, 'Sign in to continue.');
          },
        );
        response.status(201).json({ item });
      } finally {
        transfer.finish();
      }
    },
  );
  router.get('/:id/export', admitTransfer, async (request, response) => {
    const transfer = transfers.get(response)!;
    transfer.start();
    try {
      const identity = account(request),
        user = identity.userId;
      const file = await files.export(
        user,
        String(request.params.id),
        () => {
          if (owner(request) !== user || response.destroyed)
            throw new AuthError(401, 'Sign in to continue.');
        },
        identity.customData,
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
  router.get('/:id/offline-bundle', admitTransfer, async (request, response) => {
    const transfer = transfers.get(response)!;
    transfer.start();
    try {
      if (!collaboration) throw new AuthError(503, 'Offline downloads are not available.');
      const identity = account(request),
        user = identity.userId,
        id = String(request.params.id);
      const verify = () => {
        if (owner(request) !== user || response.destroyed)
          throw new AuthError(401, 'Sign in to continue.');
      };
      if (!['sheet', 'doc'].includes(store.get(user, id).kind))
        throw new AuthError(400, 'Only Sheets and Docs can be downloaded.');
      const bundle = await collaboration.offlineBundle(user, id, verify, identity.customData);
      verify();
      response.json(bundle);
    } finally {
      transfer.finish();
    }
  });
  if (history && collaboration)
    router.use(
      '/:id/history',
      historyRoutes(store, collaboration, history, (request) => ({
        ...account(request),
        itemId: String(request.params.id),
      })),
    );
  else
    router.use('/:id/history', () => {
      throw new AuthError(503, 'History is not available.');
    });
  router.use(express.json({ limit: '8kb', strict: true }));
  router.post('/:id/collaboration', async (request, response) => {
    if (!collaboration) throw new AuthError(503, 'Collaboration is not available.');
    const identity = account(request),
      user = identity.userId,
      id = String(request.params.id);
    await collaboration.prepare(user, id, identity.customData);
    const item = store.get(owner(request), id);
    response.json({
      unitId: collaboration.generations.active(id).unitId,
      syncVersion: 1,
      access: item.access,
      user: { id: user, name: auth.user(user)!.name },
    });
  });
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
  router.get('/shared', (request, response) =>
    response.json({ items: catalog.shared(owner(request)) }),
  );
  router.put('/:id/placement', (request, response) =>
    response.json({
      items: catalog.place(
        owner(request),
        String(request.params.id),
        payload(request, ['parentId']).parentId,
      ),
    }),
  );
  router.delete('/:id/placement', (request, response) =>
    response.json({
      items: catalog.place(owner(request), String(request.params.id), null, true),
    }),
  );
  router.get('/tags', (request, response) =>
    response.json({ tags: catalog.tagSuggestions(owner(request)) }),
  );
  for (const method of ['post', 'delete'] as const)
    router[method]('/:id/tags', (request, response) =>
      response.json({
        item: catalog.changeTag(
          owner(request),
          String(request.params.id),
          payload(request, ['tag']).tag,
          method === 'delete',
        ),
      }),
    );
  router.get('/', (request, response) =>
    response.json({
      items: catalog.list(owner(request)),
      spacesEnabled: store.spacesEnabled,
    }),
  );
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
    const item = catalog.get(user, id);
    response.json({
      item,
      live:
        collaboration && (item.kind === 'doc' || item.kind === 'sheet')
          ? {
              unitId: collaboration.generations.active(id).unitId,
              restoring: collaboration.generations.restoring(id),
            }
          : undefined,
      children: catalog.children(user, id),
      ancestors: catalog.ancestors(user, id),
    });
  });
  router.get('/:id/sharing', (request, response) =>
    response.json({ people: catalog.sharing(owner(request), String(request.params.id)) }),
  );
  router.get('/:id/destinations', (request, response) =>
    response.json({ items: catalog.moveDestinations(owner(request), String(request.params.id)) }),
  );
  router.put('/:id/sharing', (request, response) => {
    const body = payload(request, ['userId', 'role']);
    response.json({
      people: catalog.share(owner(request), String(request.params.id), body.userId, body.role),
    });
  });
  router.post('/', (request, response) =>
    response.status(201).json({
      item: catalog.create(owner(request), payload(request, ['name', 'kind', 'parentId'])),
    }),
  );
  router.patch('/:id', (request, response) =>
    response.json({
      item: catalog.update(
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
            ? request.path === '/import' || request.path === '/offline-recovery'
              ? 'Univer files must be at most 20 MiB.'
              : request.path.endsWith('/images')
                ? 'Choose an image no larger than 5 MiB.'
                : 'This document is too large to save. Changes have not been saved.'
            : 'Could not save this change. Try again.',
    });
  });
  return router;
}
