import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { SpaceBootstrap, SpaceNode, SpaceRoot, SpaceTreeData } from '../../shared/spaces.ts';
import { AuthError } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import type { WorkspaceStore } from './store.ts';
import type { SpaceScopeItem } from './space-scope.ts';
import { SpaceStore } from './spaces.ts';
import { SpaceRecoveryStore } from './space-recovery.ts';
import { checkOfflineAccount, documentIdentity } from '../collaboration/identity.ts';

function root(item: SpaceScopeItem): SpaceRoot {
  if (item.kind !== 'space' || item.spaceId !== null || item.position !== null)
    throw new AuthError(404, 'This Space is not available.');
  return { ...item, kind: 'space', spaceId: null, position: null };
}

function node(item: SpaceScopeItem): SpaceNode {
  if (
    item.kind === 'space' ||
    item.parentId === null ||
    item.spaceId === null ||
    item.position === null
  )
    throw new AuthError(404, 'This page is not available.');
  return {
    ...item,
    kind: item.kind,
    parentId: item.parentId,
    spaceId: item.spaceId,
    position: item.position,
  };
}

function payload(request: Request, keys: readonly string[]) {
  const value: unknown = request.body;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new AuthError(400, 'Check this Space change and try again.');
  return value as Record<string, unknown>;
}

/** Tree actions share one uniform root role; guest routers omit account-only actions. */
export function spaceRoutes(
  workspace: WorkspaceStore,
  origin: string,
  options: { spaceReview?: boolean; guest?: boolean } = {},
) {
  const router = express.Router();
  const spaces = new SpaceStore(workspace);
  const recovery = new SpaceRecoveryStore(workspace);
  const actor = (request: Request) => {
    if (options.guest) {
      const match = /^\/api\/guest-spaces\/([a-f\d-]{36})(?:\/|$)/.exec(
        new URL(request.originalUrl, origin).pathname,
      );
      if (!match) throw new AuthError(404, 'This Space is not available.');
      return documentIdentity(workspace, request.headers, match[1]).userId;
    }
    const id = workspace.auth.session(cookieToken(request))?.user_id;
    if (!id) throw new AuthError(401, 'Sign in to continue.');
    checkOfflineAccount(request.headers, id);
    workspace.owner(id);
    return id;
  };
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (!options.guest && request.headers['x-spinel-offline-account'] !== undefined)
      documentIdentity(workspace, request.headers);
    if (options.spaceReview !== true || !workspace.spacesEnabled)
      throw new AuthError(404, 'Not found.');
    actor(request);
    if (
      request.method !== 'GET' &&
      (request.headers.origin !== origin || !request.is('application/json'))
    )
      throw new AuthError(403, 'Open Spinel at its configured address and try again.');
    next();
  });
  router.use(express.json({ limit: '32kb', strict: true }));
  for (const name of ['spaceId', 'itemId'])
    router.param(name, (_request, _response, next, id: string) => {
      if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(id))
        throw new AuthError(404, 'This Space is not available.');
      next();
    });

  if (!options.guest) {
    router.get('/', (request, response) => {
      const user = actor(request);
      const result = workspace.auth.transaction((): SpaceBootstrap => ({
        spaces: spaces.roots(user).map((scope) => ({
          space: root(scope.space),
          access: scope.access,
        })),
        folders: workspace
          .list(user)
          .filter((item) => item.kind === 'folder')
          .map(({ id, name, parentId }) => ({ id, name, parentId })),
      }));
      response.json(result);
    });
    router.post('/', (request, response) => {
      const scope = spaces.createRoot(
        actor(request),
        payload(request, ['name', 'parentId', 'icon']),
      );
      response.status(201).json({ space: root(scope.space) });
    });
  }
  router.get('/:spaceId', (request, response) => {
    const scope = spaces.list(actor(request), String(request.params.spaceId));
    const result: SpaceTreeData = {
      space: root(scope.space),
      access: scope.access,
      items: scope.items.map(node),
    };
    response.json(result);
  });
  router.post('/:spaceId/items', (request, response) => {
    const scope = spaces.createChild(
      actor(request),
      String(request.params.spaceId),
      payload(request, ['name', 'kind', 'parentId', 'position', 'icon']),
    );
    response.status(201).json({ item: node(scope.item) });
  });
  router.patch('/:spaceId/items/:itemId', (request, response) => {
    const body = payload(request, ['name', 'parentId', 'position']);
    if (!Object.keys(body).length) throw new AuthError(400, 'Choose a change to make.');
    const scope = spaces.updateChild(
      actor(request),
      String(request.params.spaceId),
      String(request.params.itemId),
      body,
    );
    response.json({ item: node(scope.item) });
  });
  router.delete('/:spaceId/items/:itemId', (request, response) => {
    payload(request, []);
    const result = recovery.trash(
      actor(request),
      String(request.params.spaceId),
      String(request.params.itemId),
    );
    if (options.guest) response.sendStatus(204);
    else response.json(result);
  });
  if (!options.guest) {
    router.get('/:spaceId/trash', (request, response) => {
      response.json(recovery.list(actor(request), String(request.params.spaceId)));
    });
    router.post('/:spaceId/trash/:itemId/restore', (request, response) => {
      payload(request, []);
      const restored = recovery.restore(
        actor(request),
        String(request.params.spaceId),
        String(request.params.itemId),
      );
      response.json({ ...restored, item: node(restored.item) });
    });
    router.get('/:spaceId/trash/:itemId/delete-preview', (request, response) => {
      response.json(
        recovery.previewDelete(
          actor(request),
          String(request.params.spaceId),
          String(request.params.itemId),
        ),
      );
    });
    router.delete('/:spaceId/trash/:itemId', (request, response) => {
      response.json(
        recovery.delete(
          actor(request),
          String(request.params.spaceId),
          String(request.params.itemId),
          payload(request, ['version']).version,
        ),
      );
    });
  }
  router.use((_request, _response, _next) => {
    throw new AuthError(404, 'This Space action is not available.');
  });
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status =
      error instanceof AuthError
        ? error.status
        : (error as { status?: number })?.status === 413
          ? 413
          : (error as { status?: number })?.status === 400
            ? 400
            : 500;
    response.status(status).json({
      error:
        error instanceof AuthError
          ? error.message
          : status === 413
            ? 'This Space change is too large.'
            : 'Could not complete this Space action. Try again.',
    });
  });
  return router;
}
