import express from 'express';
import type { Request, Response } from 'express';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { DocFormulas } from './service.ts';
import { randomUUID } from 'node:crypto';
import { isUuid, observeOperation } from '@spinel/diagnostics';
import type { DiagnosticContext, DiagnosticEvent } from '@spinel/diagnostics';
import { resolveDocument } from '../workspace/document-access.ts';

export type FormulaIdentity = string | { userId: string; customData: Record<string, unknown> };
export type FormulaDiagnostics = (
  event: DiagnosticEvent,
  context: DiagnosticContext,
  actorId: string,
) => void;

function connection(request: Request, response: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => {
    if (!response.writableEnded) abort();
  };
  request.once('aborted', abort);
  response.once('close', close);
  if (request.aborted || response.destroyed) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      request.off('aborted', abort);
      response.off('close', close);
    },
  };
}

export function formulaRoutes(
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  identity: (request: Request) => FormulaIdentity,
  guest = false,
  itemParam: 'id' | 'itemId' = 'id',
  diagnostics?: FormulaDiagnostics,
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
      const lifetime = connection(request, response);
      try {
        response.json({
          sheets: await formulas.sheets(
            user,
            hostId(request),
            String(request.params.sourceId),
            verify,
            customData,
            lifetime.signal,
          ),
        });
      } finally {
        lifetime.dispose();
      }
    });
  }
  router.post('/resolve', async (request, response) => {
    const { user, customData, verify } = actor(request, () => response.destroyed);
    const lifetime = connection(request, response);
    try {
      response.json({
        definition: await formulas.resolve(
          user,
          hostId(request),
          request.body,
          verify,
          guest,
          customData,
          lifetime.signal,
        ),
      });
    } finally {
      lifetime.dispose();
    }
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
    const lifetime = connection(request, response);
    const header = request.headers['x-spinel-diagnostic-run'];
    // Unknown headers never break evaluation or become recorded arbitrary text.
    const runId = isUuid(header) ? header : randomUUID();
    const started = performance.now();
    const observed = (outcome: 'success' | 'failure') => {
      if (!diagnostics || guest || user.startsWith('guest:')) return;
      try {
        verify();
        resolveDocument(workspace, user, hostId(request), 'read', customData);
        const context: DiagnosticContext = {
          component: 'formula',
          fileId: hostId(request),
          runId,
          route: '/api/items',
          ...(typeof customData.spaceId === 'string' ? { spaceId: customData.spaceId } : {}),
        };
        observeOperation(
          (event, context) => diagnostics(event, context, user),
          context,
          'formula-evaluate',
          outcome,
          Math.max(0, performance.now() - started),
        );
      } catch {
        /* Lost access or diagnostics failure cannot alter evaluation semantics. */
      }
    };
    try {
      const result = await formulas.evaluate(
        user,
        hostId(request),
        request.body.definition,
        verify,
        guest,
        customData,
        lifetime.signal,
      );
      observed(result.ok ? 'success' : 'failure');
      response.json(result);
    } catch (error) {
      observed('failure');
      throw error;
    } finally {
      lifetime.dispose();
    }
  });
  return router;
}
