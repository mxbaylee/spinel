import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonObject = Record<string, unknown>;
export type Target = {
  browser: 'chrome' | 'firefox' | 'safari';
  device: string;
  osVersion: string;
};
type SessionResult = Target & {
  status: 'passed' | 'failed';
  tunnelReached: boolean;
  teardown: 'passed' | 'failed' | 'session-id-unavailable';
  sessionId?: string;
  returnedBrowserName: string | null;
  browserVersion?: string;
  userAgent?: string;
  failure?: string;
};

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid-response-shape');
  }
  return value as JsonObject;
}

// Only these locally constructed messages reach logs; remote bodies and errors never do.
function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(http-\d{3}|invalid-response-shape|request-failed|webdriver-error|unexpected-browser|tunnel-challenge-mismatch|missing-mobile-targets|missing-credentials|missing-local-identifier)$/.test(
    message,
  )
    ? message
    : 'probe-failed';
}

export function targetsFromInventory(value: unknown): Target[] {
  if (!Array.isArray(value)) throw new Error('invalid-response-shape');
  const phones = value.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const row = entry as JsonObject;
    return (
      (row.real_mobile === true || row.real_mobile === 'true') &&
      typeof row.device === 'string' &&
      /^[\w .()+-]{1,100}$/.test(row.device) &&
      typeof row.os_version === 'string' &&
      /^\d+(\.\d+)*$/.test(row.os_version)
    );
  }) as (JsonObject & { device: string; os_version: string })[];
  phones.sort(
    (a, b) =>
      b.os_version.localeCompare(a.os_version, 'en', { numeric: true }) ||
      b.device.localeCompare(a.device, 'en', { numeric: true }),
  );
  const android = phones.find(
    (row) => row.os === 'android' && /^(Google Pixel \d|Samsung Galaxy S\d)/.test(row.device),
  );
  const iphone = phones.find((row) => row.os === 'ios' && /^iPhone \d/.test(row.device));
  if (!android || !iphone) throw new Error('missing-mobile-targets');
  // Firefox Android is supported even though the inventory omits its browser row.
  return [
    { browser: 'chrome', device: android.device, osVersion: android.os_version },
    { browser: 'firefox', device: android.device, osVersion: android.os_version },
    { browser: 'safari', device: iphone.device, osVersion: iphone.os_version },
  ];
}

export function clientFor(username: string, accessKey: string, fetcher: typeof fetch = fetch) {
  if (!username || !accessKey) throw new Error('missing-credentials');
  const encoded = Buffer.from(`${username}:${accessKey}`).toString('base64');
  const redact = (value: string) => {
    let result = value;
    for (const secret of [encoded, accessKey, username])
      result = result.replaceAll(secret, '[redacted]');
    return result.slice(0, 500);
  };
  async function request(url: string, method = 'GET', body?: unknown, timeout = 30_000) {
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
        redirect: 'error',
      });
    } catch {
      throw new Error('request-failed');
    }
    if (!response.ok) throw new Error(`http-${response.status}`);
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Error('invalid-response-shape');
    }
  }
  return {
    redact,
    api: (path: string) => request(`https://api.browserstack.com/automate/${path}`),
    async command(path: string, method = 'GET', body?: unknown) {
      const response = object(
        await request(
          `https://hub.browserstack.com/wd/hub/${path}`,
          method,
          body,
          path === 'session' ? 120_000 : 30_000,
        ),
      );
      if (!Object.hasOwn(response, 'value')) throw new Error('invalid-response-shape');
      const value = response.value;
      if (value && typeof value === 'object' && 'error' in value)
        throw new Error('webdriver-error');
      return value;
    },
  };
}

