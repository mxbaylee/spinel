import express from 'express';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { openDatabase } from './database.ts';

export const projectRoot = resolve(import.meta.dirname, '..');

export interface AppOptions {
  databasePath: string;
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
    app.get('/api/health', (_request, response) => {
      database.prepare('SELECT 1').get();
      response.json({ status: 'ok' });
    });
    app.use('/api', (_request, response) => {
      response.status(404).json({ error: 'Not found' });
    });

    if (options.development) {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({
        configFile: resolve(projectRoot, 'vite.config.ts'),
        // Node 24 can load this TypeScript config without watched temporary bundles.
        configLoader: 'native',
        server: { middlewareMode: true, hmr: { server } },
        appType: 'custom',
      });
      app.use(vite.middlewares);
      app.get('/', async (request, response) => {
        const template = await readFile(resolve(projectRoot, 'web/index.html'), 'utf8');
        const html = await vite!.transformIndexHtml(request.originalUrl, template);
        response.type('html').send(html);
      });
    } else {
      const directory = options.staticDirectory ?? resolve(projectRoot, 'dist');
      // Fail at startup with a useful error instead of serving a broken dashboard.
      await readFile(resolve(directory, 'index.html'));
      app.use(express.static(directory, { dotfiles: 'deny' }));
    }
    app.use((_request, response) => {
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
