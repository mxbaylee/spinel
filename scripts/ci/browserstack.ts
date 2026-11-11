type JsonObject = Record<string, unknown>;
export type Target = {
  browser: 'chrome' | 'firefox' | 'safari';
  device: string;
  osVersion: string;
};
export type RequestBounds = { timeout?: number; signal?: AbortSignal };

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid-response-shape');
  }
  return value as JsonObject;
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
/**
 * The provider's own words for a failed session creation, redacted and bounded.
 * Without them a `webdriver-error` carries no cause the operator can act on.
 */
export function providerDetail(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'providerDetail' in error
    ? typeof error.providerDetail === 'string'
      ? error.providerDetail
      : undefined
    : undefined;
}
export function webdriverErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'webdriverErrorCode' in error
    ? allowedWebdriverCode(error.webdriverErrorCode)
    : undefined;
}
function providerError(message: string, code?: string, detail?: string): Error {
  return Object.assign(new Error(message), {
    ...(code ? { webdriverErrorCode: code } : {}),
    ...(detail ? { providerDetail: detail } : {}),
  });
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
      if (value && typeof value === 'object' && 'error' in value) {
        // Only session creation: its refusal reasons (device unavailable, plan limit)
        // are the one provider text worth keeping, and no session exists to inspect.
        const detail =
          path === 'session'
            ? redact(
                cleanProviderText(
                  [
                    ...new Set(
                      [value.error, 'message' in value ? value.message : ''].filter(
                        (part): part is string => typeof part === 'string' && part !== '',
                      ),
                    ),
                  ].join(': '),
                ),
              )
            : undefined;
        throw providerError('webdriver-error', allowedWebdriverCode(value.error), detail);
      }
      return value;
    },
  };
}
