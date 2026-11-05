import { maintenanceRouter } from '../maintenance/router.ts';
import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  exactKeys,
  isClientDiagnosticEvent,
  isDiagnosticRecord,
  isObject,
  isUuid,
  MAX_BATCH_BYTES,
  MAX_BATCH_EVENTS,
} from '@spinel/diagnostics';
import type { DiagnosticRecord } from '@spinel/diagnostics';
import { AuthError } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { resolveDocument } from '../workspace/document-access.ts';
import { DiagnosticsError, DiagnosticsStore } from './store.ts';

/** One minute buckets, bounded even when many authenticated users send events. */
export class DiagnosticRateLimit {
  private readonly actors = new Map<string, { start: number; count: number }>();
  private global = { start: 0, count: 0 };
  private readonly now: () => number;
  constructor(now = Date.now) {
    this.now = now;
  }
  take(actor: string, count: number) {
    const now = this.now();
    if (now - this.global.start >= 60_000 || now < this.global.start)
      this.global = { start: now, count: 0 };
    for (const [key, value] of this.actors)
      if (now - value.start >= 60_000 || now < value.start) this.actors.delete(key);
    const current = this.actors.get(actor) ?? { start: now, count: 0 };
    if (
      (!this.actors.has(actor) && this.actors.size >= 1024) ||
      current.count + count > 120 ||
      this.global.count + count > 600
    )
      return false;
    current.count += count;
    this.global.count += count;
    this.actors.set(actor, current);
    return true;
  }
}

