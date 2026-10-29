import { appearanceRoutes } from '../src/server/appearance/routes.ts';
import { assertSyncTransitionReady } from '../src/server/sync/transition.ts';
import { profileAvatarRoutes } from '../src/server/profileAvatar.ts';
import express from 'express';
import { socialPreviewRoutes } from '../src/server/socialPreview.ts';
import { escapeMarkup } from '../src/shared/markup.ts';
import { spaceReviewReturnPath, spaceReviewSignInPath } from '../src/shared/spaceReviewRoute.ts';
import type { Request } from 'express';
import { mcpRoutes } from '../src/server/mcp/routes.ts';
import { assistantOAuthRoutes } from '../src/server/auth/oauthRoutes.ts';
import { AssistantOAuth } from '../src/server/auth/oauth.ts';
import { pwaRoutes } from '../src/server/pwa.ts';
import { guestRoutes } from '../src/server/workspace/guestRoutes.ts';
import { readFile } from 'node:fs/promises';
import { createHttpServer } from './http.ts';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiagnosticsStore } from '../src/server/diagnostics/store.ts';
import { diagnosticsRoutes } from '../src/server/diagnostics/routes.ts';
import { diagnosticsConfiguration } from '../src/server/diagnostics/configuration.ts';
import { HealthJobs } from '../src/server/health/jobs.ts';
import { HealthMonitor } from '../src/server/health/monitor.ts';
import { healthRoutes } from '../src/server/health/routes.ts';
import { BackupService } from '../src/server/backup/service.ts';
import { backupRoutes } from '../src/server/backup/routes.ts';
import { openDatabase } from './database.ts';
import { AuthStore } from '../src/server/auth/store.ts';
import { authRoutes, cookieToken } from '../src/server/auth/routes.ts';
import { workspaceRoutes } from '../src/server/workspace/routes.ts';
import { spaceRoutes } from '../src/server/workspace/space-routes.ts';
import { spaceNativeRoutes } from '../src/server/workspace/space-native-routes.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { migrateSpaceSchema } from '../src/server/workspace/space-schema.ts';
import { TrashStore, startTrashCleanup } from '../src/server/workspace/trash.ts';
import { HistoryStore } from '../src/server/history/store.ts';
import { CollaborationStore } from '../src/server/collaboration/service.ts';
import { attachSync } from '../src/server/sync/transport.ts';
import type { MaintenanceBridge } from '../src/shared/maintenance.ts';
import { MaintenanceGate, ShutdownError } from '../src/server/maintenance/gate.ts';
import { maintenanceRoutes } from '../src/server/maintenance/routes.ts';

export const projectRoot = resolve(import.meta.dirname, '..');
/** Below the supervisor's 15 s stop budget, leaving time to close stores. */
const SHUTDOWN_DRAIN_MS = 10_000;

export interface AppOptions {
  databasePath: string;
  origin?: string;
  development?: boolean;
  staticDirectory?: string;
  backupConfigPath?: string;
  image?: string;
  /** Spaces are enabled by default; false explicitly closes every Space boundary. */
  spaceReview?: boolean;
  /** Only the deployment supervisor can provide live recovery control. */
  maintenance?: MaintenanceBridge;
}

