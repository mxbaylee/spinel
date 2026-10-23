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
import { documentIdentity, protocolSpaceScope } from '../src/server/collaboration/identity.ts';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiagnosticsStore } from '../src/server/diagnostics/store.ts';
import { diagnosticsRoutes } from '../src/server/diagnostics/routes.ts';
import { diagnosticsConfiguration } from '../src/server/diagnostics/configuration.ts';
import { HealthJobs } from '../src/server/health/jobs.ts';
import { HealthMonitor } from '../src/server/health/monitor.ts';
import { healthRoutes } from '../src/server/health/routes.ts';
import { BackupService } from '../src/server/backup/service.ts';
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
import { attachCollaboration } from '../src/server/collaboration/transport.ts';
import { UnitAction, ErrorCode } from '@univerjs/protocol';

export const projectRoot = resolve(import.meta.dirname, '..');

export interface AppOptions {
  databasePath: string;
  origin?: string;
  development?: boolean;
  staticDirectory?: string;
  backupConfigPath?: string;
  image?: string;
  /** Spaces are enabled by default; false explicitly closes every Space boundary. */
  spaceReview?: boolean;
}

export async function createApp(options: AppOptions) {
  const database = openDatabase(options.databasePath);
  const app = express();
  app.disable('x-powered-by');
  app.use(profileAvatarRoutes());
  const server = createServer(app);
  let vite: import('vite').ViteDevServer | undefined;
  let stopCleanup = () => {};
  let backups: BackupService | undefined;
  let collaboration: CollaborationStore | undefined;
  let history: HistoryStore | undefined;
  let realtime: ReturnType<typeof attachCollaboration> | undefined;
  let purgeTimer: ReturnType<typeof setInterval> | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let diagnostics: DiagnosticsStore | undefined;

  try {
    diagnostics = new DiagnosticsStore(diagnosticsConfiguration(options.databasePath, options.image));
    const jobs = new HealthJobs({ observe: ({ job, success, durationMs, runId }) => {
      if (job === 'space-trash-expiry') return;
      diagnostics!.emit({ name: 'job.result', details: {
        job: job === 'history-maintenance' ? 'history-prune' : job,
        outcome: success ? 'success' : 'failure', durationMs,
      } }, { component: 'health', runId });
    } });
    const auth = new AuthStore(database);
    app.use(
      '/api/auth',
      authRoutes(auth, options.origin ?? 'http://localhost:3000', async () => {
        await realtime?.revalidate();
      }),
    );
    const spaceReview = options.spaceReview !== false;
    const workspace = new WorkspaceStore(auth, { spacesEnabled: spaceReview });
    // Rebuild the pre-production item schema before the collaboration SDK opens
    // its second connection. Storage migration is independent of the runtime gate.
    migrateSpaceSchema(database);
    const origin = options.origin ?? 'http://localhost:3000';
    const oauth = new AssistantOAuth(auth, origin);
    app.use(assistantOAuthRoutes(oauth));
    collaboration = new CollaborationStore(workspace, options.databasePath, { spaceReview, observePurge: () => jobs.begin('collaboration-purge') });
    history = new HistoryStore(workspace, collaboration, () => jobs.begin('history-maintenance'));
    app.use('/mcp', mcpRoutes(workspace, collaboration, origin));
    realtime = attachCollaboration(server, workspace, collaboration, origin, { spaceReview });
    workspace.links.recover();
    app.use(guestRoutes(workspace, collaboration, origin, (id) => realtime!.privacyChanged(id)));
    app.use(
      '/api/guest-spaces/:spaceId/items/:itemId',
      spaceNativeRoutes(workspace, collaboration, origin, { spaceReview, guest: true }),
    );
    app.use('/api/guest-spaces', spaceRoutes(workspace, origin, { spaceReview, guest: true }));
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
    app.use('/api/items', workspaceRoutes(auth, origin, workspace, collaboration, history));
    app.use(
      '/api/spaces/:spaceId/items/:itemId',
      spaceNativeRoutes(workspace, collaboration, origin, { spaceReview, history }),
    );
    app.use('/api/spaces', spaceRoutes(workspace, origin, { spaceReview }));
    app.post(
      [
        '/universer-api/authz/-/object/-/batch_allowed',
        '/guest-api/:guestItem/universer-api/authz/-/object/-/batch_allowed',
        ...(spaceReview
          ? [
              '/space-api/:spaceId/items/:spaceItem/universer-api/authz/-/object/-/batch_allowed',
              '/guest-space-api/:spaceId/items/:spaceItem/universer-api/authz/-/object/-/batch_allowed',
            ]
          : []),
      ],
      express.json({ limit: '64kb' }),
      (request, response) => {
        response.set('Cache-Control', 'no-store');
        let identity: ReturnType<typeof documentIdentity>;
        let spaceScope: ReturnType<typeof protocolSpaceScope>;
        try {
          if (request.headers.origin !== origin) throw new Error('Origin');
          spaceScope = protocolSpaceScope(request.originalUrl, origin, spaceReview);
          identity = documentIdentity(
            workspace,
            request.headers,
            request.path.startsWith('/guest-space-api/')
              ? spaceScope?.spaceId
              : typeof request.params.guestItem === 'string'
                ? request.params.guestItem
                : undefined,
            spaceScope,
          );
        } catch {
          response.status(403).json({ error: 'This document is not available.' });
          return;
        }
        const requests: unknown = request.body?.requests;
        if (
          !Array.isArray(requests) ||
          requests.length > 200 ||
          requests.some(
            (item) =>
              !item ||
              typeof item !== 'object' ||
              typeof item.unitID !== 'string' ||
              typeof item.objectID !== 'string' ||
              !Array.isArray(item.actions),
          )
        ) {
          response.status(400).end();
          return;
        }
        const readActions: number[] = [
          UnitAction.View,
          UnitAction.Copy,
          UnitAction.Print,
          UnitAction.SelectProtectedCells,
          UnitAction.SelectUnProtectedCells,
        ];
        const hostActions: number[] = [
          UnitAction.ManageCollaborator,
          UnitAction.Share,
          UnitAction.Delete,
          UnitAction.RecoverHistory,
          UnitAction.CreatePermissionObject,
        ];
        // This namespace names one stable child and therefore one live native
        // unit. Resolve its role once within this synchronous response, never
        // across requests or awaited work. Repeated permission objects must not
        // multiply a deep Space ancestry walk.
        let spaceUnit: string | undefined;
        let spaceAccess: string | undefined;
        if (spaceScope) {
          spaceUnit = collaboration!.generations.active(spaceScope.spaceItem).unitId;
          if (requests.some((item) => item.unitID === spaceUnit)) {
            try {
              spaceAccess = collaboration!.access(
                identity.userId,
                spaceUnit,
                false,
                identity.customData,
              ).access;
            } catch {
              /* Do not reveal unavailable Space children. */
            }
          }
        }
        response.json({
          error: { code: ErrorCode.OK, message: '' },
          objectActions: requests.map((item) => {
            let access: string | undefined;
            if (spaceScope) {
              access = item.unitID === spaceUnit ? spaceAccess : undefined;
            } else {
              try {
                access = collaboration!.access(
                  identity.userId,
                  item.unitID,
                  false,
                  identity.customData,
                ).access;
              } catch {
                /* Do not reveal other documents. */
              }
            }
            return {
              unitID: item.unitID,
              objectID: item.objectID,
              actions: (Array.isArray(item.actions) ? item.actions : [])
                .slice(0, 100)
                .map((action: number) => ({
                  action,
                  allowed:
                    Boolean(access) &&
                    Number.isInteger(action) &&
                    action >= 0 &&
                    action <= 45 &&
                    !hostActions.includes(action) &&
                    (access !== 'viewer' || readActions.includes(action)),
                })),
            };
          }),
        });
      },
    );
    stopCleanup = startTrashCleanup(new TrashStore(workspace), () => jobs.begin('trash-expiry'));
    await collaboration.purgeDeleted();
    purgeTimer = setInterval(() => {
      void collaboration!
        .purgeDeleted()
        .catch((error) => console.error('Collaboration purge will retry.', error));
    }, 60_000);
    purgeTimer.unref();
    backups = new BackupService(database, {
      databasePath: options.databasePath,
      origin: options.origin ?? 'http://localhost:3000',
      configPath: options.backupConfigPath,
      image: options.image,
      observe: () => {
        const started = Date.now(), runId = randomUUID();
        return (success) => diagnostics!.emit({ name: 'job.result', details: { job: 'backup', outcome: success ? 'success' : 'failure', durationMs: Math.max(0, Date.now() - started) } }, { component: 'health', runId });
      },
    });
    const health = new HealthMonitor({
      applicationPath: options.databasePath, diagnosticsPath: diagnostics.path, jobs,
      editorConnections: () => realtime!.connectionCount(),
      logicalDatabaseBytes: () => Number(database.prepare('PRAGMA page_count').get()?.page_count) * Number(database.prepare('PRAGMA page_size').get()?.page_size),
    });
    app.use(healthRoutes(auth, health));
    const sampleHealth = async () => {
      const sample = await health.sample();
      for (const [scope, value] of [
        ['process', sample.memory.processRssBytes], ['host', sample.memory.systemUsedBytes], ['container', sample.memory.containerUsedBytes],
      ] as const) if (value !== null) diagnostics!.emit({ name: 'runtime.memory', metric: { kind: 'gauge', unit: 'bytes', value }, details: { scope } }, { component: 'health' });
      diagnostics!.emit({ name: 'runtime.connections', metric: { kind: 'gauge', unit: 'count', value: sample.editorConnections }, details: {} }, { component: 'health' });
      for (const store of ['application', 'diagnostics'] as const) {
        const size = sample[store];
        if (!size) continue;
        for (const [part, value] of [['database', size.databaseBytes], ['wal', size.walBytes]] as const)
          diagnostics!.emit({ name: 'storage.bytes', metric: { kind: 'gauge', unit: 'bytes', value }, details: { store, part } }, { component: 'health' });
      }
      if (sample.storage.freeBytes !== null) diagnostics!.emit({ name: 'storage.free', metric: { kind: 'gauge', unit: 'bytes', value: sample.storage.freeBytes }, details: {} }, { component: 'health' });
    };
    const collectHealth = () => { void sampleHealth().catch(() => {}); };
    collectHealth();
    healthTimer = setInterval(collectHealth, 60_000);
    healthTimer.unref();
    app.get('/api/admin/backups', (request, response) => {
      const session = auth.session(cookieToken(request));
      if (!session?.user_id || !auth.user(session.user_id)?.is_admin) {
        response.status(404).json({ error: 'Not found' });
        return;
      }
      response.json(backups!.status());
    });
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
    backups.start();
    history.start();
  } catch (error) {
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
    async close() {
      stopCleanup();
      clearInterval(purgeTimer);
      clearInterval(healthTimer);
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
      await collaboration?.purgeDeleted();
      await collaboration?.close();
      database.close();
      await diagnostics?.close();
    },
  };
}
