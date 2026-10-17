import express from 'express';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { openDatabase } from './database.ts';
import { AuthStore } from '../src/server/auth/store.ts';
import { authRoutes, cookieToken } from '../src/server/auth/routes.ts';

export const projectRoot = resolve(import.meta.dirname, '..');

export interface AppOptions {
  databasePath: string;
  origin?: string;
  development?: boolean;
  staticDirectory?: string;
}

export async function createApp(options: AppOptions) {
  const database = openDatabase(options.databasePath);
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  let vite: import('vite').ViteDevServer | undefined;

  try {
    const auth = new AuthStore(database);
    app.use('/api/auth', authRoutes(auth, options.origin ?? 'http://localhost:3000'));
    app.use('/api', (request, response, next) => {
      response.set('Cache-Control', 'no-store');
      if (!auth.session(cookieToken(request))?.user_id) {
        response.status(401).json({ error: 'Sign in to continue.', redirect: '/sign-in' });
        return;
      }
      next();
    });
    app.get('/api/health', (_request, response) => {
      database.prepare('SELECT 1').get();
      response.json({ status: 'ok' });
    });
    app.use('/api', (_request, response) => {
      response.status(404).json({ error: 'Not found' });
    });

    const pages = ['/sign-in', '/', '/settings', '/admin'];
    app.get(pages, (request, response, next) => {
      response.set('Cache-Control', 'no-store');
      const session = auth.session(cookieToken(request));
      const user = session?.user_id ? auth.user(session.user_id) : undefined;
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
            allow: [resolve(projectRoot, 'web'), resolve(projectRoot, 'node_modules')],
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
  } catch (error) {
    await vite?.close();
    database.close();
    throw error;
  }

  return {
    server,
    async close() {
      await vite?.close();
      if (server.listening) {
        await new Promise<void>((resolveClose, reject) => {
          server.close((error) => (error ? reject(error) : resolveClose()));
          server.closeAllConnections();
        });
      }
      database.close();
    },
  };
}
