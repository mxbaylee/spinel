import express from 'express';
import type { Request } from 'express';
import { finished } from 'node:stream/promises';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { admitTransfer, transfers } from '../workspace/transfers.ts';
import { PdfError } from './limits.ts';
import { PdfExports, pdfSelection } from './service.ts';

type Identity = { userId: string; customData: Record<string, unknown> };

/** Mount only behind the namespace's existing identity, origin and Space guards. */
export function pdfRoutes(
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  identity: (request: Request) => Identity,
  itemParam: 'id' | 'itemId' = 'id',
) {
  const router = express.Router({ mergeParams: true });
  const exports = new PdfExports(workspace, collaboration);
  router.use(express.json({ limit: '16kb', strict: true }));
  router.all('/', admitTransfer, async (request, response, next) => {
    const transfer = transfers.get(response)!;
    transfer.start();
    const controller = new AbortController();
    const stop = () => {
      if (!response.writableFinished) controller.abort();
    };
    request.once('aborted', stop);
    response.once('close', stop);
    try {
      response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      const initial = identity(request);
      const custom = Object.freeze({ ...initial.customData });
      const verify = () => {
        controller.signal.throwIfAborted();
        if (response.destroyed || identity(request).userId !== initial.userId)
          throw new AuthError(401, 'Open the document again to continue.');
      };
      const id = String(request.params[itemParam]);
      if (request.method === 'GET') {
        response.json(await exports.options(initial.userId, id, verify, custom));
      } else if (request.method === 'POST') {
        if (!request.is('application/json')) throw new AuthError(400, 'Send PDF options as JSON.');
        const file = await exports.export(
          initial.userId,
          id,
          pdfSelection(request.body),
          verify,
          custom,
          controller.signal,
        );
        // No await between these checks and publication: stale bytes never reach
        // response headers or the socket while generation is still pending.
        file.verify();
        const completion = finished(response, { cleanup: true });
        response.attachment(file.filename).type('application/pdf').send(file.bytes);
        await completion;
      } else
        response
          .status(405)
          .set('Allow', 'GET, POST')
          .json({ error: 'Use the PDF export action.' });
    } catch (error) {
      if (response.headersSent || response.destroyed) response.destroy();
      else if (error instanceof PdfError) {
        response
          .status(error.code === 'busy' ? 429 : error.code === 'limit' ? 413 : 422)
          .json({ error: error.message });
      } else next(error);
    } finally {
      request.off('aborted', stop);
      response.off('close', stop);
      transfer.finish();
    }
  });
  return router;
}
