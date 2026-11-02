import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { webdriverErrorCode } from './browserstack.ts';

// These are completed-session GETs, not WebDriver commands or allocation routes.
// Response formats: https://www.browserstack.com/docs/automate/api-reference/selenium/session
export const diagnosticLimits = Object.freeze({
  requests: 2,
  requestMilliseconds: 8000,
  overallMilliseconds: 30000,
  responseBytes: 1024 * 1024,
  retainedFailures: 16,
});
type Endpoint = 'appiumlogs' | 'logs';
type Row = Record<string, unknown>;
type Cause =
  | 'renderer-crashed'
  | 'execution-context-unavailable'
  | 'target-detached'
  | 'devtools-disconnected'
  | 'navigation-network-error'
  | 'certificate-error'
  | 'driver-version-mismatch'
  | 'javascript-exception'
  | 'driver-function-exception'
  | 'driver-result-deserialization-failed'
  | 'unclassified';
type FailureRecord = {
  command: string | null;
  httpStatus: number | null;
  webdriverError: string | null;
  cause: Cause;
  source: 'proxy-response' | 'session-response' | 'terminal-error' | 'unclassified';
  errorClass: 'UnknownError' | 'JavaScriptError' | null;
};
type Analysis = {
  format: Endpoint | 'unrecognized';
  recognizedRequests: number;
  failures: FailureRecord[];
  omittedFailures: number;
  ambiguousTransactions: number;
  unfinishedTransactions: number;
  malformedRecords: number;
  terminalRecords: number;
  rejectedTerminalRecords: number;
  browserVersions: string[];
  chromeDriverVersions: string[];
  pageLoadStrategies: string[];
};
type Retrieval = {
  endpoint: Endpoint;
  status: 'pending' | 'available' | 'failed';
  httpStatus: number | null;
  bytes: number;
  sha256: string | null;
  elapsedMilliseconds: number | null;
  failure: string | null;
  analysis: Analysis | null;
  structure: ReturnType<typeof logStructure> | null;
};
export type SessionDiagnostics = {
  schemaVersion: 1;
  operation: 'read-completed-session-logs';
  execution: {
    sourceSha: string | null;
    testedSha: string | null;
    runId: string | null;
    attempt: string | null;
  };
  target: { sessionId: string | null };
  startedAt: string;
  finishedAt: string | null;
  status: 'available' | 'failed';
  stage: 'configuration' | 'before-request' | 'retrieving' | 'finished';
  failure: string | null;
  diagnosis: 'classified' | 'partially-classified' | 'unclassified';
  capabilityAcceptance: 'not-assessed';
  providerSessionsAllocated: 0;
  retrievals: Retrieval[];
};
type Options = {
  sessionId?: string;
  sourceSha?: string;
  testedSha?: string;
  runId?: string;
  attempt?: string;
  username?: string;
  accessKey?: string;
  fetcher?: typeof fetch;
  journal?: (report: SessionDiagnostics) => Promise<void>;
};
const sha = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
const positiveInteger = (value: unknown) =>
  typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : null;
const object = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
const timestampPrefix =
  /^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}:\d{2}(?:[.:]\d{1,6})?(?:Z)?\s+(?:-\s+)?/;
const loggerPrefix = /^(?:\[[^\]\r\n]{1,100}\]\s*){1,4}/;
const terminalPrefix = 'Encountered internal error running command: ';
const executeCommand = 'POST session/{sessionId}/execute/sync';

