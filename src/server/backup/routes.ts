import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { AuthError } from '../auth/store.ts';
import type { AuthStore, Session } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import type { BackupService } from './service.ts';
import { ExportError } from './export-jobs.ts';
import { MAX_ARCHIVE_BYTES } from './transfer.ts';
import { MaintenanceError } from '../maintenance/gate.ts';
import { maintenanceRouter } from '../maintenance/router.ts';

const TOKEN_MS = 60_000;
const DELIVERY_MS = 10 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest();
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function empty(value: unknown) {
  if (!object(value) || Object.keys(value).length)
    throw new AuthError(400, 'Invalid backup request.');
}

/** Mounted only at /api/admin/backups; no archive or deployment input is accepted. */
export function backupRoutes(auth: AuthStore, backups: BackupService, origin: string) {
  const router = maintenanceRouter();
  // There can be only one retained export. Keep just one delivery capability,
  // in memory, hashed and bound to the initiating cookie session and job.
  let capability:
    { job: string; session: string; digest: Buffer; expiresAt: number; epoch: string } | undefined;
  const operator = (request: Request, account?: unknown): Session => {
    const session = auth.session(cookieToken(request));
    if (!session?.user_id || !auth.user(session.user_id)?.is_admin)
      throw new AuthError(404, 'Operator access is unavailable. Sign in again.');
    const expected = account ?? request.headers['x-spinel-account'];
    if (expected !== undefined && expected !== session.user_id)
      throw new AuthError(409, 'Your account changed. Reload Admin before trying again.');
    if (request.method !== 'GET' && expected === undefined)
      throw new AuthError(400, 'Reload Admin before trying again.');
    return session;
  };
  const sameOperator = (original: Session) => {
    const current = auth.sessionByHash(original.token_hash);
    if (
      !current?.user_id ||
      current.user_id !== original.user_id ||
      !auth.user(current.user_id)?.is_admin
    )
      throw new AuthError(404, 'Operator access is unavailable. Sign in again.');
    return current;
  };
  router.use((_request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  router.use((request, _response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const nativeDownload = /^\/exports\/[^/]+\/file$/.test(request.path);
      if (
        request.headers.origin !== origin ||
        !request.is(nativeDownload ? 'application/x-www-form-urlencoded' : 'application/json')
      )
        throw new AuthError(403, 'Open Spinel at its configured address and try again.');
    }
    next();
  });
  router.use(express.json({ limit: '1kb', strict: true }));
  router.use(express.urlencoded({ extended: false, limit: '1kb', parameterLimit: 2 }));
  router.get('/', (request, response) => {
    operator(request);
    response.json(backups.status());
  });
  router.get('/catalog', async (request, response) => {
    const current = operator(request);
    const catalog = await backups.exports.catalog();
    sameOperator(current);
    response.json(catalog);
  });
  router.get('/exports', async (request, response) => {
    const current = operator(request);
    const job = await backups.exports.current(current.token_hash);
    sameOperator(current);
    response.json({ job });
  });
  router.post('/exports', async (request, response) => {
    const current = auth.requireVerified(operator(request));
    const body: unknown = request.body;
    if (
      !object(body) ||
      Object.keys(body).some((key) => key !== 'artifactId') ||
      (body.artifactId !== undefined &&
        (typeof body.artifactId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.artifactId)))
    )
      throw new AuthError(400, 'Choose a published backup or create a workspace backup.');
    const job = await backups.exports.create(
      current.token_hash,
      body.artifactId as string | undefined,
    );
    try {
      auth.requireVerified(sameOperator(current));
    } catch (error) {
      await backups.exports.cancel(current.token_hash, job.id);
      throw error;
    }
    response.status(202).json({ job });
  });
  router.post('/exports/:id/cancel', async (request, response) => {
    const current = operator(request);
    empty(request.body);
    const id = String(request.params.id);
    const job = await backups.exports.cancel(current.token_hash, id);
    if (capability?.job === id && capability.session === current.token_hash) capability = undefined;
    sameOperator(current);
    response.json({ job });
  });
  router.post('/exports/:id/authorize', async (request, response) => {
    const current = auth.requireVerified(operator(request));
    empty(request.body);
    const job = await backups.exports.current(current.token_hash);
    auth.requireVerified(sameOperator(current));
    if (!job || job.id !== request.params.id || job.state !== 'ready')
      throw new AuthError(409, 'The backup is not ready. Refresh and try again.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(auth.now() + TOKEN_MS, job.expiresAt ?? 0);
    if (expiresAt <= auth.now()) throw new AuthError(410, 'This backup expired. Prepare another.');
    capability = {
      job: job.id,
      session: current.token_hash,
      digest: hash(token),
      expiresAt,
      // Keep the authorization request's admission even if a pause began
      // during its asynchronous status lookup; later state cannot renew it.
      epoch: backups.db.maintenance?.epoch ?? '',
    };
    response.json({ token, expiresAt });
  });
  router.post('/exports/:id/file', async (request, response) => {
    const body: unknown = request.body;
    if (
      !object(body) ||
      Object.keys(body).length !== 2 ||
      typeof body.accountId !== 'string' ||
      typeof body.token !== 'string' ||
      !/^[a-zA-Z0-9_-]{43}$/.test(body.token)
    )
      throw new AuthError(400, 'Invalid backup download.');
    const current = auth.requireVerified(operator(request, body.accountId));
    const id = String(request.params.id);
    if (
      !capability ||
      capability.job !== id ||
      capability.session !== current.token_hash ||
      capability.expiresAt <= auth.now() ||
      !timingSafeEqual(capability.digest, hash(body.token))
    )
      throw new AuthError(410, 'Download permission expired. Choose Download again.');
    backups.db.maintenance?.assertEpoch(capability.epoch);
    // Consume before the first await: a second request cannot reuse authority.
    capability = undefined;
    const download = await backups.exports.claim(current.token_hash, id);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, download.signal]);
    const closed = () => {
      if (!response.writableFinished) controller.abort();
    };
    response.once('close', closed);
    const watchdog = setTimeout(() => controller.abort(), DELIVERY_MS);
    watchdog.unref();
    const accessCheck = setInterval(() => {
      try {
        sameOperator(current);
      } catch {
        controller.abort();
      }
    }, 1000);
    accessCheck.unref();
    const releaseDrain = backups.db.maintenance?.cancelOnDrain(controller);
    let input: Awaited<ReturnType<typeof open>> | undefined;
    let stream: ReadStream | undefined;
    let success = false;
    try {
      auth.requireVerified(sameOperator(current));
      signal.throwIfAborted();
      input = await open(download.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await input.stat();
      if (
        !info.isFile() ||
        (info.mode & 0o077) !== 0 ||
        info.size !== download.bytes ||
        info.size <= 0 ||
        info.size > MAX_ARCHIVE_BYTES
      )
        throw new Error('Invalid staged backup.');
      auth.requireVerified(sameOperator(current));
      signal.throwIfAborted();
      response.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="spinel-workspace-backup.spinel"',
        'Content-Length': String(info.size),
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      // Native browser delivery and bounded stream backpressure avoid a whole
      // archive in either browser JS or server memory. No capability enters a URL.
      stream = input.createReadStream({ autoClose: false, highWaterMark: 128 * 1024 });
      await pipeline(stream, response, { signal });
      success = true;
    } finally {
      releaseDrain?.();
      clearTimeout(watchdog);
      clearInterval(accessCheck);
      response.removeListener('close', closed);
      try {
        stream?.destroy();
        await input?.close();
      } finally {
        await download.finish(success);
      }
    }
  });
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const known =
      error instanceof AuthError ||
      error instanceof ExportError ||
      error instanceof MaintenanceError;
    const status = known
      ? error.status
      : error instanceof Error && 'type' in error && error.type === 'entity.too.large'
        ? 413
        : 400;
    response.status(status).json({
      error: known
        ? error.message
        : 'The backup request could not complete. Refresh and try again.',
      ...(error instanceof MaintenanceError ? { code: error.code } : {}),
    });
  });
  return router;
}
