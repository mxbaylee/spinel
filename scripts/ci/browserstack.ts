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
export type RequestBounds = { timeout?: number; signal?: AbortSignal };
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
  return /^(http-\d{3}|invalid-response-shape|request-failed|webdriver-error|unexpected-browser|tunnel-challenge-mismatch|missing-mobile-targets|missing-credentials|missing-local-identifier|legacy-smoke-closed)$/.test(
    message,
  )
    ? message
    : 'probe-failed';
}

export function cleanProviderText(value: unknown): string {
  return String(value ?? '')
    .replace(/\/_desktop-login\/[^\s"'<>?#]+/g, '/_desktop-login/[redacted]')
    .replace(
      /([?&](?:token|key|code|secret|session|credential)[^=\s]*=)[^&\s"'<>]*/gi,
      '$1[redacted]',
    )
    .slice(0, 500);
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

// W3C protocol codes only; remote messages, stack traces and data never escape.
// https://www.w3.org/TR/webdriver/#errors
const webdriverErrors = new Set([
  'element click intercepted',
  'element not interactable',
  'insecure certificate',
  'invalid argument',
  'invalid cookie domain',
  'invalid element state',
  'invalid selector',
  'invalid session id',
  'javascript error',
  'move target out of bounds',
  'no such alert',
  'no such cookie',
  'no such element',
  'no such frame',
  'no such window',
  'no such shadow root',
  'script timeout',
  'session not created',
  'stale element reference',
  'detached shadow root',
  'timeout',
  'unable to set cookie',
  'unable to capture screen',
  'unexpected alert open',
  'unknown command',
  'unknown error',
  'unknown method',
  'unsupported operation',
]);
function allowedWebdriverCode(value: unknown): string | undefined {
  return typeof value === 'string' && webdriverErrors.has(value) ? value : undefined;
}
export function webdriverErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'webdriverErrorCode' in error
    ? allowedWebdriverCode(error.webdriverErrorCode)
    : undefined;
}
function providerError(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { webdriverErrorCode: code } : {});
}
async function responseWebdriverCode(response: Response): Promise<string | undefined> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = performance.now() + 250;
  try {
    reader = response.body?.getReader();
    if (!reader) return undefined;
    const diagnosticReader = reader;
    const read = (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        // A stream of immediately resolved empty chunks can starve timers.
        // Check the monotonic bound inside the loop as well as racing a timer.
        if (performance.now() >= deadline) return undefined;
        const chunk = await diagnosticReader.read();
        if (performance.now() >= deadline) return undefined;
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 8192) return undefined;
        if (chunk.value.byteLength) chunks.push(chunk.value);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      if (!payload || typeof payload !== 'object' || !('value' in payload)) return undefined;
      const value = payload.value;
      return value && typeof value === 'object' && 'error' in value
        ? allowedWebdriverCode(value.error)
        : undefined;
    })().catch(() => undefined);
    return await Promise.race([
      read,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), Math.max(1, deadline - performance.now()));
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    try {
      void reader?.cancel().catch(() => {});
    } catch {
      // Diagnostic acquisition, reads and cancellation never replace the HTTP failure.
    }
  }
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
  async function request(
    url: string,
    method = 'GET',
    body?: unknown,
    timeout = 30_000,
    signal?: AbortSignal,
  ) {
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
        redirect: 'error',
      });
    } catch {
      throw new Error('request-failed');
    }
    if (!response.ok)
      throw providerError(
        `http-${response.status}`,
        url.startsWith('https://hub.browserstack.com/wd/hub/')
          ? await responseWebdriverCode(response)
          : undefined,
      );
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Error('invalid-response-shape');
    }
  }
  return {
    redact,
    api: (path: string, method = 'GET', body?: unknown, bounds: RequestBounds = {}) =>
      request(
        `https://api.browserstack.com/automate/${path}`,
        method,
        body,
        bounds.timeout ?? 30_000,
        bounds.signal,
      ),
    async command(path: string, method = 'GET', body?: unknown, bounds: RequestBounds = {}) {
      const response = object(
        await request(
          `https://hub.browserstack.com/wd/hub/${path}`,
          method,
          body,
          bounds.timeout ?? (path === 'session' ? 120_000 : 30_000),
          bounds.signal,
        ),
      );
      if (!Object.hasOwn(response, 'value')) throw new Error('invalid-response-shape');
      const value = response.value;
      if (value && typeof value === 'object' && 'error' in value)
        throw providerError('webdriver-error', allowedWebdriverCode(value.error));
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
    // This legacy smoke path stays closed: it has no replay guard, idle-account
    // pre-flight or workflow lock. Real-phone runs go through the capability CLI.
    if (mode === 'smoke') refuseLegacySmoke();
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

function refuseLegacySmoke(): void {
  throw new Error('legacy-smoke-closed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('BrowserStack probe failed; no credentials or raw remote responses were logged.');
    process.exitCode = 1;
  });
}
