import express from 'express';
import type { Request } from 'express';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { DocFormulas } from './service.ts';

export type FormulaIdentity = string | { userId: string; customData: Record<string, unknown> };

export function formulaRoutes(
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  identity: (request: Request) => FormulaIdentity,
  guest = false,
  itemParam: 'id' | 'itemId' = 'id',
) {
  const router = express.Router({ mergeParams: true });
  const formulas = new DocFormulas(workspace, collaboration);
  const hostId = (request: Request) => String(request.params[itemParam]);
  router.use(express.json({ limit: '16kb', strict: true }));
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (request.method === 'POST' && !request.is('application/json'))
      throw new AuthError(400, 'Send a formula as JSON.');
    next();
  });
  const actor = (request: Request, closed: () => boolean) => {
    const initial = identity(request);
    const user = typeof initial === 'string' ? initial : initial.userId;
    // Retain the original ingress credential for every asynchronous check. A
    // later account identity must never replace a guest or revoked capability.
    const customData = typeof initial === 'string' ? {} : { ...initial.customData };
    return {
      user,
      customData,
      verify: () => {
        const current = identity(request);
        if (closed() || (typeof current === 'string' ? current : current.userId) !== user)
          throw new AuthError(401, 'Open the document again to continue.');
      },
    };
  };
  if (!guest || itemParam === 'itemId') {
    router.get('/sources', (request, response) => {
      const { user, customData, verify } = actor(request, () => response.destroyed);
      response.json({ sources: formulas.sources(user, hostId(request), verify, customData) });
    });
    router.get('/sources/:sourceId', async (request, response) => {
      const { user, customData, verify } = actor(request, () => response.destroyed);
      response.json({
        sheets: await formulas.sheets(
          user,
          hostId(request),
          String(request.params.sourceId),
          verify,
          customData,
        ),
      });
    });
  }
  router.post('/resolve', async (request, response) => {
    const { user, customData, verify } = actor(request, () => response.destroyed);
    response.json({
      definition: await formulas.resolve(
        user,
        hostId(request),
        request.body,
        verify,
        guest,
        customData,
      ),
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
    const { user, customData, verify } = actor(request, () => response.destroyed);
    response.json(
      await formulas.evaluate(
        user,
        hostId(request),
        request.body.definition,
        verify,
        guest,
        customData,
      ),
    );
  });
  return router;
}
