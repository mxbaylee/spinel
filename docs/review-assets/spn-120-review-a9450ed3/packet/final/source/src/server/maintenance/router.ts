import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { trackMaintenanceWork } from './gate.ts';

/**
 * Use ordinary public Router registration methods, retaining asynchronous work
 * beyond response.close. Error handlers keep Express's four-argument signature.
 */
export function maintenanceRouter(options?: Parameters<typeof express.Router>[0]) {
  const router = express.Router(options);
  const wrap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(wrap);
    if (typeof value !== 'function') return value;
    if (value.length === 4)
      return (error: unknown, request: Request, response: Response, next: NextFunction) =>
        value(error, request, response, next);
    return (request: Request, response: Response, next: NextFunction) =>
      trackMaintenanceWork(() => value(request, response, next), response);
  };
  for (const name of ['use', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']) {
    const registration = router as unknown as Record<string, (...args: unknown[]) => unknown>;
    const original = registration[name].bind(router);
    registration[name] = (...args: unknown[]) => original(...args.map(wrap));
  }
  return router;
}
