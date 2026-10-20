import express from 'express';
import type { Request } from 'express';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { DocFormulas } from './service.ts';

export function formulaRoutes(
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  identity: (request: Request) => string,
  guest = false,
) {
  const router = express.Router({ mergeParams: true });
  const formulas = new DocFormulas(workspace, collaboration);
  const hostId = (request: Request) => String(request.params.id);
  router.use(express.json({ limit: '16kb', strict: true }));
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (request.method === 'POST' && !request.is('application/json'))
      throw new AuthError(400, 'Send a formula as JSON.');
    next();
  });
  const actor = (request: Request, closed: () => boolean) => {
    const user = identity(request);
    return {
      user,
      verify: () => {
        if (closed() || identity(request) !== user)
          throw new AuthError(401, 'Open the document again to continue.');
      },
    };
  };
  if (!guest) {
    router.get('/sources', (request, response) => {
      const { user, verify } = actor(request, () => response.destroyed);
      response.json({ sources: formulas.sources(user, hostId(request), verify) });
    });
    router.get('/sources/:sourceId', async (request, response) => {
      const { user, verify } = actor(request, () => response.destroyed);
      response.json({
        sheets: await formulas.sheets(
          user,
          hostId(request),
          String(request.params.sourceId),
          verify,
        ),
      });
    });
  }
  router.post('/resolve', async (request, response) => {
    const { user, verify } = actor(request, () => response.destroyed);
    response.json({
      definition: await formulas.resolve(user, hostId(request), request.body, verify, guest),
    });
  });
  router.post('/evaluate', async (request, response) => {
    if (
      !request.body ||
      typeof request.body !== 'object' ||
      Array.isArray(request.body) ||
      Object.keys(request.body).some((key) => key !== 'definition')
    )
      throw new AuthError(400, 'Send one formula definition.');
    const { user, verify } = actor(request, () => response.destroyed);
    response.json(
      await formulas.evaluate(user, hostId(request), request.body.definition, verify, guest),
    );
  });
  return router;
}
