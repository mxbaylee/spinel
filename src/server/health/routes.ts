import express from 'express';
import type { AuthStore } from '../auth/store.ts';
import { cookieToken } from '../auth/routes.ts';
import type { HealthMonitor } from './monitor.ts';

/** Public liveness reveals one bit; every measurement requires a current Operator. */
export function healthRoutes(auth: AuthStore, monitor: HealthMonitor) {
  const router = express.Router();
  router.get('/healthz', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      auth.database.prepare('SELECT 1').get();
      response.json({ status: 'up' });
    } catch {
      response.status(503).json({ status: 'down' });
    }
  });
  router.get('/api/admin/health', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const session = auth.session(cookieToken(request));
    if (!session?.user_id || !auth.user(session.user_id)?.is_admin) {
      response.status(404).json({ error: 'Not found' });
      return;
    }
    try {
      const result = await monitor.sample();
      // Filesystem reads yield. A revoked Operator session must not receive the result.
      if (
        auth.session(cookieToken(request))?.user_id !== session.user_id ||
        !auth.user(session.user_id)?.is_admin
      ) {
        response.status(404).json({ error: 'Not found' });
        return;
      }
      response.json(result);
    } catch {
      response.status(503).json({ error: 'Server health is temporarily unavailable.' });
    }
  });
  return router;
}