function logStructure(text: string, contentType: string | null, bom: boolean) {
  const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase();
  const mime = !mediaType
    ? 'missing'
    : mediaType === 'text/plain'
      ? 'plain-text'
      : mediaType === 'application/json'
        ? 'json'
        : mediaType === 'text/html'
          ? 'html'
          : 'other';
  const framing = (value: string) => {
    const counts = {
      timestamped: 0,
      request: 0,
      response: 0,
      startSession: 0,
      appiumHttp: 0,
      terminalError: 0,
    };
    const lines = value.split(/\r\n|\r|\n/);
    for (const raw of lines) {
      if (timestampPrefix.test(raw)) counts.timestamped++;
      const line = raw.replace(timestampPrefix, '');
      if (/^REQUEST (?:\[[^\]\r\n]{1,50}\]\s+)?(?:GET|POST|DELETE) /.test(line)) counts.request++;
      if (line.startsWith('RESPONSE ')) counts.response++;
      if (line === 'START_SESSION') counts.startSession++;
      const prefix = loggerPrefix.exec(line)?.[0];
      if (prefix) {
        const body = line.slice(prefix.length);
        if (/\[HTTP\]\s*$/.test(prefix) && /^(?:-->|<--) (?:GET|POST|DELETE) /.test(body))
          counts.appiumHttp++;
        if (body.startsWith(terminalPrefix)) counts.terminalError++;
      }
    }
    const withoutPairs = value.replace(/\r\n/g, '');
    const crlf = value.includes('\r\n'),
      lf = withoutPairs.includes('\n'),
      cr = withoutPairs.includes('\r');
    const newlineStyle =
      Number(crlf) + Number(lf) + Number(cr) > 1
        ? 'mixed'
        : crlf
          ? 'crlf'
          : lf
            ? 'lf'
            : cr
              ? 'cr'
              : 'none';
    return { lineCount: lines.length, newlineStyle, counts };
  };
  let bodyShape:
    'line-text' | 'json-string' | 'json-object' | 'json-array' | 'json-primitive' | 'html' =
    'line-text';
  let decodedString: ReturnType<typeof framing> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    bodyShape =
      typeof parsed === 'string'
        ? 'json-string'
        : Array.isArray(parsed)
          ? 'json-array'
          : object(parsed)
            ? 'json-object'
            : 'json-primitive';
    if (typeof parsed === 'string') decodedString = framing(parsed);
  } catch {
    if (/^\s*(?:<!doctype html(?:\s|>)|<html(?:\s|>))/i.test(text)) bodyShape = 'html';
  }
  return { mime, bodyShape, bom, ...framing(text), decodedString };
}

