import { browserstackOrigin } from './browserstack-fixture.ts';

const clientMilliseconds = 5_000;
const errorCodes = [
  'ERR_LOCAL_NETWORK_PERMISSION_MISSING',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CERT_DATE_INVALID',
  'ERR_CERT_AUTHORITY_INVALID',
] as const;
const internalDocuments = ['chrome-error', 'legacy-chrome-error'] as const;
type DocumentKind = 'expected-item' | 'other' | (typeof internalDocuments)[number];
type ErrorCode = (typeof errorCodes)[number];

export type ChromeReadinessDiagnostic = {
  operation: 'chrome-readiness-document-observation';
  status: 'observed' | 'not-attempted' | 'failed';
  commandAttempted: boolean;
  timeoutMilliseconds: number;
  document: DocumentKind | null;
  errorCode: ErrorCode | null;
  failure: 'invalid-input' | 'deadline' | 'command-failed' | 'invalid-response' | null;
};
type Executor = (script: string, args: unknown[], timeout: number) => Promise<unknown>;

// Diagnostic only, after the original readiness command fails. ChromeDriver's
// GET /url substitutes navigation history for these internal document URLs:
// https://github.com/chromium/chromium/blob/152.0.7977.54/chrome/test/chromedriver/window_commands.cc#L1060
// The fixed selector and public short codes come from the same reported version:
// https://github.com/chromium/chromium/blob/152.0.7977.54/components/neterror/resources/neterror.ts#L316
// https://github.com/chromium/chromium/blob/152.0.7977.54/net/base/net_error_list.h
// Return a primitive only; never return a URL, HTML, arbitrary text or exception.
export const chromeReadinessFailureScript = `
const url = document.URL;
if (typeof url !== 'string') return null;
if (url === arguments[0]) return 'expected-item';
const kind = url === 'chrome-error://chromewebdata/' ? 'chrome-error'
  : url === 'data:text/html,chromewebdata' ? 'legacy-chrome-error' : null;
if (kind === null) return 'other';
try {
  const code = document.querySelector('.error-code')?.textContent;
  return ${JSON.stringify(errorCodes)}.includes(code) ? kind + ':' + code : kind;
} catch {
  return kind;
}`;

function decode(value: unknown): { document: DocumentKind; errorCode: ErrorCode | null } | null {
  if (value === 'expected-item' || value === 'other') return { document: value, errorCode: null };
  if (typeof value !== 'string' || value.length > 128) return null;
  for (const document of internalDocuments) {
    if (value === document) return { document, errorCode: null };
    const prefix = `${document}:`;
    if (!value.startsWith(prefix)) continue;
    const code = value.slice(prefix.length);
    return (errorCodes as readonly string[]).includes(code)
      ? { document, errorCode: code as ErrorCode }
      : null;
  }
  return null;
}

/** One read-only observation, never a readiness retry or capability pass.
 * The caller preserves its original command/error and invokes this only after
 * failure. The timeout bounds client waiting; it does not prove remote command
 * cancellation. ChromeDriver still uses the existing session script timeout.
 * https://github.com/chromium/chromium/blob/152.0.7977.54/chrome/test/chromedriver/chrome/web_view_impl.cc#L1214
 */
export async function observeChromeReadinessFailure(
  execute: Executor,
  options: { expectedItemURL: string; deadline: number },
): Promise<ChromeReadinessDiagnostic> {
  const started = performance.now();
  const startedAt = Date.now();
  const result: ChromeReadinessDiagnostic = {
    operation: 'chrome-readiness-document-observation',
    status: 'not-attempted',
    commandAttempted: false,
    timeoutMilliseconds: 0,
    document: null,
    errorCode: null,
    failure: null,
  };
  const itemPrefix = `${browserstackOrigin}/?item=`;
  if (
    typeof options.expectedItemURL !== 'string' ||
    !options.expectedItemURL.startsWith(itemPrefix) ||
    !/^[\w-]{1,200}$/.test(options.expectedItemURL.slice(itemPrefix.length)) ||
    !Number.isFinite(options.deadline)
  ) {
    result.failure = 'invalid-input';
    return result;
  }
  const allowance = Math.min(clientMilliseconds, options.deadline - startedAt);
  const deadline = startedAt + allowance;
  const monotonicDeadline = started + allowance;
  const remaining = () =>
    Math.floor(Math.min(deadline - Date.now(), monotonicDeadline - performance.now()));
  const allotted = remaining();
  if (allotted <= 0) {
    result.failure = 'deadline';
    return result;
  }
  const expired = Symbol('deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = new Promise<typeof expired>((resolve) => {
      timer = setTimeout(() => resolve(expired), allotted);
    });
    const pending = Promise.resolve().then(() => {
      const timeout = remaining();
      if (timeout <= 0) return expired;
      result.commandAttempted = true;
      result.timeoutMilliseconds = timeout;
      return execute(chromeReadinessFailureScript, [options.expectedItemURL], timeout);
    });
    const value = await Promise.race([pending, limit]);
    if (value === expired || remaining() <= 0) {
      result.status = result.commandAttempted ? 'failed' : 'not-attempted';
      result.failure = 'deadline';
      return result;
    }
    const observed = decode(value);
    if (!observed) {
      result.status = 'failed';
      result.failure = 'invalid-response';
      return result;
    }
    result.status = 'observed';
    Object.assign(result, observed);
    return result;
  } catch {
    result.status = 'failed';
    result.failure = remaining() <= 0 ? 'deadline' : 'command-failed';
    return result;
  } finally {
    clearTimeout(timer);
  }
}
