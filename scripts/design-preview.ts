// Serves docs/ on localhost and opens the gem rail mockup, so the page can load
// its .tsx and the icon catalog in ../reference/icons/. Run `npm run design`.
// PORT picks the port (default 8765); a busy port falls back to a free one.
// SPN-027 deletes this with docs/design/.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'docs');
const PAGE = '/design/gem-rail-mockup.html';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  const file = normalize(join(ROOT, path === '/' ? PAGE : path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

function openBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  execFile(cmd, args, (error) => {
    if (error) console.log(`Open ${url} in your browser.`);
  });
}

// Registered once: a callback passed to listen() would also fire after a retry.
server.on('listening', () => {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PAGE}`;
  console.log(`Design preview at ${url} (Ctrl+C to stop)`);
  if (!process.argv.includes('--no-open')) openBrowser(url);
});

function listen(port: number): void {
  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && port !== 0) {
      console.log(`Port ${port} is busy; using a free one.`);
      listen(0);
    } else throw error;
  });
  server.listen(port, '127.0.0.1');
}

listen(Number(process.env.PORT ?? 8765));
