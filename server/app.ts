import express from 'express';
import { pwaRoutes } from '../src/server/pwa.ts';
import { guestRoutes } from '../src/server/workspace/guestRoutes.ts';
import { documentIdentity } from '../src/server/collaboration/identity.ts';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { BackupService } from '../src/server/backup/service.ts';
import { openDatabase } from './database.ts';
import { AuthStore } from '../src/server/auth/store.ts';
import { authRoutes, cookieToken } from '../src/server/auth/routes.ts';
import { workspaceRoutes } from '../src/server/workspace/routes.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
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
}

export async function createApp(options: AppOptions) {
  const database = openDatabase(options.databasePath);
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  let vite: import('vite').ViteDevServer | undefined;
  let stopCleanup = () => {};
  let backups: BackupService | undefined;
  let collaboration: CollaborationStore | undefined;
  let history: HistoryStore | undefined;
  let realtime: ReturnType<typeof attachCollaboration> | undefined;
  let purgeTimer: ReturnType<typeof setInterval> | undefined;

  try {
    const auth = new AuthStore(database);
    app.use(
      '/api/auth',
      authRoutes(auth, options.origin ?? 'http://localhost:3000', async () => {
        await realtime?.revalidate();
      }),
    );
    const workspace = new WorkspaceStore(auth);
    const origin = options.origin ?? 'http://localhost:3000';
    collaboration = new CollaborationStore(workspace, options.databasePath);
    history = new HistoryStore(workspace, collaboration);
    realtime = attachCollaboration(server, workspace, collaboration, origin);
    workspace.links.recover();
    app.use(guestRoutes(workspace, collaboration, origin, (id) => realtime!.privacyChanged(id)));
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
    app.use('/api/items', workspaceRoutes(auth, origin, workspace, collaboration, history));
    app.post(
      [
        '/universer-api/authz/-/object/-/batch_allowed',
        '/guest-api/:guestItem/universer-api/authz/-/object/-/batch_allowed',
      ],
      express.json({ limit: '64kb' }),
      (request, response) => {
        response.set('Cache-Control', 'no-store');
        let identity: ReturnType<typeof documentIdentity>;
        try {
          if (request.headers.origin !== origin) throw new Error('Origin');
          identity = documentIdentity(
            workspace,
            request.headers,
            typeof request.params.guestItem === 'string' ? request.params.guestItem : undefined,
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
        response.json({
          error: { code: ErrorCode.OK, message: '' },
          objectActions: requests.map((item) => {
            let access: string | undefined;
            try {
              access = collaboration!.access(identity.userId, item.unitID).access;
            } catch {
              /* Do not reveal other documents. */
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
    stopCleanup = startTrashCleanup(new TrashStore(workspace));
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
    });
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

    const pages = [
      '/sign-in',
      '/setup',
      '/invite',
      '/',
      '/settings',
      '/admin',
      '/preview',
      '/share/:id',
    ];
    app.get(pages, (request, response, next) => {
      response.set('Cache-Control', 'no-store');
      if (request.path === '/invite' || request.path.startsWith('/share/')) {
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
      const session = auth.session(cookieToken(request));
      const user = session?.user_id ? auth.user(session.user_id) : undefined;
      if (/^\/admin\/?$/i.test(request.path) && !user?.is_admin) {
        response.status(404).type('text').send('Not found');
        return;
      }
      if (!user && request.path !== '/sign-in') {
        response.redirect('/sign-in');
        return;
      }
      if (
        user &&
        (request.path === '/sign-in' ||
          (user.is_admin && request.path === '/') ||
          (!user.is_admin && request.path === '/admin'))
      ) {
        response.redirect(user.is_admin ? '/admin' : '/');
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
      app.use(vite.middlewares);
      app.get(pages, async (request, response) => {
        const template = await readFile(resolve(projectRoot, 'web/index.html'), 'utf8');
        const html = await vite!.transformIndexHtml(request.originalUrl, template);
        response.type('html').send(html);
      });
    } else {
      const directory = options.staticDirectory ?? resolve(projectRoot, 'dist');
      // Fail at startup with a useful error instead of serving a broken dashboard.
      await readFile(resolve(directory, 'index.html'));
      app.get(pages, (_request, response) => {
        response.sendFile(resolve(directory, 'index.html'));
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
    await realtime?.close();
    await history?.close();
    await collaboration?.close();
    await backups?.close();
    await vite?.close();
    database.close();
    throw error;
  }

  return {
    server,
    async close() {
      stopCleanup();
      clearInterval(purgeTimer);
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
    },
  };
}
