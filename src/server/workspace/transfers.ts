import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../auth/store.ts';

// One process-wide admission for all ordinary and scoped import/export/offline
// routes. A disconnected client cannot release an in-flight decode/materializer.
let active = false;
export const transfers = new WeakMap<Response, { start: () => void; finish: () => void }>();
export function admitTransfer(_request: Request, response: Response, next: NextFunction) {
  if (active) throw new AuthError(429, 'Another file transfer is running. Try again shortly.');
  active = true;
  let running = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    active = false;
    transfers.delete(response);
  };
  transfers.set(response, {
    start: () => {
      running = true;
    },
    finish: () => {
      running = false;
      if (response.writableFinished || response.destroyed) release();
    },
  });
  response.once('close', () => {
    if (!running) release();
  });
  response.once('finish', () => {
    if (!running) release();
  });
  next();
}