/** Mount beneath /api; independent cookie checks also protect direct router reuse. */
export function diagnosticsRoutes(
  workspace: WorkspaceStore,
  diagnostics: DiagnosticsStore,
  origin: string,
) {
  const router = maintenanceRouter();
  router.use((request, _response, next) => {
    // Do not impose this tiny parser or Origin policy on unrelated /api routes.
    if (
      !request.path.startsWith('/diagnostics/') &&
      request.path !== '/admin/diagnostics' &&
      !request.path.startsWith('/admin/diagnostics/')
    )
      next('router');
    else next();
  });
  const rate = new DiagnosticRateLimit();
  const bindingKey = randomBytes(32);
  const collectionBinding = (sessionHash: string) =>
    createHmac('sha256', bindingKey).update(sessionHash).digest('hex');
  const session = (request: Request, operator = false) => {
    const current = workspace.auth.session(cookieToken(request));
    const user = current?.user_id && workspace.auth.user(current.user_id);
    if (!current?.user_id || !user)
      throw new AuthError(401, 'Your session expired. Sign in again.');
    if (operator && !user.is_admin) throw new AuthError(404, 'Not found.');
    return { current, user };
  };
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.use((request, _response, next) => {
    if (
      request.method !== 'GET' &&
      (request.headers.origin !== origin || !request.is('application/json'))
    )
      throw new AuthError(403, 'Open Spinel at its configured address and try again.');
    next();
  });
  router.use(express.json({ limit: MAX_BATCH_BYTES, strict: true }));
  router.get('/diagnostics/collection', (request, response) => {
    const { current, user } = session(request);
    if (request.headers['x-spinel-diagnostic-account'] !== user.id)
      throw new DiagnosticsError(403, 'Diagnostics account changed.');
    const state = diagnostics.status();
    if (!state.available) throw new DiagnosticsError(503, 'Diagnostics are unavailable.');
    response.json({ generation: state.generation, binding: collectionBinding(current.token_hash) });
  });
  router.post('/diagnostics/events', (request, response) => {
    const { current, user } = session(request);
    if (request.headers['x-spinel-diagnostic-account'] !== user.id)
      throw new DiagnosticsError(403, 'Diagnostics account changed.');
    const body: unknown = request.body;
    if (
      !isObject(body) ||
      !exactKeys(body, ['generation', 'binding', 'records']) ||
      !isUuid(body.generation) ||
      typeof body.binding !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.binding) ||
      !Array.isArray(body.records) ||
      body.records.length === 0 ||
      body.records.length > MAX_BATCH_EVENTS ||
      !body.records.every(isDiagnosticRecord)
    )
      throw new DiagnosticsError(400, 'Invalid diagnostics batch.');
    const records: DiagnosticRecord[] = body.records;
    if (
      !timingSafeEqual(
        Buffer.from(body.binding, 'hex'),
        Buffer.from(collectionBinding(current.token_hash), 'hex'),
      )
    )
      throw new DiagnosticsError(409, 'Diagnostics session changed. Discard the old batch.');
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BATCH_BYTES)
      throw new DiagnosticsError(413, 'Diagnostics batch is too large.');
    if (
      records.some(
        ({ event, context }) =>
          (![
            'operation.result',
            'operation.failed',
            'operation.duration',
            'operation.count',
          ].includes(event.name) &&
            !isClientDiagnosticEvent(event) &&
            !['sync.edit.resync', 'sync.edit.resync.log', 'sync.resync.pending'].includes(
              event.name,
            )) ||
          context.component === 'server' ||
          context.component === 'health',
      )
    )
      throw new DiagnosticsError(400, 'Invalid browser diagnostics.');
    if (!rate.take(user.id, records.length))
      throw new DiagnosticsError(429, 'Diagnostics collection is limited.');
    const state = diagnostics.status();
    if (!state.available) throw new DiagnosticsError(503, 'Diagnostics are unavailable.');
    if (body.generation !== state.generation)
      throw new DiagnosticsError(409, 'Diagnostics collection restarted. Discard the old batch.');
    // There is no await between these current-access checks and storage. Reject the
    // whole batch on denial; dropping file attribution would retain unauthorized data.
    for (const { context } of records) {
      if (context.fileId)
        resolveDocument(workspace, user.id, context.fileId, 'read', {
          sessionHash: current.token_hash,
          ...(context.spaceId ? { spaceId: context.spaceId, spaceItem: context.fileId } : {}),
        });
    }
    response.json(diagnostics.ingest(records, user.id, body.generation));
  });
  router.get('/admin/diagnostics', (request, response) => {
    session(request, true);
    response.json(diagnostics.status());
  });
  router.post('/admin/diagnostics/truncate', (request, response) => {
    session(request, true);
    const body: unknown = request.body;
    if (
      !isObject(body) ||
      !exactKeys(body, ['confirm', 'generation']) ||
      body.confirm !== true ||
      !isUuid(body.generation)
    )
      throw new DiagnosticsError(400, 'Confirm clearing diagnostics and feedback first.');
    if (body.generation !== diagnostics.status().generation)
      throw new DiagnosticsError(409, 'Diagnostics collection changed. Review and confirm again.');
    response.json(diagnostics.truncate());
  });
  router.post('/admin/diagnostics/download', async (request, response) => {
    const original = session(request, true);
    if (!isObject(request.body) || !exactKeys(request.body, []))
      throw new DiagnosticsError(400, 'Invalid download request.');
    const controller = new AbortController();
    const closed = () => controller.abort();
    response.once('close', closed);
    let snapshot;
    let timeout: NodeJS.Timeout | undefined;
    try {
      snapshot = await diagnostics.snapshot(controller.signal);
      const latest = session(request, true);
      if (
        latest.current.token_hash !== original.current.token_hash ||
        latest.user.id !== original.user.id ||
        controller.signal.aborted
      )
        throw new AuthError(401, 'Your session expired. Sign in again.');
      // A stalled client cannot keep truncate and the private snapshot occupied forever.
      timeout = setTimeout(() => {
        response.destroy();
        controller.abort();
      }, 30_000);
      timeout.unref();
      await new Promise<void>((resolve, reject) => {
        response.download(
          snapshot!.path,
          'spinel-diagnostics.sqlite',
          {
            // The authorized snapshot is inside our private .diagnostics-export-* directory.
            // Express otherwise rejects that directory before it can stream the SQLite file.
            dotfiles: 'allow',
            headers: {
              'Content-Type': 'application/vnd.sqlite3',
              'X-Content-Type-Options': 'nosniff',
            },
          },
          (error) => (error ? reject(error) : resolve()),
        );
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      response.removeListener('close', closed);
      await snapshot?.dispose();
    }
  });
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const known = error instanceof AuthError || error instanceof DiagnosticsError;
    const status = known
      ? error.status
      : error instanceof Error && 'type' in error && error.type === 'entity.too.large'
        ? 413
        : 400;
    response.status(status).json({ error: known ? error.message : 'Invalid diagnostics request.' });
  });
  return router;
}
