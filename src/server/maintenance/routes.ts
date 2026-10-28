import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { MaintenanceAuthority, MaintenanceBridge } from '../../shared/maintenance.ts';
import { AuthError } from '../auth/store.ts';
import type { AuthStore } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** This narrow control lane never mutates the workspace or trusts archived authority. */
export function maintenanceRoutes(
  auth: AuthStore,
  bridge: MaintenanceBridge | undefined,
  origin: string,
) {
  const router = express.Router();
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('Referrer-Policy', 'no-referrer');
    const session = auth.session(cookieToken(request));
    if (!session?.user_id || !auth.user(session.user_id)?.is_admin)
      throw new AuthError(404, 'Not found.');
    if (request.get('X-Spinel-Account') !== session.user_id)
      throw new AuthError(409, 'Your account changed. Reload Administration before continuing.');
    if (request.method !== 'GET') {
      if (request.headers.origin !== origin || !request.is('application/json'))
        throw new AuthError(403, 'Open Spinel at its configured address and try again.');
      if (!bridge) throw new AuthError(503, 'Maintenance control is unavailable on this server.');
    }
    response.locals.maintenanceSession = session;
    next();
  });
  router.use(express.json({ limit: '4kb', strict: true }));
  router.get('/', (_request, response) => {
    response.json({
      status: bridge?.adminStatus() ?? {
        available: false,
        phase: 'running',
        epoch: '',
        notice: null,
        operationId: null,
        authorityExpiresAt: null,
        generationId: '',
        lastFailure: null,
        readyToResume: false,
      },
    });
  });
  const authority = (response: Response, intentExpiresAt: unknown): MaintenanceAuthority => {
    const session = auth.requireVerified(response.locals.maintenanceSession);
    // Recheck current role and session after asynchronous parsing and before IPC.
    if (!session.user_id || !auth.user(session.user_id)?.is_admin)
      throw new AuthError(404, 'Not found.');
    // The body captures this server-issued verification deadline. Re-verifying
    // later must never renew a delayed request after its durable receipt expires.
    if (
      !Number.isSafeInteger(intentExpiresAt) ||
      typeof intentExpiresAt !== 'number' ||
      intentExpiresAt <= Date.now() ||
      intentExpiresAt > Math.min(session.expires_at, auth.verifiedUntil(session)!)
    )
      throw new AuthError(
        428,
        'This maintenance action expired. Start it again and verify with a passkey.',
      );
    return {
      actorId: session.user_id,
      sessionHash: session.token_hash,
      expiresAt: intentExpiresAt,
    };
  };
  function body(request: Request, keys: string[]) {
    const value = request.body;
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      Object.keys(value).some((key) => !keys.includes(key)) ||
      !uuid.test(value.operationId ?? '')
    )
      throw new AuthError(400, 'Start a new maintenance action and try again.');
    return value;
  }
  router.post('/pause', async (request, response) => {
    const value = body(request, ['operationId', 'intentExpiresAt']);
    response.json(
      await bridge!.control({
        action: 'pause',
        operationId: value.operationId,
        authority: authority(response, value.intentExpiresAt),
      }),
    );
  });
  router.post('/resume', async (request, response) => {
    const value = body(request, ['operationId', 'resumeToken']);
    if (typeof value.resumeToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.resumeToken))
      throw new AuthError(403, 'This pause needs the Operator’s recovery controls to resume.');
    const session = auth.sessionByHash(response.locals.maintenanceSession.token_hash);
    if (!session?.user_id || !auth.user(session.user_id)?.is_admin)
      throw new AuthError(404, 'Not found.');
    response.json(
      await bridge!.control({
        action: 'resume',
        operationId: value.operationId,
        // The token alone is not enough: only the Operator who paused may resume.
        actorId: session.user_id,
        resumeToken: value.resumeToken,
      }),
    );
  });
  router.post('/notice', async (request, response) => {
    const value = body(request, [
      'operationId',
      'intentExpiresAt',
      'id',
      'startsAt',
      'timeZone',
      'durationMinutes',
    ]);
    response.json(
      await bridge!.control({
        action: 'notice',
        operationId: value.operationId,
        authority: authority(response, value.intentExpiresAt),
        notice: {
          id: value.id,
          startsAt: value.startsAt,
          timeZone: value.timeZone,
          durationMinutes: value.durationMinutes,
        },
      }),
    );
  });
  router.post('/cancel-notice', async (request, response) => {
    const value = body(request, ['operationId', 'intentExpiresAt', 'noticeId']);
    response.json(
      await bridge!.control({
        action: 'cancel-notice',
        operationId: value.operationId,
        authority: authority(response, value.intentExpiresAt),
        noticeId: value.noticeId,
      }),
    );
  });
  router.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof AuthError ? error.status : 409;
    const session = auth.session(cookieToken(request));
    const operator =
      session?.user_id &&
      auth.user(session.user_id)?.is_admin &&
      request.get('X-Spinel-Account') === session.user_id;
    response.status(status).json({
      error:
        error instanceof AuthError
          ? error.message
          : 'Maintenance could not change. Refresh its status before trying again.',
      ...(bridge && operator && { status: bridge.adminStatus() }),
    });
  });
  return router;
}
