import { maintenanceRouter } from '../maintenance/router.ts';
import express from 'express';
import { createReadStream } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  exactKeys,
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
import { FEEDBACK_LIMITS, FEEDBACK_ROUTES } from '../../shared/feedback.ts';
import type { FeedbackContext } from '../../shared/feedback.ts';
import { transferFeedback } from './feedback-transfer.ts';

/** One minute buckets, bounded even when many authenticated users send events. */
export class DiagnosticRateLimit {
  private readonly actors = new Map<string, { start: number; count: number }>();
  private global = { start: 0, count: 0 };
  private readonly now: () => number;
  private readonly actorLimit: number;
  private readonly globalLimit: number;
  constructor(now = Date.now, actorLimit = 120, globalLimit = 600) {
    this.now = now;
    this.actorLimit = actorLimit;
    this.globalLimit = globalLimit;
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
      current.count + count > this.actorLimit ||
      this.global.count + count > this.globalLimit
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
  const feedbackRate = new DiagnosticRateLimit(
    Date.now,
    FEEDBACK_LIMITS.perMinute,
    FEEDBACK_LIMITS.globalPerMinute,
  );
  const bindingKey = randomBytes(32);
  const collectionBinding = (sessionHash: string) =>
    createHmac('sha256', bindingKey).update(sessionHash).digest('hex');
  // Feedback retries must survive a process restart after a durable write whose
  // acknowledgement was lost. The persisted session hash keys this generation-
  // bound proof; no raw session credential or server secret reaches the artifact.
  const feedbackBinding = (sessionHash: string, generation: string) =>
    createHmac('sha256', sessionHash)
      .update('spinel-feedback-v1:')
      .update(generation)
      .digest('hex');
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
          !event.name.startsWith('operation.') ||
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
  const feedbackSession = (request: Request) => {
    const result = session(request);
    if (result.user.is_admin) throw new AuthError(404, 'Not found.');
    if (request.headers['x-spinel-diagnostic-account'] !== result.user.id)
      throw new DiagnosticsError(
        403,
        'Your account changed. Reopen feedback from your current account.',
      );
    return result;
  };
  const exportOwner = (current: ReturnType<typeof session>) => ({
    actorId: current.user.id,
    sessionHash: current.current.token_hash,
  });
  router.get('/diagnostics/feedback-context', (request, response) => {
    const { current } = feedbackSession(request);
    const state = diagnostics.status();
    if (!state.available || !state.generation)
      throw new DiagnosticsError(503, 'Feedback is unavailable. Keep your draft and try again.');
    response.json({
      generation: state.generation,
      binding: feedbackBinding(current.token_hash, state.generation),
      maxMessageLength: FEEDBACK_LIMITS.messageLength,
      maxMessageBytes: FEEDBACK_LIMITS.messageBytes,
    });
  });
  router.post('/diagnostics/feedback', (request, response) => {
    const { current, user } = feedbackSession(request);
    const body: unknown = request.body;
    if (
      !isObject(body) ||
      !exactKeys(body, ['id', 'generation', 'binding', 'message', 'context']) ||
      !isUuid(body.id) ||
      !isUuid(body.generation) ||
      typeof body.binding !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.binding) ||
      typeof body.message !== 'string' ||
      !isObject(body.context) ||
      !exactKeys(body.context, ['route'], ['fileId', 'spaceId', 'runId']) ||
      !FEEDBACK_ROUTES.includes(body.context.route as FeedbackContext['route']) ||
      ['fileId', 'spaceId', 'runId'].some(
        (key) =>
          Object.hasOwn(body.context as object, key) &&
          !isUuid((body.context as Record<string, unknown>)[key]),
      ) ||
      (body.context.spaceId !== undefined && body.context.fileId === undefined)
    )
      throw new DiagnosticsError(400, 'Invalid feedback request.');
    if (
      !timingSafeEqual(
        Buffer.from(body.binding, 'hex'),
        Buffer.from(feedbackBinding(current.token_hash, body.generation), 'hex'),
      )
    )
      throw new DiagnosticsError(
        409,
        'Your session changed. Start a new report to send this draft.',
      );
    const context = body.context as unknown as FeedbackContext;
    if (context.fileId)
      resolveDocument(workspace, user.id, context.fileId, 'read', {
        sessionHash: current.token_hash,
        ...(context.spaceId ? { spaceId: context.spaceId, spaceItem: context.fileId } : {}),
      });
    // Authority checks and durable write are synchronous; no access change can
    // interleave between them. Feedback never uses the lossy batch endpoint.
    response.json(
      diagnostics.feedback(
        { id: body.id, message: body.message, context },
        user.id,
        body.generation,
        () => feedbackRate.take(user.id, 1),
      ),
    );
  });
  router.get('/admin/diagnostics/feedback', (request, response) => {
    session(request, true);
    response.json(diagnostics.feedbackFlags());
  });
  router.post('/admin/diagnostics/feedback/prepare', async (request, response) => {
    const original = session(request, true);
    if (
      !isObject(request.body) ||
      !exactKeys(request.body, ['actorId']) ||
      !isUuid(request.body.actorId)
    )
      throw new DiagnosticsError(400, 'Choose an account for feedback downloads.');
    // Disabled accounts remain in the Operator's people list, and their durable
    // feedback remains inspectable until explicit diagnostics truncation.
    const actor = workspace.auth.database
      .prepare('SELECT id,is_admin FROM auth_users WHERE id=?')
      .get(request.body.actorId);
    if (!actor || actor.is_admin) throw new AuthError(404, 'Not found.');
    const controller = new AbortController();
    let prepared: Awaited<ReturnType<DiagnosticsStore['prepareFeedback']>> | undefined;
    const close = () => {
      if (response.writableFinished) return;
      controller.abort();
      if (prepared?.state === 'ready')
        void diagnostics.cancelFeedback(prepared.id, exportOwner(original)).catch(() => {
          /* The cancelled lease remains unavailable until cleanup succeeds. */
        });
    };
    // Keep this through response completion, including the JSON response's
    // backpressure interval after the worker has finished.
    response.once('close', close);
    try {
      prepared = await diagnostics.prepareFeedback(
        String(actor.id),
        exportOwner(original),
        controller.signal,
      );
      const latest = session(request, true);
      if (
        latest.current.token_hash !== original.current.token_hash ||
        latest.user.id !== original.user.id ||
        controller.signal.aborted
      )
        throw new AuthError(401, 'Your session expired. Sign in again.');
      if (prepared.generation !== diagnostics.status().generation)
        throw new DiagnosticsError(410, 'Diagnostics changed. Prepare both downloads again.');
      response.json(prepared);
    } catch (error) {
      if (prepared?.state === 'ready')
        await diagnostics.cancelFeedback(prepared.id, exportOwner(original));
      throw error;
    }
  });
  router.post('/admin/diagnostics/feedback/:id/cancel', async (request, response) => {
    const original = session(request, true);
    if (!isUuid(request.params.id) || !isObject(request.body) || !exactKeys(request.body, []))
      throw new DiagnosticsError(400, 'Invalid feedback cancellation.');
    await diagnostics.cancelFeedback(request.params.id, exportOwner(original));
    response.sendStatus(204);
  });
  router.post('/admin/diagnostics/feedback/:id/download', async (request, response) => {
    const original = session(request, true);
    if (
      !isUuid(request.params.id) ||
      !isObject(request.body) ||
      !exactKeys(request.body, ['scope']) ||
      !['user', 'system'].includes(request.body.scope as string)
    )
      throw new DiagnosticsError(400, 'Choose user or system metrics.');
    const scope = request.body.scope as 'user' | 'system';
    const transfer = diagnostics.feedbackDownload(request.params.id, exportOwner(original), scope);
    let completed = false;
    const source = createReadStream(transfer.path, { highWaterMark: 64 * 1024 });
    try {
      response.set({
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="spinel-feedback-${scope}.sqlite"`,
        'X-Content-Type-Options': 'nosniff',
      });
      await transferFeedback(source, response, transfer.signal, () => {
        const current = session(request, true);
        if (
          current.current.token_hash !== original.current.token_hash ||
          current.user.id !== original.user.id
        )
          throw new AuthError(401, 'Your session expired. Sign in again.');
        if (
          transfer.signal.aborted ||
          !diagnostics.hasGeneration(transfer.generation) ||
          Date.now() >= transfer.expiresAt
        )
          throw new DiagnosticsError(410, 'Feedback downloads expired or were cleared.');
      });
      completed = true;
    } finally {
      source.destroy();
      await transfer.finish(!completed);
    }
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
