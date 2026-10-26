import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import type { WorkspaceStore } from './store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { DocumentStore } from './documents.ts';
import { guestCookie, guestCookieName, linkGone } from './links.ts';
import { formulaRoutes } from '../formulas/routes.ts';
import { pdfRoutes } from '../pdf/routes.ts';
import { documentIdentity } from '../collaboration/identity.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceFiles } from './files.ts';

export function guestRoutes(
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  origin: string,
  privacyChanged: (id: string) => Promise<void>,
) {
  const router = express.Router(),
    links = workspace.links,
    documents = new DocumentStore(workspace);
  const json = express.json({ limit: '8kb', strict: true });
  const idOf = (request: Request) => {
    const id = String(request.params.id);
    if (!/^[a-f\d-]{36}$/.test(id)) throw linkGone();
    return id;
  };
  const identity = (request: Request) =>
    documentIdentity(workspace, request.headers, idOf(request));
  const owned = (request: Request) => {
    const user = workspace.auth.session(cookieToken(request))?.user_id;
    if (!user) throw new AuthError(401, 'Sign in to continue.');
    const item = new WorkspaceFiles(workspace).get(user, idOf(request), 'admin');
    if (!['sheet', 'doc', 'space'].includes(item.kind))
      throw new AuthError(400, 'Share links are for Sheets, Docs and Spaces.');
    return item;
  };
  const guard: express.RequestHandler = (request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method !== 'GET' && request.headers.origin !== origin)
      throw new AuthError(403, 'Open Spinel at its configured address.');
    next();
  };
  router.use('/api/guest', guard);
  router.use('/api/guest-spaces', guard);
  router.use('/api/guest/:id/formulas', formulaRoutes(workspace, collaboration, identity, true));
  router.use('/api/guest/:id/pdf', pdfRoutes(workspace, collaboration, identity));
  router.use('/api/items/:id/link', guard);
  const attempts = new Map<string, { until: number; count: number }>();
  router.post('/api/guest/:id/session', json, (request, response) => {
    if (!request.is('application/json')) throw new AuthError(400, 'Invalid request.');
    const now = Date.now(),
      key = request.ip ?? 'unknown';
    for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
    const attempt = attempts.get(key) ?? { until: now + 60_000, count: 0 };
    if (++attempt.count > 30 || (!attempts.has(key) && attempts.size >= 1000))
      throw new AuthError(429, 'Too many attempts. Try again in a minute.');
    attempts.set(key, attempt);
    const id = idOf(request),
      session = links.exchange(id, request.body?.token, guestCookie(request.headers, id));
    response.cookie(guestCookieName(id), session.token, {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      expires: new Date(session.expires),
    });
    response.sendStatus(204);
  });
  router.get('/api/guest/:id', (request, response) => {
    const id = idOf(request),
      actor = identity(request);
    const isSpace =
      workspace.spacesEnabled &&
      workspace.auth.database
        .prepare("SELECT 1 FROM workspace_items WHERE id=? AND kind='space'")
        .get(id);
    if (isSpace) {
      const scope = new SpaceStore(workspace).get(actor.userId, id);
      response.json({ item: { id, kind: 'space', name: scope.space.name, access: scope.access } });
      return;
    }
    const item = workspace.get(actor.userId, id);
    response.json({
      item: { id, kind: item.kind, name: item.name, access: item.access },
      live: {
        unitId: collaboration.generations.active(id).unitId,
        restoring: collaboration.generations.restoring(id),
      },
    });
  });
  router.post('/api/guest/:id/collaboration', json, async (request, response) => {
    const id = idOf(request),
      actor = identity(request),
      user = actor.userId;
    await collaboration.prepare(user, id, actor.customData);
    if (identity(request).userId !== user) throw linkGone();
    const item = workspace.get(user, id);
    response.json({
      unitId: collaboration.generations.active(id).unitId,
      ...(collaboration.sync && { syncVersion: 1 }),
      access: item.access,
      user: { id: user, name: 'Guest' },
    });
  });
  router.post(
    '/api/guest/:id/images',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
    async (request, response) => {
      const id = idOf(request),
        actor = identity(request),
        user = actor.userId;
      const image = await documents.upload(
        user,
        id,
        request.body,
        String(request.headers['content-type'] ?? '').split(';')[0],
        actor.customData,
      );
      if (identity(request).userId !== user) throw linkGone();
      response.status(201).json(image);
    },
  );
  // Native snapshots keep canonical scoped image URLs. Only this exact read route
  // accepts a guest cookie; no general account router or metadata listing is opened.
  router.get('/api/items/:id/images/:imageId', (request, response, next) => {
    const id = idOf(request);
    const membership = workspace.spacesEnabled
      ? (workspace.auth.database
          .prepare('SELECT space_id FROM workspace_items WHERE id=?')
          .get(id) as { space_id: string | null } | undefined)
      : undefined;
    const root = membership?.space_id ?? id;
    const scope = membership?.space_id ? { spaceId: root, spaceItem: id } : undefined;
    let actor: ReturnType<typeof documentIdentity> | undefined;
    if (guestCookie(request.headers, root)) {
      try {
        actor = documentIdentity(workspace, request.headers, root, scope);
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
      }
    }
    if (!actor && scope) {
      // Canonical images alone admit an independently valid account credential.
      // Never combine it with a guest credential or apply this fallback to editors.
      try {
        actor = documentIdentity(workspace, request.headers, undefined, scope);
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
      }
    }
    if (!actor) return next();
    const image = documents.image(
      actor.userId,
      id,
      String(request.params.imageId),
      actor.customData,
    );
    response
      .set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      .type(image.mime)
      .send(Buffer.from(image.data));
  });
  router.get('/api/items/:id/link', (request, response) => {
    const item = owned(request),
      state = links.state(item.id);
    response.json({ enabled: state?.state === 'active', role: state?.role ?? 'viewer' });
  });
  router.put('/api/items/:id/link', json, async (request, response) => {
    const item = owned(request),
      role: unknown = request.body?.role;
    if (
      !request.is('application/json') ||
      ![null, 'viewer', 'editor'].includes(role as string | null) ||
      Object.keys(request.body).some((key) => key !== 'role')
    )
      throw new AuthError(400, 'Choose a view or edit link, or turn the link off.');
    const change = links.begin(item.id, role as 'viewer' | 'editor' | null);
    try {
      await privacyChanged(item.id);
      owned(request); // Session/ownership may have changed while pending admissions drained.
      links.finish(item.id, change.epoch, Boolean(role));
      response.json({
        enabled: Boolean(role),
        role: role ?? 'viewer',
        url: change.token
          ? `${origin}/share/${item.id}?preview=${change.previewToken}#${change.token}`
          : null,
      });
    } catch (error) {
      links.finish(item.id, change.epoch, false);
      throw error;
    }
  });
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status =
      error instanceof AuthError
        ? error.status
        : (error as { status?: number })?.status === 413
          ? 413
          : error instanceof SyntaxError
            ? 400
            : 500;
    response.status(status).json({
      error:
        error instanceof AuthError
          ? error.message
          : status === 413
            ? 'This request is too large.'
            : status === 400
              ? 'Invalid request.'
              : 'Could not complete this request. Try again.',
    });
  });
  return router;
}
