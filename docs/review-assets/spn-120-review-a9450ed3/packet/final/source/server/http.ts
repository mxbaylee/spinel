import { createServer } from 'node:http';
import type { Express, Request } from 'express';

export const ARCHIVE_TRANSFER_TIMEOUT = 60 * 60_000;
const ORDINARY_BODY_TIMEOUT = 5 * 60_000;
const bodyDeadlines = new WeakMap<Request, () => void>();

/** Only an authenticated, admitted archive upload may use the longer body window. */
export function extendArchiveBodyDeadline(request: Request) {
  bodyDeadlines.get(request)?.();
}

export function createHttpServer(app: Express) {
  app.use((request, response, next) => {
    let active = true;
    const clear = () => {
      active = false;
      clearTimeout(timer);
      bodyDeadlines.delete(request);
      request.off('end', clear);
      request.off('close', clear);
      response.off('finish', responseEnded);
      response.off('close', responseEnded);
    };
    const responseEnded = () => {
      // A rejected request may still be sending its body after its response.
      // Keep its shorter deadline until reception finishes or the socket closes.
      if (request.complete || request.destroyed || request.socket.destroyed) clear();
    };
    const timer = setTimeout(() => {
      if (!active) return;
      clear();
      if (request.complete) return;
      if (response.headersSent || response.destroyed) request.destroy();
      else {
        response.once('finish', () => request.destroy());
        response
          .status(408)
          .set('Connection', 'close')
          .json({ error: 'The request timed out. Try again.' });
      }
    }, ORDINARY_BODY_TIMEOUT);
    timer.unref();
    bodyDeadlines.set(request, clear);
    request.once('end', clear);
    request.once('close', clear);
    response.once('finish', responseEnded);
    response.once('close', responseEnded);
    next();
  });
  // Node otherwise stops receiving every body after five minutes, before the
  // archive handler's bounded upload deadline. Ordinary bodies retain that
  // shorter window above; incomplete headers still time out after one minute.
  return createServer({ requestTimeout: ARCHIVE_TRANSFER_TIMEOUT, headersTimeout: 60_000 }, app);
}