function normalizedCommand(method: string, path: string): string | null {
  if (!['GET', 'POST', 'DELETE'].includes(method)) return null;
  if (/^(?:\/wd\/hub)?\/session$/.test(path)) return `${method} session`;
  const match = /^(?:\/wd\/hub)?\/session\/[a-zA-Z0-9-]{1,100}(?:\/(.*))?$/.exec(path);
  const suffix = match ? (match[1] ?? '') : path.replace(/^\//, '');
  if (!match && !path.startsWith('/')) return null;
  const normalized =
    suffix === 'execute'
      ? 'execute/sync'
      : suffix === 'execute_async'
        ? 'execute/async'
        : /^element\/[a-zA-Z0-9_.:-]{1,200}\/click$/.test(suffix)
          ? 'element/{elementId}/click'
          : suffix;
  if (
    ![
      '',
      'url',
      'execute/sync',
      'execute/async',
      'window',
      'window/handles',
      'context',
      'contexts',
      'source',
      'title',
      'screenshot',
      'timeouts',
      'elements',
      'actions',
      'element/{elementId}/click',
      'appium/device/current_package',
      'appium/device/press_keycode',
      'appium/device/terminate_app',
      'appium/device/app_state',
    ].includes(normalized)
  )
    return null;
  return `${method} session/{sessionId}${normalized ? '/' + normalized : ''}`;
}

function decodeObject(text: string): Row | null {
  try {
    let value: unknown = JSON.parse(text);
    // The provider's documented proxy log sometimes JSON-encodes the JSON response.
    if (typeof value === 'string') value = JSON.parse(value);
    return object(value);
  } catch {
    return null;
  }
}

function classifyCause(code: string | null, message: unknown): Cause {
  if (code === 'javascript error') return 'javascript-exception';
  if (code === 'insecure certificate') return 'certificate-error';
  if (
    typeof message !== 'string' ||
    message.length > 8192 ||
    !['unknown error', 'no such window', 'no such frame', 'session not created'].includes(
      code ?? '',
    )
  )
    return 'unclassified';
  let first = message
    .split(/\r?\n/, 1)[0]
    .replace(/^(?:unknown error|session not created|no such window|no such frame):\s*/i, '');
  // Chromium WebViewImpl::CallFunctionWithTimeoutInternal, blob
  // 2b1cfe8355d9e79294ade85bb1332eb38f5aa765:
  // https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/test/chromedriver/chrome/web_view_impl.cc
  // These identify the driver boundary, not an application or hosted-version
  // diagnosis. Discard the exception description; static result errors must
  // match completely, with no arbitrary trailing provider text.
  if (code === 'unknown error') {
    if (/^Runtime\.callFunctionOn threw exception: .+$/.test(first))
      return 'driver-function-exception';
    if (
      [
        'result.deepSerializedValue.value list is missing or empty in Runtime.callFunctionOn response',
        'first element in result.deepSerializedValue.value list must be a dictionary',
        'first element in result.deepSerializedValue.value list must contain a string',
        'cannot deserialize the result value received from Runtime.callFunctionOn',
        'deserialized Runtime.callFunctionOn result is not a dictionary',
        "call function result missing int 'status'",
      ].includes(first)
    )
      return 'driver-result-deserialization-failed';
  }
  // ChromeDriver can wrap a protocol error. Only its complete structured first
  // line is inspected; arbitrary script text and stack lines are never searched.
  if (first.startsWith('unhandled inspector error: ')) {
    const inspector = decodeObject(first.slice('unhandled inspector error: '.length));
    if (typeof inspector?.code !== 'number' || typeof inspector.message !== 'string')
      return 'unclassified';
    first = inspector.message;
  }
  if (/^(?:tab crashed|session deleted because of page crash)(?:$|[ .:(])/i.test(first))
    return 'renderer-crashed';
  if (
    /^(?:no such execution context|cannot find context with specified id|cannot find default execution context|execution context was destroyed)(?:$|[ .:(])/i.test(
      first,
    )
  )
    return 'execution-context-unavailable';
  if (
    /^(?:target frame detached|target window already closed|target detached)(?:$|[ .:(])/i.test(
      first,
    )
  )
    return 'target-detached';
  if (
    /^(?:disconnected: (?:not connected to DevTools|unable to connect to renderer)|chrome not reachable)(?:$|[ .:(])/i.test(
      first,
    )
  )
    return 'devtools-disconnected';
  if (
    /^net::ERR_CERT_(?:AUTHORITY_INVALID|DATE_INVALID|COMMON_NAME_INVALID)(?:$|[ .:(])/.test(first)
  )
    return 'certificate-error';
  if (
    /^net::ERR_(?:ABORTED|CONNECTION_RESET|CONNECTION_REFUSED|CONNECTION_CLOSED|CONNECTION_TIMED_OUT|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)(?:$|[ .:(])/.test(
      first,
    )
  )
    return 'navigation-network-error';
  if (/^This version of ChromeDriver only supports Chrome version \d+(?:$|[ .:(])/i.test(first))
    return 'driver-version-mismatch';
  return 'unclassified';
}

function errorRecord(
  payload: Row | null,
  command: string | null,
  httpStatus: number | null,
  source: FailureRecord['source'] = 'unclassified',
): FailureRecord {
  if (payload?.status === 0 || payload?.state === 'success')
    return {
      command,
      httpStatus,
      webdriverError: null,
      cause: 'unclassified',
      source: 'unclassified',
      errorClass: null,
    };
  const value = object(payload?.value);
  const code =
    webdriverErrorCode({ webdriverErrorCode: value?.error }) ??
    webdriverErrorCode({ webdriverErrorCode: payload?.state }) ??
    null;
  return {
    command,
    httpStatus,
    webdriverError: code,
    cause: command ? classifyCause(code, value?.message) : 'unclassified',
    source: code ? source : 'unclassified',
    errorClass: null,
  };
}

function terminalError(firstLine: string): FailureRecord | null {
  if (firstLine.length > 8192 || /[\r\n]/.test(firstLine)) return null;
  // Current producer: appium/appium packages/base-driver/lib/protocol/protocol.ts,
  // blob 166641e9597a6e87ff3d77f08d7101fd014c23a8. Only this terminal first line
  // supplies evidence, never arbitrary stack lines or request/response bodies.
  const named = /^(UnknownError|JavaScriptError): (.*)$/.exec(firstLine);
  const errorClass = named ? (named[1] as 'UnknownError' | 'JavaScriptError') : null;
  let message = named ? named[2] : firstLine;
  // Exact legacy UnknownError wrapper, from appium/appium-base-driver
  // lib/protocol/errors.js blob fdc2a16d9d915f1a5b91b36406cc8a281c335cb5.
  const legacy =
    'An unknown server-side error occurred while processing the command. Original error: ';
  const code =
    errorClass === 'JavaScriptError'
      ? 'javascript error'
      : errorClass === 'UnknownError' ||
          message.startsWith(legacy) ||
          message.startsWith('unknown error: ')
        ? 'unknown error'
        : null;
  if (!code) return null;
  if (code === 'unknown error' && message.startsWith(legacy))
    message = message.slice(legacy.length);
  return {
    command: executeCommand,
    httpStatus: 500,
    webdriverError: code,
    cause: classifyCause(code, message),
    source: 'terminal-error',
    errorClass,
  };
}
function versions(payload: Row | null, command: string | null, result: Analysis) {
  if (command !== 'POST session' && command !== 'GET session/{sessionId}') return;
  const value = object(payload?.value);
  const caps = object(value?.capabilities) ?? value;
  const add = (list: string[], value: unknown, trailing = false) => {
    if (typeof value !== 'string') return;
    const match = (trailing ? /^(\d+(?:\.\d+){0,3})(?:$|[ (])/ : /^(\d+(?:\.\d+){0,3})$/).exec(
      value,
    );
    if (match && match[1].length <= 40 && list.length < 4 && !list.includes(match[1]))
      list.push(match[1]);
  };
  add(result.browserVersions, caps?.browserVersion ?? caps?.version);
  add(result.chromeDriverVersions, object(caps?.chrome)?.chromedriverVersion, true);
  const strategy = caps?.pageLoadStrategy;
  if (
    typeof strategy === 'string' &&
    ['normal', 'eager', 'none'].includes(strategy) &&
    !result.pageLoadStrategies.includes(strategy)
  )
    result.pageLoadStrategies.push(strategy);
}

/** Only framed request/failed-response pairs supply evidence; echoed bodies do not. */
export function analyzeSessionLog(text: string, endpoint: Endpoint): Analysis {
  const result: Analysis = {
    format: 'unrecognized',
    recognizedRequests: 0,
    failures: [],
    omittedFailures: 0,
    ambiguousTransactions: 0,
    unfinishedTransactions: 0,
    malformedRecords: 0,
    terminalRecords: 0,
    rejectedTerminalRecords: 0,
    browserVersions: [],
    chromeDriverVersions: [],
    pageLoadStrategies: [],
  };
  type Pending = {
    method: string;
    path: string;
    command: string | null;
    proxy: { command: string | null; logger: string } | null;
    proxyTransactions: number;
    proxyAmbiguous: boolean;
    error: FailureRecord | null;
    driverLogger: string | null;
    driverCalls: number;
    terminal: FailureRecord | null;
    terminalCount: number;
    terminalAmbiguous: boolean;
  };
  let pending: Pending | null = null,
    overlap = 0;
  const retain = (error: FailureRecord) => {
    if (result.failures.length < diagnosticLimits.retainedFailures) result.failures.push(error);
    else result.omittedFailures++;
  };
  for (const raw of text.split(/\r?\n/)) {
    // Dates and logger tags frame the records. Never search the line's body for
    // strings resembling errors or commands, including echoed execute scripts.
    const line = raw.replace(timestampPrefix, '');
    if (endpoint === 'logs') {
      // The documented session-text lifecycle ends the creation request with
      // this exact event before GET /session supplies the capabilities response.
      if (line === 'START_SESSION' && pending?.command === 'POST session' && !overlap) {
        pending = null;
        continue;
      }
      const request = /^REQUEST (?:\[[^\]\r\n]{1,50}\]\s+)?(GET|POST|DELETE) (\S+)(?:\s|$)/.exec(
        line,
      );
      if (request) {
        if (pending || overlap) {
          overlap += pending ? 2 : 1;
          pending = null;
          result.ambiguousTransactions++;
        } else
          pending = {
            method: request[1],
            path: request[2],
            command: normalizedCommand(request[1], request[2]),
            proxy: null,
            proxyTransactions: 0,
            proxyAmbiguous: false,
            error: null,
            driverLogger: null,
            driverCalls: 0,
            terminal: null,
            terminalCount: 0,
            terminalAmbiguous: false,
          };
        result.recognizedRequests++;
        result.format = endpoint;
        continue;
      }
      const response = /^RESPONSE (.+)$/.exec(line);
      if (response && overlap) {
        overlap--;
        continue;
      }
      if (!response) continue;
      if (!pending) {
        result.ambiguousTransactions++;
        continue;
      }
      const payload = decodeObject(response[1]);
      if (!payload) result.malformedRecords++;
      // A successful execute can itself return {error,message}. The transport's
      // explicit failed status/state must establish this is a protocol failure.
      const failed =
        payload?.state !== 'success' &&
        payload?.status !== 0 &&
        ((typeof payload?.status === 'number' &&
          Number.isInteger(payload.status) &&
          payload.status > 0 &&
          payload.status <= 34) ||
          (typeof payload?.state === 'string' &&
            webdriverErrorCode({ webdriverErrorCode: payload.state }) !== undefined));
      if (failed) retain(errorRecord(payload, pending.command, null, 'session-response'));
      else if (payload?.status === 0 || payload?.state === 'success')
        versions(payload, pending.command, result);
      else if (payload) result.malformedRecords++;
      pending = null;
      continue;
    }
    const prefix = loggerPrefix.exec(line)?.[0];
    if (!prefix) continue;
    const tags = [...prefix.matchAll(/\[([^\]]+)\]/g)].map((entry) => entry[1]);
    const tag = tags.at(-1)!;
    const body = line.slice(prefix.length);
    if (tag === 'HTTP') {
      const request = /^--> (GET|POST|DELETE) (\S+)(?:\s|$)/.exec(body);
      if (request) {
        if (pending || overlap) {
          overlap += pending ? 2 : 1;
          pending = null;
          result.ambiguousTransactions++;
        } else
          pending = {
            method: request[1],
            path: request[2],
            command: normalizedCommand(request[1], request[2]),
            proxy: null,
            proxyTransactions: 0,
            proxyAmbiguous: false,
            error: null,
            driverLogger: null,
            driverCalls: 0,
            terminal: null,
            terminalCount: 0,
            terminalAmbiguous: false,
          };
        result.recognizedRequests++;
        result.format = endpoint;
        continue;
      }
      const response = /^<-- (GET|POST|DELETE) (\S+) (\d{3})(?:\s|$)/.exec(body);
      if (!response) continue;
      if (overlap) {
        overlap--;
        continue;
      }
      if (!pending || pending.method !== response[1] || pending.path !== response[2]) {
        result.ambiguousTransactions++;
        pending = null;
        continue;
      }
      if (Number(response[3]) >= 400) {
        const ambiguous = pending.proxyAmbiguous || pending.terminalAmbiguous;
        if (ambiguous) result.ambiguousTransactions++;
        const terminal = Number(response[3]) === 500 ? pending.terminal : null;
        if (pending.terminal && !terminal) result.rejectedTerminalRecords++;
        retain(
          (!ambiguous && (terminal ?? pending.error)) ||
            errorRecord(null, pending.command, Number(response[3])),
        );
      } else if (pending.terminal) result.rejectedTerminalRecords++;
      pending = null;
      continue;
    }
    const currentDriver = /^AndroidUiautomator2Driver(?:@[a-f0-9]+)?$/.test(tag);
    if (
      pending?.command === executeCommand &&
      currentDriver &&
      /^Calling (?:AppiumDriver|AndroidUiautomator2Driver)\.execute\(\) with args: /.test(body)
    ) {
      pending.driverCalls++;
      pending.driverLogger = tag;
      if (pending.driverCalls > 1 || pending.terminalCount) pending.terminalAmbiguous = true;
      continue;
    }
    const legacyLogger = /^W3C(?: \([a-zA-Z0-9-]{1,8}\))?$/.test(tag);
    if ((legacyLogger || currentDriver) && body.startsWith(terminalPrefix)) {
      result.terminalRecords++;
      const internalId = pending
        ? /^(?:\/wd\/hub)?\/session\/([a-zA-Z0-9-]{1,100})(?:\/|$)/.exec(pending.path)?.[1]
        : null;
      // Legacy session logger binds to sessionId.substring(0, 8), as defined in
      // appium/appium-base-driver lib/protocol/sessions-cache.js.
      const associated = legacyLogger
        ? Boolean(internalId && tag === `W3C (${internalId.slice(0, 8)})`)
        : pending?.driverLogger === tag && pending.driverCalls === 1;
      if (pending) pending.terminalCount++;
      const candidate = terminalError(body.slice(terminalPrefix.length));
      if (
        !pending ||
        pending.command !== executeCommand ||
        !associated ||
        pending.terminalCount !== 1 ||
        pending.proxy ||
        pending.proxyAmbiguous ||
        !candidate
      ) {
        result.rejectedTerminalRecords++;
        if (pending && (pending.terminalCount > 1 || !associated || pending.proxy))
          pending.terminalAmbiguous = true;
        continue;
      }
      if (
        pending.error &&
        (pending.error.webdriverError !== candidate.webdriverError ||
          (pending.error.cause !== 'unclassified' &&
            candidate.cause !== 'unclassified' &&
            pending.error.cause !== candidate.cause))
      )
        pending.terminalAmbiguous = true;
      pending.terminal = candidate;
      continue;
    }
    if (
      !pending ||
      !/^(?:(?:WD|JSONWP) Proxy|Chromedriver(?:@[a-f0-9]+)?|AndroidUiautomator2Driver(?:@[a-f0-9]+)?)$/.test(
        tag,
      )
    )
      continue;
    const proxy = /^Proxying \[(GET|POST|DELETE) ([^\] ]+)\] to \[/.exec(body);
    if (proxy) {
      if (pending.terminalCount) {
        pending.terminal = null;
        pending.terminalAmbiguous = true;
      }
      pending.error = null;
      pending.proxyTransactions++;
      if (pending.proxyTransactions > 1) pending.proxyAmbiguous = true;
      pending.proxy = { command: normalizedCommand(proxy[1], proxy[2]), logger: tag };
      continue;
    }
    const response = /^Got response with status (\d{3}): (.+)$/.exec(body);
    if (!response) continue;
    const selectedProxy = pending.proxy;
    pending.proxy = null;
    if (!selectedProxy || selectedProxy.logger !== tag) {
      pending.error = null;
      pending.proxyAmbiguous = true;
      continue;
    }
    if (selectedProxy.command !== pending.command || !pending.command) continue;
    const payload = decodeObject(response[2]);
    if (!payload) {
      result.malformedRecords++;
      continue;
    }
    if (Number(response[1]) >= 400 && !pending.proxyAmbiguous && pending.proxyTransactions === 1)
      pending.error = errorRecord(payload, pending.command, Number(response[1]), 'proxy-response');
    else if (Number(response[1]) === 200) versions(payload, pending.command, result);
  }
  result.unfinishedTransactions = overlap || Number(pending !== null);
  return result;
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(?:request-timeout|overall-timeout|request-failed|redirect-blocked|unexpected-response-url|response-too-large|response-empty|response-invalid-encoding|response-stream-failed|journal-failed|http-\d{3})$/.test(
    message,
  )
    ? message
    : 'request-failed';
}

async function retrieve(options: Options, endpoint: Endpoint, deadline: number, entry: Retrieval) {
  const started = performance.now();
  const allotted = Math.min(diagnosticLimits.requestMilliseconds, deadline - started);
  if (allotted <= 0) throw new Error('overall-timeout');
  const requestDeadline = started + allotted;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (performance.now() >= deadline) throw new Error('overall-timeout');
    if (performance.now() >= requestDeadline || controller.signal.aborted)
      throw new Error('request-timeout');
  };
  try {
    return await Promise.race([
      (async () => {
        const url = `https://api.browserstack.com/automate/sessions/${options.sessionId}/${endpoint}`;
        const response = await (options.fetcher ?? fetch)(url, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Basic ${Buffer.from(`${options.username}:${options.accessKey}`).toString('base64')}`,
            Accept: 'text/plain',
          },
        });
        check();
        entry.httpStatus = response.status;
        if (
          response.redirected ||
          response.type === 'opaqueredirect' ||
          (response.status >= 300 && response.status < 400)
        )
          throw new Error('redirect-blocked');
        if (response.url && response.url !== url) throw new Error('unexpected-response-url');
        if (response.status !== 200) throw new Error(`http-${response.status}`);
        const length = response.headers.get('content-length');
        if (length && /^\d+$/.test(length) && Number(length) > diagnosticLimits.responseBytes)
          throw new Error('response-too-large');
        reader = response.body?.getReader();
        if (!reader) throw new Error('response-empty');
        const chunks: Uint8Array[] = [];
        const digest = createHash('sha256');
        for (;;) {
          check();
          const chunk = await reader.read();
          check();
          if (chunk.done) break;
          entry.bytes += chunk.value.byteLength;
          if (entry.bytes > diagnosticLimits.responseBytes) throw new Error('response-too-large');
          if (chunk.value.byteLength) {
            chunks.push(chunk.value);
            digest.update(chunk.value);
          }
        }
        if (!entry.bytes) throw new Error('response-empty');
        let text: string;
        const bytes = Buffer.concat(chunks);
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          throw new Error('response-invalid-encoding');
        }
        if (!text.trim()) throw new Error('response-empty');
        entry.structure = logStructure(
          text,
          response.headers.get('content-type'),
          bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
        );
        const analysis = analyzeSessionLog(text, endpoint);
        check();
        entry.sha256 = digest.digest('hex');
        return analysis;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(performance.now() >= deadline ? 'overall-timeout' : 'request-timeout'));
        }, allotted);
      }),
    ]);
  } catch (error) {
    throw new Error(safeFailure(error));
  } finally {
    clearTimeout(timer);
    controller.abort();
    try {
      void reader?.cancel().catch(() => {});
    } catch {
      /* No raw diagnostic failure escapes. */
    }
    entry.elapsedMilliseconds = Math.round(performance.now() - started);
  }
}

export async function collectSessionDiagnostics(options: Options): Promise<SessionDiagnostics> {
  const deadline = performance.now() + diagnosticLimits.overallMilliseconds;
  const report: SessionDiagnostics = {
    schemaVersion: 1,
    operation: 'read-completed-session-logs',
    execution: {
      sourceSha: sha(options.sourceSha),
      testedSha: sha(options.testedSha),
      runId: positiveInteger(options.runId),
      attempt: positiveInteger(options.attempt),
    },
    target: { sessionId: sha(options.sessionId) },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'failed',
    stage: 'before-request',
    failure: 'collection-incomplete',
    diagnosis: 'unclassified',
    capabilityAcceptance: 'not-assessed',
    providerSessionsAllocated: 0,
    retrievals: [],
  };
  const credentials =
    typeof options.username === 'string' &&
    options.username.length > 0 &&
    options.username.length <= 256 &&
    !options.username.includes(':') &&
    typeof options.accessKey === 'string' &&
    options.accessKey.length > 0 &&
    options.accessKey.length <= 4096 &&
    ![...options.username, ...options.accessKey].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    );
  const invalid = !report.target.sessionId
    ? 'invalid-session-id'
    : !report.execution.sourceSha
      ? 'invalid-source-sha'
      : !report.execution.testedSha
        ? 'invalid-tested-sha'
        : !credentials
          ? 'missing-or-invalid-credentials'
          : null;
  const journal = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const left = deadline - performance.now();
    if (left <= 0) throw new Error('overall-timeout');
    try {
      await Promise.race([
        options.journal?.(structuredClone(report)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('overall-timeout')), left);
        }),
      ]);
      // A journal is a snapshot, not acknowledgment that its write finished in
      // time. On a late final write the returned/logged result and CLI failure
      // supersede that snapshot; do not retry persistence beyond this bound.
      if (performance.now() >= deadline) throw new Error('overall-timeout');
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message === 'overall-timeout'
          ? 'overall-timeout'
          : 'journal-failed',
      );
    } finally {
      clearTimeout(timer);
    }
  };
  if (invalid) {
    report.stage = 'configuration';
    report.failure = invalid;
    report.finishedAt = new Date().toISOString();
  }
  try {
    await journal(); // A failed initial report write prevents every provider GET.
    if (invalid) return report;
    for (const endpoint of ['appiumlogs', 'logs'] as const) {
      report.stage = 'retrieving';
      const entry: Retrieval = {
        endpoint,
        status: 'pending',
        httpStatus: null,
        bytes: 0,
        sha256: null,
        elapsedMilliseconds: null,
        failure: null,
        analysis: null,
        structure: null,
      };
      report.retrievals.push(entry);
      await journal();
      try {
        entry.analysis = await retrieve(options, endpoint, deadline, entry);
        entry.status = 'available';
      } catch (error) {
        entry.status = 'failed';
        entry.failure = safeFailure(error);
        throw error;
      }
      await journal();
      if (
        entry.analysis.failures.length &&
        !entry.analysis.omittedFailures &&
        !entry.analysis.ambiguousTransactions &&
        !entry.analysis.malformedRecords &&
        !entry.analysis.unfinishedTransactions &&
        !entry.analysis.rejectedTerminalRecords &&
        entry.analysis.failures.every((failure) => failure.cause !== 'unclassified')
      )
        break;
    }
    const failures = report.retrievals.flatMap((entry) => entry.analysis?.failures ?? []);
    const incomplete = report.retrievals.some(
      (entry) =>
        !entry.analysis ||
        entry.analysis.omittedFailures ||
        entry.analysis.ambiguousTransactions ||
        entry.analysis.malformedRecords ||
        entry.analysis.unfinishedTransactions ||
        entry.analysis.rejectedTerminalRecords,
    );
    report.diagnosis = !failures.some((entry) => entry.cause !== 'unclassified')
      ? 'unclassified'
      : !incomplete && failures.every((entry) => entry.cause !== 'unclassified')
        ? 'classified'
        : 'partially-classified';
    report.status = 'available';
    report.failure = null;
  } catch (error) {
    report.status = 'failed';
    report.failure = safeFailure(error);
  }
  report.stage = 'finished';
  report.finishedAt = new Date().toISOString();
  try {
    await journal();
  } catch (error) {
    report.status = 'failed';
    report.failure = safeFailure(error);
  }
  return report;
}

async function main() {
  let testedSha: string | undefined;
  try {
    testedSha = (
      await promisify(execFile)('git', ['rev-parse', 'HEAD'], { timeout: 1000, maxBuffer: 1024 })
    ).stdout.trim();
  } catch {
    /* The report records the invalid identity; no provider request follows. */
  }
  await mkdir('artifacts', { recursive: true });
  const report = await collectSessionDiagnostics({
    sessionId: process.env.BS_DIAGNOSTIC_SESSION,
    sourceSha: process.env.SOURCE_SHA,
    testedSha,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    username: process.env.BS_USERNAME,
    accessKey: process.env.BS_ACCESS_KEY,
    journal: (value) =>
      writeFile(
        'artifacts/browserstack-session-diagnostics.json',
        `${JSON.stringify(value, null, 2)}\n`,
      ),
  });
  const summary = `Completed-session diagnostics: ${report.status}; diagnosis: ${report.diagnosis}; requests: ${report.retrievals.length}; capability acceptance: not assessed.\n`;
  console.log(summary.trim());
  // The receipt contains only validated identities, bounded classifications and
  // digests. Retain it in job logs too, so diagnosis does not depend on downloading
  // an expiring artifact. Provider response bodies never enter this report.
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  if (report.status !== 'available') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Completed-session diagnostics failed; no raw logs or credentials were printed.');
    process.exitCode = 1;
  });
}