export async function createApp(options: AppOptions) {
  const maintenance = new MaintenanceGate(options.maintenance);
  const database = openDatabase(options.databasePath);
  const app = express();
  app.disable('x-powered-by');
  const server = createHttpServer(app);
  app.use(profileAvatarRoutes());
  let vite: import('vite').ViteDevServer | undefined;
  let stopCleanup = () => {};
  let backups: BackupService | undefined;
  let collaboration: CollaborationStore | undefined;
  let history: HistoryStore | undefined;
  let realtime: ReturnType<typeof attachSync> | undefined;
  let purgeTimer: ReturnType<typeof setInterval> | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let diagnostics: DiagnosticsStore | undefined;
  let unsubscribeMaintenance = () => {};
  let draining: Promise<void> | undefined;

  try {
    diagnostics = new DiagnosticsStore(
      diagnosticsConfiguration(options.databasePath, options.image),
    );
    const jobs = new HealthJobs({
      observe: ({ job, success, durationMs, runId }) => {
        diagnostics!.emit(
          {
            name: 'job.result',
            details: {
              job: job === 'history-maintenance' ? 'history-prune' : job,
              outcome: success ? 'success' : 'failure',
              durationMs,
            },
          },
          { component: 'health', runId },
        );
      },
    });
    assertSyncTransitionReady(database);
    const auth = new AuthStore(database);
    app.get('/api/maintenance', (_request, response) => {
      response.set('Cache-Control', 'no-store').json(maintenance.status);
    });
    app.use(
      '/api/admin/maintenance',
      maintenanceRoutes(auth, options.maintenance, options.origin ?? 'http://localhost:3000'),
    );
    const admit = maintenance.middleware();
    app.use((request, response, next) => {
      // Session and exact guest metadata lookups are read-only. Keep current
      // Operator authority and guest expiry/revocation visible during a pause.
      // Other reads can prepare native data or update auth metadata and gate.
      // Express routing is case-insensitive, so these matches are too: `/API/…`
      // must not reach an `/api` route without admission.
      if (
        (request.method === 'GET' &&
          (/^\/api\/auth\/session$/i.test(request.path) ||
            /^\/api\/guest\/[a-f\d-]{36}\/?$/i.test(request.path))) ||
        !/^\/(?:api(?:\/|$)|sync-api(?:\/|$)|mcp(?:\/|$)|authorize(?:\/|$)|register(?:\/|$)|token(?:\/|$)|revoke(?:\/|$))/i.test(
          request.path,
        )
      ) {
        next();
        return;
      }
      admit(request, response, next);
    });
    app.use(
      '/api/auth',
      authRoutes(auth, options.origin ?? 'http://localhost:3000', async () => {
        await realtime?.revalidate();
      }),
    );
    const spaceReview = options.spaceReview !== false;
    const workspace = new WorkspaceStore(auth, { spacesEnabled: spaceReview });
    // Rebuild the pre-production item schema before native document services start.
    migrateSpaceSchema(database);
    const origin = options.origin ?? 'http://localhost:3000';
    const oauth = new AssistantOAuth(auth, origin);
    app.use(assistantOAuthRoutes(oauth));
    collaboration = new CollaborationStore(workspace, options.databasePath, {
      spaceReview,
      observePurge: () => jobs.begin('collaboration-purge'),
      diagnostics: (event, context, actorId) => {
        if (!actorId.startsWith('guest:')) diagnostics!.record(event, context, actorId);
      },
    });
    history = new HistoryStore(workspace, collaboration, () => jobs.begin('history-maintenance'));
    app.use('/mcp', mcpRoutes(workspace, collaboration, origin));
    realtime = attachSync(server, app, workspace, collaboration, origin, maintenance);
    // Retired protocol paths must not fall through to the application shell.
    // Stale tabs cannot re-enter a second collaboration backend after cutover.
    app.use(
      ['/universer-api', '/guest-api', '/space-api', '/guest-space-api'],
      (_request, response) => {
        response
          .set('Cache-Control', 'no-store')
          .status(404)
          .json({ error: 'Reload Spinel to continue.' });
      },
    );
    workspace.links.recover();
    app.use(guestRoutes(workspace, collaboration, origin, (id) => realtime!.privacyChanged(id)));
    app.use(
      '/api/guest-spaces/:spaceId/items/:itemId',
      spaceNativeRoutes(workspace, collaboration, origin, { spaceReview, guest: true }),
    );
    app.use('/api/guest-spaces', spaceRoutes(workspace, origin, { spaceReview, guest: true }));
    app.use('/api/appearance', appearanceRoutes(workspace, origin));
    app.use('/api', (request, response, next) => {
      response.set('Cache-Control', 'no-store');
      if (!auth.session(cookieToken(request))?.user_id) {
        response.status(401).json({ error: 'Sign in to continue.', redirect: '/sign-in' });
        return;
      }
      next();
    });

    app.use('/api', (_request, response, next) => {
      response.once('finish', () => {
        void realtime?.revalidate().catch(() => {});
      });
      next();
    });
    app.use('/api', diagnosticsRoutes(workspace, diagnostics, origin));
    app.use(
      '/api/items',
      workspaceRoutes(auth, origin, workspace, collaboration, history, (event, context, actorId) =>
        diagnostics!.record(event, context, actorId),
      ),
    );
    app.use(
      '/api/spaces/:spaceId/items/:itemId',
      spaceNativeRoutes(workspace, collaboration, origin, {
        spaceReview,
        history,
        diagnostics: (event, context, actorId) => diagnostics!.record(event, context, actorId),
      }),
    );
    app.use('/api/spaces', spaceRoutes(workspace, origin, { spaceReview }));
    stopCleanup = startTrashCleanup(
      new TrashStore(workspace),
      () => jobs.begin('trash-expiry'),
      () => jobs.begin('space-trash-expiry'),
      (work) => {
        maintenance.job(work);
      },
    );
    await (maintenance.job(() => collaboration!.purgeDeleted()) ?? Promise.resolve()).catch(() =>
      console.error('Collaboration purge failed; retained generations will retry.'),
    );
    purgeTimer = setInterval(() => {
      void (maintenance.job(() => collaboration!.purgeDeleted()) ?? Promise.resolve()).catch(() =>
        console.error('Collaboration purge failed; retained generations will retry.'),
      );
    }, 60_000);
    purgeTimer.unref();
    backups = new BackupService(database, {
      databasePath: options.databasePath,
      origin: options.origin ?? 'http://localhost:3000',
      configPath: options.backupConfigPath,
      image: options.image,
      observe: () => {
        const started = Date.now(),
          runId = randomUUID();
        return (success) =>
          diagnostics!.emit(
            {
              name: 'job.result',
              details: {
                job: 'backup',
                outcome: success ? 'success' : 'failure',
                durationMs: Math.max(0, Date.now() - started),
              },
            },
            { component: 'health', runId },
          );
      },
    });
    database.setMaintenanceGate(maintenance);
    diagnostics.setMaintenanceGate(maintenance);
    const health = new HealthMonitor({
      applicationPath: options.databasePath,
      diagnosticsPath: diagnostics.path,
      jobs,
      editorConnections: () => realtime!.connectionCount(),
      logicalDatabaseBytes: () =>
        Number(database.prepare('PRAGMA page_count').get()?.page_count) *
        Number(database.prepare('PRAGMA page_size').get()?.page_size),
    });
    app.use(healthRoutes(auth, health));
    const sampleHealth = async () => {
      const sample = await health.sample();
      for (const [scope, value] of [
        ['process', sample.memory.processRssBytes],
        ['host', sample.memory.systemUsedBytes],
        ['container', sample.memory.containerUsedBytes],
      ] as const)
        if (value !== null)
          diagnostics!.emit(
            {
              name: 'runtime.memory',
              metric: { kind: 'gauge', unit: 'bytes', value },
              details: { scope },
            },
            { component: 'health' },
          );
      diagnostics!.emit(
        {
          name: 'runtime.connections',
          metric: { kind: 'gauge', unit: 'count', value: sample.editorConnections },
          details: {},
        },
        { component: 'health' },
      );
      for (const store of ['application', 'diagnostics'] as const) {
        const size = sample[store];
        if (!size) continue;
        for (const [part, value] of [
          ['database', size.databaseBytes],
          ['wal', size.walBytes],
        ] as const)
          diagnostics!.emit(
            {
              name: 'storage.bytes',
              metric: { kind: 'gauge', unit: 'bytes', value },
              details: { store, part },
            },
            { component: 'health' },
          );
      }
      if (sample.storage.freeBytes !== null)
        diagnostics!.emit(
          {
            name: 'storage.free',
            metric: { kind: 'gauge', unit: 'bytes', value: sample.storage.freeBytes },
            details: {},
          },
          { component: 'health' },
        );
    };
    const collectHealth = () => {
      void (maintenance.job(sampleHealth) ?? Promise.resolve()).catch(() => {});
    };
    collectHealth();
    healthTimer = setInterval(collectHealth, 60_000);
    healthTimer.unref();
    app.use('/api/admin/backups', backupRoutes(auth, backups, origin));
    app.get('/api/health', (_request, response) => {
      database.prepare('SELECT 1').get();
      response.json({ status: 'ok' });
    });
    app.use('/api', (_request, response) => {
      response.status(404).json({ error: 'Not found' });
    });

    app.use(pwaRoutes());
    app.use(socialPreviewRoutes(workspace.links));
    // Only configured origin and authorized preview metadata, never request hosts.
    const pageMetadata = (html: string, request: Request) => {
      const preview = request.path.startsWith('/share/')
        ? workspace.links.preview(request.params.id, request.query.preview)
        : undefined;
      const title = preview ? `${preview.name} — Spinel` : 'Spinel';
      const image = preview
        ? `/share/${encodeURIComponent(String(request.params.id))}/preview.png?preview=${encodeURIComponent(String(request.query.preview))}`
        : '/social-preview.png';
      const values: Record<string, string> = {
        TITLE: title,
        IMAGE: new URL(image, origin).href,
        DESCRIPTION: preview
          ? `A ${preview.kind === 'space' ? 'Space' : preview.kind === 'sheet' ? 'spreadsheet' : 'document'} shared with you on Spinel.`
          : 'Your private workspace for documents and spreadsheets.',
        IMAGE_ALT: preview
          ? `${preview.kind === 'space' ? 'Space' : preview.kind === 'sheet' ? 'Spreadsheet' : 'Document'}: ${preview.name}. Shared on Spinel.`
          : "Spinel's faceted pink heart. A little space for your big ideas. Documents and spreadsheets, together.",
      };
      return html.replace(
        /__SPINEL_(TITLE|IMAGE|DESCRIPTION|IMAGE_ALT)__/g,
        (_placeholder, key: string) => escapeMarkup(values[key]),
      );
    };

    const pages = [
      '/sign-in',
      '/connect',
      '/setup',
      '/recover-admin',
      '/invite',
      '/',
      '/settings',
      '/profile',
      '/admin',
      '/preview',
      '/share/:id',
      ...(spaceReview
        ? ['/spaces', '/spaces/:spaceId', '/review/spaces', '/review/spaces/:spaceId']
        : []),
    ];
    app.get(pages, (request, response, next) => {
      response.set('Cache-Control', 'no-store');
      if (request.path === '/connect' || request.path === '/sign-in') {
        response.set('Content-Security-Policy', "frame-ancestors 'none'");
        response.set('X-Frame-Options', 'DENY');
      }
      if (
        request.path === '/connect' ||
        (request.path === '/sign-in' && request.query.connect !== undefined)
      ) {
        response.set('Referrer-Policy', 'no-referrer');
        next();
        return;
      }
      if (
        request.path === '/invite' ||
        request.path === '/recover-admin' ||
        request.path.startsWith('/share/')
      ) {
        response.set('Referrer-Policy', 'no-referrer');
        next();
        return;
      }
      if (request.path === '/setup') {
        response.set('Referrer-Policy', 'no-referrer');
        if (auth.userCount()) {
          response
            .status(409)
            .type('text')
            .send('This instance is already claimed. Setup is closed.');
          return;
        }
        next();
        return;
      }
      if (request.path === '/settings') {
        response.redirect(302, '/profile' + request.originalUrl.slice('/settings'.length));
        return;
      }
      const session = auth.session(cookieToken(request));
      const user = session?.user_id ? auth.user(session.user_id) : undefined;
      if (/^\/(?:review\/)?spaces(?:\/|$)/.test(request.path) && user?.is_admin) {
        response.status(404).type('text').send('Not found');
        return;
      }
      if (/^\/admin\/?$/i.test(request.path) && !user?.is_admin) {
        response.status(404).type('text').send('Not found');
        return;
      }
      if (!user && request.path !== '/sign-in') {
        response.redirect(
          (spaceReview && spaceReviewSignInPath(new URL(request.originalUrl, origin))) ||
            '/sign-in',
        );
        return;
      }
      if (
        user &&
        (request.path === '/sign-in' ||
          (user.is_admin && request.path === '/') ||
          (!user.is_admin && request.path === '/admin'))
      ) {
        response.redirect(
          user.is_admin
            ? '/admin'
            : (spaceReview && spaceReviewReturnPath(new URL(request.originalUrl, origin))) || '/',
        );
        return;
      }
      next();
    });
    if (options.development) {
      // Vite's native compiler otherwise sizes its pools from the host CPU
      // count. Bound its default parallelism beside the live collaboration
      // runtime and return freed native arenas promptly so a cold editor load
      // leaves room for the PDF child. Apply before loading the native compiler.
      process.env.ROLLDOWN_WORKER_THREADS ??= '2';
      process.env.RAYON_NUM_THREADS ??= '2';
      process.env.MIMALLOC_PURGE_DELAY ??= '0';
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({
        configFile: resolve(projectRoot, 'vite.config.ts'),
        // Node 24 can load this TypeScript config without watched temporary bundles.
        configLoader: 'native',
        server: {
          middlewareMode: true,
          hmr: { server },
          // Vite otherwise discovers the repository root and exposes private SQLite
          // files through /@fs/. Only browser source and dependencies are public.
          fs: {
            strict: true,
            allow: [
              resolve(projectRoot, 'web'),
              resolve(projectRoot, 'src/shared'),
              resolve(projectRoot, 'src/ui'),
              resolve(projectRoot, 'node_modules'),
            ],
            deny: [
              '.env',
              '.env.*',
              '*.{crt,pem}',
              '**/.git/**',
              '**/*.sqlite',
              '**/*.sqlite-*',
              resolve(options.databasePath),
              `${resolve(options.databasePath)}-*`,
            ],
          },
        },
        appType: 'custom',
      });
      // Pages go before Vite, which treats extensionless URLs as modules and would
      // serve web/setup.ts as source for /setup.
      app.get(pages, async (request, response) => {
        const template = await readFile(resolve(projectRoot, 'web/index.html'), 'utf8');
        const html = await vite!.transformIndexHtml(request.originalUrl, template);
        response.type('html').send(pageMetadata(html, request));
      });
      app.use(vite.middlewares);
    } else {
      const directory = options.staticDirectory ?? resolve(projectRoot, 'dist');
      // Fail at startup with a useful error instead of serving a broken dashboard.
      const html = await readFile(resolve(directory, 'index.html'), 'utf8');
      app.get(pages, (request, response) => {
        response.type('html').send(pageMetadata(html, request));
      });
      app.get('/service-worker.js', (_request, response) => {
        response.set('Cache-Control', 'no-store').sendFile(resolve(directory, 'service-worker.js'));
      });
      app.use(
        '/assets',
        express.static(resolve(directory, 'assets'), { dotfiles: 'deny', index: false }),
      );
    }
    app.use((request, response) => {
      if (!auth.session(cookieToken(request))?.user_id) {
        response.redirect('/sign-in');
        return;
      }
      response.status(404).type('text').send('Not found');
    });
    await backups.start();
    history.start();
    unsubscribeMaintenance =
      options.maintenance?.subscribe((status) => {
        realtime?.maintenance(status);
        if (status.phase !== 'draining' || draining) return;
        draining = (async () => {
          try {
            // Downloads, imports and backup preparation can run for minutes.
            // Cancel them so the bounded drain covers ordinary writes only.
            maintenance.cancelLongWork();
            await maintenance.drain();
            database.assertQuiescent();
            await diagnostics?.drainMaintenance();
            if (
              maintenance.status.phase === 'draining' &&
              maintenance.status.epoch === status.epoch
            )
              options.maintenance!.drained(status.epoch);
          } catch {
            options.maintenance!.fail('drain-failed');
          }
        })().finally(() => {
          draining = undefined;
        });
      }) ?? (() => {});
  } catch (error) {
    unsubscribeMaintenance();
    stopCleanup();
    clearInterval(purgeTimer);
    clearInterval(healthTimer);
    await realtime?.close();
    await history?.close();
    await collaboration?.close();
    await backups?.close();
    await vite?.close();
    database.close();
    await diagnostics?.close();
    throw error;
  }

  return {
    server,
    maintenance,
    async close() {
      unsubscribeMaintenance();
      stopCleanup();
      clearInterval(purgeTimer);
      clearInterval(healthTimer);
      // No new admission after shutdown begins. Existing leases still own their
      // writes while the bounded drain runs; stopping sockets is not a drain.
      maintenance.stopAdmission();
      // A restart is not maintenance; stopped jobs must not say it was.
      maintenance.cancelLongWork(new ShutdownError());
      // Shutdown must finish inside the supervisor's SIGTERM→SIGKILL budget
      // (STOP_MS, 15 s), so it drains for less than a maintenance pause does.
      await maintenance.drain(SHUTDOWN_DRAIN_MS);
      database.assertQuiescent();
      await diagnostics?.drainMaintenance();
      await realtime?.close();
      await vite?.close();
      if (server.listening) {
        await new Promise<void>((resolveClose, reject) => {
          server.close((error) => (error ? reject(error) : resolveClose()));
          server.closeAllConnections();
        });
      }
      await backups?.close();
      await history?.close();
      await (
        maintenance.status.available
          ? Promise.resolve()
          : (collaboration?.purgeDeleted() ?? Promise.resolve())
      ).catch(() =>
        console.error(
          'Collaboration purge incomplete; retained generations will retry after startup.',
        ),
      );
      await collaboration?.close();
      maintenance.stop();
      database.close();
      await diagnostics?.close();
    },
  };
}
