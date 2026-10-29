import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AuthError } from '../auth/store.ts';
import type { AuthStore, Session } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import { captureRestoreAuthority } from '../maintenance/restore-authority.ts';
import { maintenanceRouter } from '../maintenance/router.ts';
import { MaintenanceError } from '../maintenance/gate.ts';
import { RESTORE_CONSEQUENCES } from '../../shared/restore.ts';
import { RestoreRegistryError } from './restore-registry.ts';
import type { RestoreRegistry } from './restore-registry.ts';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function keys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (
    !object(value) ||
    Object.keys(value).length !== allowed.length ||
    allowed.some((key) => !Object.hasOwn(value, key))
  )
    throw new AuthError(400, 'Invalid restore request.');
}

/** Mounted separately from backup exports so binary ciphertext is streamed,
 * never parsed or buffered as JSON and never confused with a SQLite upload. */
export function restoreRoutes(auth: AuthStore, registry: RestoreRegistry, origin: string) {
  const router = maintenanceRouter();
  const operator = (request: Request) => {
    const session = auth.session(cookieToken(request));
    const user = session?.user_id ? auth.user(session.user_id) : undefined;
    if (!session?.user_id || !user?.is_admin || user.disabled)
      throw new AuthError(404, 'Operator access is unavailable. Sign in again.');
    const account = request.headers['x-spinel-account'];
    if (account !== undefined && account !== session.user_id)
      throw new AuthError(409, 'Your account changed. Reload Admin before trying again.');
    if (request.method !== 'GET' && request.method !== 'HEAD' && account === undefined)
      throw new AuthError(400, 'Reload Admin before trying again.');
    return session;
  };
  const sameOperator = (prior: Session) => {
    const session = auth.sessionByHash(prior.token_hash);
    const user = session?.user_id ? auth.user(session.user_id) : undefined;
    if (!session?.user_id || session.user_id !== prior.user_id || !user?.is_admin || user.disabled)
      throw new AuthError(404, 'Operator access is unavailable. Sign in again.');
    return session;
  };
  const proof = (session: Session) => {
    const current = auth.requireVerified(sameOperator(session));
    return captureRestoreAuthority(
      auth.database,
      {
        actorId: current.user_id!,
        sessionHash: current.token_hash,
        expiresAt: Math.min(current.expires_at, auth.verifiedUntil(current)!),
      },
      auth.now,
    );
  };
  router.use((request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const upload = /^\/preparations\/[^/]+\/upload$/.test(request.path);
      if (
        request.headers.origin !== origin ||
        !request.is(upload ? 'application/octet-stream' : 'application/json') ||
        (request.headers['content-encoding'] !== undefined &&
          request.headers['content-encoding'] !== 'identity')
      )
        throw new AuthError(403, 'Open Spinel at its configured address and try again.');
    }
    next();
  });
  router.use(express.json({ limit: '1kb', strict: true }));
  router.get('/', async (request, response) => {
    const current = operator(request);
    const status = await registry.summary(current.user_id!, current.token_hash);
    sameOperator(current);
    response.json({
      ...status,
      consequencesVersion: 1,
      consequences: RESTORE_CONSEQUENCES,
    });
  });
  router.get('/catalog', async (request, response) => {
    const current = operator(request),
      catalog = await registry.catalog();
    sameOperator(current);
    response.json(catalog);
  });
  router.post('/preparations', async (request, response) => {
    const current = operator(request),
      authority = proof(current),
      body: unknown = request.body;
    if (!object(body) || (body.source !== 'upload' && body.source !== 'catalog'))
      throw new AuthError(400, 'Select an encrypted backup source.');
    keys(
      body,
      body.source === 'upload'
        ? ['requestId', 'source', 'key']
        : ['requestId', 'source', 'artifactId'],
    );
    if (typeof body.requestId !== 'string') throw new AuthError(400, 'Invalid restore request.');
    let source: Parameters<RestoreRegistry['create']>[2];
    if (body.source === 'upload') {
      if (typeof body.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(body.key))
        throw new AuthError(400, 'Choose the original 32-byte backup key.');
      const key = Buffer.from(body.key, 'base64');
      if (key.length !== 32 || key.toString('base64') !== body.key) {
        key.fill(0);
        throw new AuthError(400, 'Choose the original 32-byte backup key.');
      }
      body.key = ''; // do not retain the encoded secret while asynchronous work continues
      source = { kind: 'upload', key };
    } else {
      if (typeof body.artifactId !== 'string') throw new AuthError(400, 'Select a saved backup.');
      source = { kind: 'catalog', artifactId: body.artifactId };
    }
    const result = await registry.create(body.requestId, authority, source);
    try {
      sameOperator(current);
    } catch (error) {
      await registry.cancel(result.id, current.user_id!, current.token_hash);
      throw error;
    }
    response.status(202).json(result);
  });
  router.get('/preparations/:id', (request, response) => {
    const current = operator(request);
    response.json(registry.status(String(request.params.id), current.user_id!, current.token_hash));
  });
  router.post('/preparations/:id/upload', async (request, response) => {
    const current = operator(request);
    proof(current);
    const length = request.headers['content-length'];
    if (typeof length !== 'string' || !/^[1-9][0-9]{0,10}$/.test(length))
      throw new AuthError(411, 'Supply the encrypted backup size.');
    const result = await registry.upload(
      String(request.params.id),
      current.user_id!,
      current.token_hash,
      request,
      Number(length),
      () => request.destroy(),
    );
    sameOperator(current);
    response.json(result);
  });
  router.post('/preparations/:id/cancel', async (request, response) => {
    const current = operator(request);
    keys(request.body, []);
    const result = await registry.cancel(
      String(request.params.id),
      current.user_id!,
      current.token_hash,
    );
    sameOperator(current);
    response.json(result);
  });
  router.post('/preparations/:id/confirm', async (request, response) => {
    const current = operator(request);
    keys(request.body, ['confirmation', 'consequencesVersion', 'acceptLostWork']);
    if (
      typeof request.body.confirmation !== 'string' ||
      !/^[a-f0-9]{64}$/.test(request.body.confirmation) ||
      request.body.consequencesVersion !== 1 ||
      request.body.acceptLostWork !== true
    )
      throw new AuthError(400, 'Confirm the source, target and all restore consequences.');
    const result = await registry.confirm(
      String(request.params.id),
      current.user_id!,
      current.token_hash,
      request.body.confirmation,
      proof(current),
    );
    sameOperator(current);
    response.status(202).json(result);
  });
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const known =
      error instanceof AuthError ||
      error instanceof RestoreRegistryError ||
      error instanceof MaintenanceError;
    response.status(known ? error.status : 400).json({
      error: known
        ? error.message
        : 'The restore request could not complete. Refresh and try again.',
      ...(error instanceof MaintenanceError ? { code: error.code } : {}),
    });
  });
  return router;
}