export async function checkSession(
  client: ReturnType<typeof clientFor>,
  target: Target,
  challenge: string,
  localIdentifier: string,
  buildName: string,
): Promise<SessionResult> {
  const result: SessionResult = {
    ...target,
    status: 'failed',
    tunnelReached: false,
    teardown: 'session-id-unavailable',
    returnedBrowserName: null,
  };
  try {
    const session = object(
      await client.command('session', 'POST', {
        capabilities: {
          alwaysMatch: {
            browserName: target.browser,
            'bstack:options': {
              deviceName: target.device,
              osVersion: target.osVersion,
              realMobile: true,
              local: true,
              localIdentifier,
              projectName: 'Spinel',
              buildName,
              sessionName: `SPN-090 infrastructure smoke: ${target.browser}`,
              idleTimeout: 60,
            },
            timeouts: { pageLoad: 30_000, script: 30_000, implicit: 0 },
          },
        },
      }),
    );
    if (typeof session.sessionId !== 'string' || !/^[\w-]{1,100}$/.test(session.sessionId)) {
      throw new Error('invalid-response-shape');
    }
    result.sessionId = session.sessionId;
    const capabilities = object(session.capabilities);
    // Retain metadata even when it differs from the requested browser, then
    // identify the unmodified running browser below.
    if (typeof capabilities.browserName === 'string') {
      result.returnedBrowserName = client.redact(capabilities.browserName);
    }
    if (typeof capabilities.browserVersion === 'string') {
      result.browserVersion = client.redact(capabilities.browserVersion);
    }
    const path = `session/${result.sessionId}`;
    await client.command(`${path}/url`, 'POST', { url: 'http://bs-local.com:8173' });
    if ((await client.command(`${path}/title`)) !== challenge) {
      throw new Error('tunnel-challenge-mismatch');
    }
    result.tunnelReached = true;
    const userAgent = await client.command(`${path}/execute/sync`, 'POST', {
      script: 'return navigator.userAgent;',
      args: [],
    });
    const expected = {
      chrome: /Android.*Chrome\//,
      firefox: /Android.*Gecko\/.*Firefox\//,
      safari: /iPhone.*Version\/.*Safari\//,
    }[target.browser];
    if (
      typeof userAgent !== 'string' ||
      !expected.test(userAgent) ||
      (target.browser === 'chrome' && /SamsungBrowser\/|EdgA\/|OPR\//.test(userAgent)) ||
      (target.browser === 'firefox' && /Chrome\/|SamsungBrowser\/|EdgA\/|OPR\//.test(userAgent))
    )
      throw new Error('unexpected-browser');
    result.userAgent = client.redact(userAgent);
    result.status = 'passed';
  } catch (error) {
    result.failure = failure(error);
  } finally {
    if (result.sessionId) {
      try {
        await client.command(`session/${result.sessionId}`, 'DELETE');
        result.teardown = 'passed';
      } catch {
        result.teardown = 'failed';
        result.failure ??= 'session-teardown-failed';
        result.status = 'failed';
      }
    }
  }
  return result;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'credentials' && mode !== 'smoke') throw new Error('invalid-mode');
  const report: JsonObject = {
    scope: 'Automate credentials, real mobile browsers and synthetic HTTP runner reachability only',
    mode,
    date: new Date().toISOString(),
    sourceSha: process.env.SOURCE_SHA,
    testedSha: process.env.GITHUB_SHA,
    run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    authentication: 'not-verified',
    status: 'failed',
  };
  try {
    const client = clientFor(process.env.BS_USERNAME ?? '', process.env.BS_ACCESS_KEY ?? '');
    const plan = object(await client.api('plan.json'));
    report.authentication = 'passed';
    if (typeof plan.parallel_sessions_max_allowed === 'number') {
      report.parallelSessionsAllowed = plan.parallel_sessions_max_allowed;
    }
    const targets = targetsFromInventory(await client.api('browsers.json'));
    report.targets = targets;
    if (mode === 'smoke') {
      const localIdentifier = process.env.BROWSERSTACK_LOCAL_IDENTIFIER;
      if (!localIdentifier) throw new Error('missing-local-identifier');
      const challenge = `Spinel-${randomUUID()}`;
      const server = createServer((_request, response) => {
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(`<!doctype html><title>${challenge}</title><p>Spinel CI tunnel smoke</p>`);
      });
      await new Promise<void>((accept, reject) => {
        server.once('error', reject);
        server.listen(8173, '127.0.0.1', accept);
      });
      const sessions: SessionResult[] = [];
      report.sessions = sessions;
      try {
        const buildName = `SPN-090 ${process.env.GITHUB_RUN_ID ?? 'local'} ${process.env.SOURCE_SHA?.slice(0, 12) ?? ''}`;
        for (const target of targets) {
          sessions.push(await checkSession(client, target, challenge, localIdentifier, buildName));
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((accept) => server.close(() => accept()));
      }
      report.status = sessions.every((session) => session.status === 'passed')
        ? 'passed'
        : 'failed';
    } else {
      report.status = 'passed';
    }
  } catch (error) {
    report.failure = failure(error);
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(`artifacts/browserstack-${mode}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('BrowserStack probe failed; no credentials or raw remote responses were logged.');
    process.exitCode = 1;
  });
}
