import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { maintenanceProxyRequest } from './proxy-request.ts';

function docker(args: string[], timeout = 30_000) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // This helper runs only synthetic, credential-free proxy commands. Preserve
  // bounded diagnostics rather than hiding the actual Docker startup failure.
  if (result.error || result.status !== 0) console.error(result.stderr?.slice(-8000) ?? '');
  assert.ok(!result.error && result.status === 0, `Proxy fixture docker ${args[0]} failed.`);
  return result.stdout;
}

/** Exercise the deployment's exact routing/error handlers using its pinned Caddy.
 * TLS and Tailscale stay target-host acceptance; this fixture needs no credentials.
 * The caller also owns this unique container name in its signal cleanup.
 */
export async function checkMaintenanceProxy(directory: string, name: string) {
  const compose = readFileSync('deploy/compose.yaml', 'utf8');
  const image = /\bimage: (caddy:[^\s]+@sha256:[a-f0-9]{64})/.exec(compose)?.[1];
  assert.ok(image, 'The deployment must pin its Caddy image by digest.');
  docker(['pull', image], 180_000);
  const adapted = JSON.parse(
    docker([
      'run',
      '--rm',
      '--network=none',
      '--env=SPINEL_HOSTNAME=spinel.proxy-smoke.test',
      '--env=SPINEL_TAILSCALE_IP=127.0.0.1',
      '--mount',
      `type=bind,source=${resolve('deploy/Caddyfile')},target=/etc/caddy/Caddyfile,readonly`,
      image,
      'caddy',
      'adapt',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ]),
  );
  const servers = Object.values(adapted.apps?.http?.servers ?? {}) as Array<{
    routes?: unknown[];
    errors?: { routes?: unknown[] };
  }>;
  assert.equal(servers.length, 1, 'The proxy smoke must cover the only deployment server.');
  const deployment = servers[0];
  assert.ok(deployment.routes?.length && deployment.errors?.routes?.length);
  const config = join(directory, 'proxy-smoke.json');
  writeFileSync(
    config,
    JSON.stringify({
      admin: { disabled: true },
      apps: {
        http: {
          servers: {
            smoke: {
              listen: [':8080'],
              automatic_https: { disable: true },
              routes: deployment.routes,
              errors: deployment.errors,
            },
          },
        },
      },
    }),
    { mode: 0o644 },
  );
  try {
    docker([
      'run',
      '--detach',
      '--name',
      name,
      '--read-only',
      '--user=10001:10001',
      '--cap-drop=ALL',
      // Match Compose: the pinned binary's file capability must remain in the
      // bounding set even though this HTTP-only fixture listens on port 8080.
      '--cap-add=NET_BIND_SERVICE',
      '--security-opt=no-new-privileges:true',
      '--memory=128m',
      '--cpus=0.25',
      '--pids-limit=64',
      '--network=bridge',
      '--publish=127.0.0.1::8080',
      '--tmpfs=/config:size=1m,uid=10001,gid=10001,mode=0700',
      '--tmpfs=/data:size=8m,uid=10001,gid=10001,mode=0700',
      '--mount',
      `type=bind,source=${config},target=/etc/caddy/proxy-smoke.json,readonly`,
      image,
      'caddy',
      'run',
      '--config',
      '/etc/caddy/proxy-smoke.json',
    ]);
    const binding = docker(['port', name, '8080/tcp']).trim();
    assert.match(binding, /^127\.0\.0\.1:\d+$/);
    const request = (path: string) => maintenanceProxyRequest(binding, path);
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await request('/sign-in');
        ready = response.status === 503;
        await response.body?.cancel();
        if (ready) break;
      } catch {
        // Caddy is still starting; the deadline bounds this disposable fixture.
      }
      await delay(200);
    }
    assert.ok(ready, 'The static proxy fallback did not become ready.');
    // Neither loopback upstream exists in this isolated container. These requests
    // prove the fallback survives loss of both the app and its supervisor.
    for (const path of ['/sign-in', '/api/maintenance', '/api/health', '/sync-api/test', '/mcp']) {
      const response = await request(path);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '30');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      if (path === '/sign-in') {
        assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/);
        const body = await response.text();
        assert.match(body, /<h1>Workspace maintenance<\/h1>/);
        assert.match(body, /Keep pending work on this device/);
        assert.ok(!body.includes('<script'));
      } else {
        assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
        assert.deepEqual(await response.json(), {
          code: 'MAINTENANCE',
          error: 'Workspace maintenance is in progress. Keep pending work on this device.',
        });
      }
    }
    const state = JSON.parse(docker(['inspect', '--format', '{{json .State}}', name]));
    assert.equal(state.Running, true);
    assert.equal(state.OOMKilled, false);
    console.log('Pinned Caddy serves private static 503 HTML/JSON with both upstreams absent.');
  } catch (error) {
    for (const args of [
      ['inspect', '--format', '{{json .State}}', name],
      ['logs', '--tail', '80', name],
    ]) {
      const diagnostic = spawnSync('docker', args, {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 32 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.error(`Proxy fixture ${args[0]}: ${diagnostic.stdout?.slice(-16000) ?? ''}`);
      if (diagnostic.stderr) console.error(diagnostic.stderr.slice(-16000));
    }
    throw error;
  } finally {
    docker(['rm', '--force', '--volumes', name]);
  }
}
