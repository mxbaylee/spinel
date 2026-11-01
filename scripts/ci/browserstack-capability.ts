import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readAdmissionPolicy,
  reservationForRun,
  type Reservation,
  type ReservationIdentity,
  type ReservationReceipt,
} from './browserstack-admission.ts';
import {
  browserstackOrigin,
  createBrowserstackFixture,
  type BrowserstackFixture,
} from './browserstack-fixture.ts';
import { ledgerClient } from './browserstack-ledger.ts';
import { clientFor, targetsFromInventory, type Target } from './browserstack.ts';

type Row = Record<string, unknown>;
type Client = ReturnType<typeof clientFor>;
type Fixture = Pick<
  BrowserstackFixture,
  'origin' | 'loginURL' | 'actor' | 'items' | 'imageRows' | 'certificate' | 'close'
>;
const laneMilliseconds = 180_000;
const cleanupMilliseconds = 15_000;
const reportPath = 'artifacts/browserstack-capability.json';
const sessionPattern = /^[a-f0-9]{40}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-response-shape');
  return value as Row;
}
function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/\/_desktop-login\/[^\s"'<>?#]+/g, '/_desktop-login/[redacted]')
    .replace(
      /([?&](?:token|key|code|secret|session|credential)[^=\s]*=)[^&\s"'<>]*/gi,
      '$1[redacted]',
    )
    .slice(0, 500);
}
function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(?:http-\d{3}|request-failed|invalid-response-shape|webdriver-error|capability-[a-z-]+|admission-[a-z-]+)$/.test(
    message,
  )
    ? message
    : 'capability-operation-failed';
}
function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`capability-${code}`);
}

type BrowserTaskDiagnostic = {
  operation: string;
  transport: 'execute/sync-start-poll';
  phase:
    | 'started'
    | 'fulfilled'
    | 'rejected'
    | 'pending-timeout'
    | 'state-lost'
    | 'command-failed'
    | 'cleanup-failed';
  elapsedMilliseconds: number;
  failure?: string;
};
type SyncExecutor = (script: string, args: unknown[], timeout: number) => Promise<unknown>;

/** Start once, then observe volatile page memory. Never replay a POST or bootstrap. */
export async function observeBrowserTask(
  executeSync: SyncExecutor,
  body: string,
  args: unknown[],
  options: {
    operation: string;
    deadline: number;
    diagnostic: (value: BrowserTaskDiagnostic) => Promise<void>;
  },
) {
  const id = randomUUID();
  const began = Date.now();
  const deadline = Math.min(options.deadline, began + 10_000);
  let diagnosedFailure = false;
  let succeeded = false;
  let value: unknown;
  let operationFailed = false;
  let operationError: unknown;
  let cleanupFailed = false;
  const diagnostic = (phase: BrowserTaskDiagnostic['phase'], error?: unknown) =>
    options.diagnostic({
      operation: options.operation,
      transport: 'execute/sync-start-poll',
      phase,
      elapsedMilliseconds: Date.now() - began,
      ...(error ? { failure: failure(error) } : {}),
    });
  const timeout = () => Math.max(1, deadline - Date.now());
  try {
    requireCondition(deadline > Date.now(), 'browser-task-pending-timeout');
    const started = row(
      await executeSync(
        `
      const [id,args]=arguments; const slot=Symbol.for('spinel.capability.observations');
      const tasks=globalThis[slot] ??= Object.create(null);
      if(Object.hasOwn(tasks,id)) throw new Error('duplicate observation');
      const state=tasks[id]={phase:'pending'};
      (async function(){ ${body} }).apply(undefined,args).then(
        value=>{state.value=value;state.phase='fulfilled';},
        ()=>{state.phase='rejected';});
      return {started:true};
    `,
        [id, args],
        timeout(),
      ),
    );
    requireCondition(started.started === true, 'browser-task-start-unverified');
    await diagnostic('started');
    while (Date.now() < deadline) {
      const state = row(
        await executeSync(
          `
        const tasks=globalThis[Symbol.for('spinel.capability.observations')];
        const state=tasks?.[arguments[0]];
        if(!state)return {phase:'missing'};
        return state.phase==='fulfilled' ? {phase:state.phase,value:state.value} : {phase:state.phase};
      `,
          [id],
          timeout(),
        ),
      );
      if (state.phase === 'fulfilled') {
        await diagnostic('fulfilled');
        succeeded = true;
        value = state.value;
        break;
      }
      if (state.phase === 'rejected') {
        diagnosedFailure = true;
        await diagnostic('rejected');
        throw new Error('capability-browser-task-rejected');
      }
      if (state.phase !== 'pending') {
        diagnosedFailure = true;
        await diagnostic('state-lost');
        throw new Error('capability-browser-task-state-lost');
      }
      await new Promise((done) =>
        setTimeout(done, Math.max(1, Math.min(100, deadline - Date.now()))),
      );
    }
    if (!succeeded) {
      diagnosedFailure = true;
      await diagnostic('pending-timeout');
      throw new Error('capability-browser-task-pending-timeout');
    }
  } catch (error) {
    operationFailed = true;
    operationError = error;
    if (!diagnosedFailure) await diagnostic('command-failed', error);
  } finally {
    try {
      const cleanup = row(
        await executeSync(
          `
        const slot=Symbol.for('spinel.capability.observations');const tasks=globalThis[slot];
        if(tasks){delete tasks[arguments[0]];if(Object.keys(tasks).length===0)delete globalThis[slot];}
        return {removed:!tasks || !Object.hasOwn(tasks,arguments[0])};
      `,
          [id],
          5_000,
        ),
      );
      requireCondition(cleanup.removed === true, 'browser-task-cleanup-failed');
    } catch (error) {
      cleanupFailed = true;
      await diagnostic('cleanup-failed', error);
    }
  }
  if (operationFailed) throw operationError;
  if (cleanupFailed) throw new Error('capability-browser-task-cleanup-failed');
  return value;
}

/** A downloaded manifest cannot authorize a different run or a stale durable hold. */
export function verifyCapabilityAdmission(
  manifest: unknown,
  durable: unknown,
  identity: ReservationIdentity,
  now = Date.now(),
): Reservation {
  const artifact = row(manifest);
  const ledger = row(durable);
  const persistence = row(artifact.persistence);
  requireCondition(
    artifact.schemaVersion === 2 && artifact.allocationAllowed === true,
    'admission-not-allowed',
  );
  requireCondition(ledger.schemaVersion === 2, 'admission-ledger-version');
  requireCondition(
    persistence.status === 'verified' &&
      typeof persistence.commit === 'string' &&
      /^[a-f0-9]{40}$/.test(persistence.commit),
    'admission-not-persisted',
  );
  for (const key of ['runId', 'attempt', 'sourceSha', 'testedSha'] as const)
    requireCondition(artifact[key] === identity[key], 'admission-identity-mismatch');
  const reservation = reservationForRun(artifact.admissionState, identity);
  const current = reservationForRun(ledger.admissionState, identity);
  requireCondition(
    JSON.stringify(artifact.reservation) === JSON.stringify(reservation),
    'admission-manifest-mismatch',
  );
  requireCondition(
    JSON.stringify(current) === JSON.stringify(reservation),
    'admission-durable-mismatch',
  );
  const policy = readAdmissionPolicy(artifact.policy);
  const policyDigest = hash(JSON.stringify(policy));
  requireCondition(policyDigest === reservation.policySha256, 'admission-policy-mismatch');
  requireCondition(
    hash(JSON.stringify(readAdmissionPolicy(row(ledger.latest).policy))) === policyDigest,
    'admission-policy-mismatch',
  );
  requireCondition(
    reservation.seconds === 900 * policy.chargedSecondsPerElapsedSecond,
    'admission-reservation-too-small',
  );
  const age = now - Date.parse(reservation.reservedAt);
  requireCondition(
    Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000,
    'admission-stale',
  );
  return reservation;
}

/** Keep the provider callback behind the same guard used by both CLI modes. */
export async function withCapabilityAdmission<T>(
  manifest: unknown,
  identity: ReservationIdentity,
  readLedger: () => Promise<unknown>,
  action: (reservation: Reservation) => Promise<T>,
  now = Date.now(),
): Promise<T> {
  return action(verifyCapabilityAdmission(manifest, await readLedger(), identity, now));
}

export type NativeControl = { type: string; attributes: Record<string, string> };
function decodeXML(value: string): string {
  return value.replace(/&(?:quot|apos|lt|gt|amp);|&#(?:x[a-f0-9]+|\d+);/gi, (entity) => {
    const named: Record<string, string> = {
      '&quot;': '"',
      '&apos;': "'",
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&',
    };
    if (named[entity]) return named[entity];
    const number = entity.startsWith('&#x')
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number(entity.slice(2, -1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  });
}
/** Match only controls actually exposed by the device's native accessibility tree. */
export function nativeControls(source: unknown): NativeControl[] {
  requireCondition(
    typeof source === 'string' && source.length <= 2_000_000,
    'native-source-invalid',
  );
  const controls: NativeControl[] = [];
  for (const match of source.matchAll(/<([\w.:-]+)\s+([^<>]*?)\/?\s*>/g)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[2].matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g))
      attributes[attribute[1]] = decodeXML(attribute[2] ?? attribute[3]);
    if (
      attributes.enabled === 'false' ||
      attributes.visible === 'false' ||
      attributes.displayed === 'false'
    )
      continue;
    if (['text', 'content-desc', 'label', 'name', 'resource-id'].some((key) => attributes[key]))
      controls.push({ type: match[1], attributes });
  }
  return controls;
}
export const installMenuLabel =
  /^(?:Install|Install app|Install and create shortcut|Add to Home screen|Add page to)$/i;
// Google's documented universal menu offers Install, or Create shortcut followed by Add.
// Prefer an exposed install control even when the shortcut node appears first in XML.
export const installConfirmationLabels = [
  /^Install$/i,
  /^Create shortcut$/i,
  /^(?:Add|Add to Home screen|Add automatically)$/i,
];
export function matchingNativeControl(controls: NativeControl[], patterns: RegExp | RegExp[]) {
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    for (const control of controls) {
      const attribute = ['content-desc', 'label', 'name', 'text', 'resource-id'].find((key) =>
        pattern.test(control.attributes[key] ?? ''),
      );
      if (attribute) return { control, attribute, label: control.attributes[attribute] };
    }
  }
  return null;
}
export async function openNativeShare(
  tap: (pattern: RegExp, required?: boolean) => Promise<boolean>,
) {
  const share = /^Share(?:…|\.\.\.)?$/i;
  if (await tap(share, false)) return;
  // Safari's observed compact toolbar can place Share inside the page menu.
  // Each candidate still needs an exact, currently exposed native control.
  await tap(/^(?:Page Menu|Menu|More|More options)$/i);
  await tap(share);
}
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(',"\'",')})`;
}
function elementId(value: unknown): string {
  const element = row(value);
  const id = element['element-6066-11e4-a52e-4f735466cecf'] ?? element.ELEMENT;
  requireCondition(typeof id === 'string' && /^[\w:.-]{1,200}$/.test(id), 'element-id-invalid');
  return id;
}
type Observation = { stage: string; value: unknown };
export type CapabilityResult = {
  target: Target;
  status: 'passed' | 'failed' | 'blocked';
  startedAt: string | null;
  finishedAt?: string;
  stage: string;
  command: string;
  sessionId?: string;
  allocation: 'not-started' | 'uncertain' | 'known';
  uncertainAllocation: boolean;
  failure?: string;
  observations: Observation[];
  nativeActions: { stage: string; label: string; type: string; sourceSha256: string }[];
  screenshots: string[];
  cleanup: { network: string; session: string; fixture: string };
};
/** A maintained blocker is evidence, not a successful or silently skipped lane. */
export async function runCapabilityLane(
  target: Target,
  execute: () => Promise<CapabilityResult>,
): Promise<CapabilityResult> {
  if (target.browser !== 'firefox') return execute();
  return {
    target,
    status: 'blocked',
    startedAt: null,
    stage: 'maintained-native-context-blocker',
    command: 'not-run',
    allocation: 'not-started',
    uncertainAllocation: false,
    failure: 'capability-firefox-native-context-blocked',
    nativeActions: [],
    screenshots: [],
    cleanup: { network: 'not-allocated', session: 'not-allocated', fixture: 'not-created' },
    observations: [
      {
        stage: 'maintained-blocker',
        value: {
          reason:
            'The recorded real Android Firefox Automate session rejected its native-context command. This remediation does not repeat the unchanged allocation.',
          evidence: {
            path: 'docs/implementation/evidence/SPN-090-capability-41361564434.json',
            sha256: '10b1a93bceb3ed863357aee3c68027c224449a58155ef5f0d8dd31d2b6682485',
            runId: '41361564434',
            sourceSha: '1fae4a7e0a6653c4bb9b3c8344fe4389503a3077',
            testedSha: 'e4804654b385d99bb8f7769a64d0982adbaf0076',
            sessionId: '6e4005be4ded0e0576b96fae55711fdd4fbaadff',
            command: 'GET session/{sessionId}/contexts',
            failure: 'http-400',
          },
          removalCondition:
            'Establish a supported public Automate native Firefox route or choose a native-capable real Firefox runner, then replace this blocker with actual evidence.',
        },
      },
    ],
  };
}
export function capabilityOutcome(lanes: CapabilityResult[]): 'passed' | 'failed' | 'incomplete' {
  if (lanes.length !== 3 || new Set(lanes.map((lane) => lane.target.browser)).size !== 3)
    return 'incomplete';
  if (lanes.some((lane) => lane.status === 'failed')) return 'failed';
  if (lanes.some((lane) => lane.status === 'blocked')) return 'incomplete';
  return 'passed';
}
/** Link-state alone is insufficient: both independent uncached requests must fail. */
export function verifyTransportProbe(value: unknown, reachable: boolean) {
  const probe = row(value);
  requireCondition(
    typeof probe.online === 'boolean' && Array.isArray(probe.checks) && probe.checks.length === 2,
    'network-probe-invalid',
  );
  const checks = probe.checks.map(row);
  requireCondition(
    checks[0].path === '/api/auth/session' && checks[1].path === '/capability-network-probe',
    'network-probe-invalid',
  );
  requireCondition(
    checks.every((check) => check.reachable === reachable),
    reachable ? 'online-baseline-unreachable' : 'device-still-online',
  );
}
export function launchedWindow(value: unknown, previous: string[]) {
  requireCondition(
    Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 20 &&
      value.every((handle) => typeof handle === 'string' && /^[\w:.-]{1,200}$/.test(handle)),
    'window-handles-invalid',
  );
  const handles = value as string[];
  const added = handles.filter((handle) => !previous.includes(handle));
  requireCondition(added.length === 1 || handles.length === 1, 'launched-window-ambiguous');
  return {
    handle: added.length === 1 ? added[0] : handles[0],
    handles,
    relation: added.length === 1 ? 'new-after-native-launch' : 'sole-browser-window',
  };
}
export function verifyLaunchedBrowser(
  target: Target,
  foreground: string,
  environment: Row,
  bundleId?: unknown,
) {
  const userAgent = String(environment.userAgent ?? '');
  const standalone = environment.standalone === true || environment.navigatorStandalone === true;
  const browser = {
    chrome: /Android.*Chrome\//,
    firefox: /Android.*Gecko\/.*Firefox\//,
    safari: /iPhone.*AppleWebKit\//,
  }[target.browser];
  requireCondition(
    browser.test(userAgent) &&
      !/SamsungBrowser\/|EdgA\/|OPR\//.test(userAgent) &&
      !(target.browser === 'firefox' && /Chrome\//.test(userAgent)) &&
      !(target.browser === 'safari' && /CriOS\/|FxiOS\//.test(userAgent)),
    'launched-browser-mismatch',
  );
  requireCondition(
    bundleId === undefined || bundleId === null || bundleId === foreground,
    'launched-context-foreground-mismatch',
  );
  const foregroundMatches =
    target.browser === 'chrome'
      ? /^com\.android\.chrome$|^com\.chrome\.(?:beta|dev|canary)$/.test(foreground) ||
        (standalone && foreground.startsWith('org.chromium.webapk.'))
      : target.browser === 'firefox'
        ? /^org\.mozilla\.(?:firefox|fenix)(?:[._].*)?$/.test(foreground)
        : /^com\.apple\.(?:mobilesafari|webapp(?:\..*)?)$/.test(foreground);
  requireCondition(foregroundMatches, 'launched-foreground-browser-mismatch');
  requireCondition(target.browser !== 'safari' || standalone, 'ios-launch-not-standalone');
  return {
    launchMode: standalone ? 'standalone' : 'browser-shortcut',
    nativeForeground: foreground,
    contextBundleId: bundleId ?? null,
  };
}
type CapabilityOptions = {
  localIdentifier: string;
  buildName: string;
  journal: (result: CapabilityResult) => Promise<void>;
  screenshot: (name: string, data: string) => Promise<string>;
};

const environmentScript = `return {
  origin: location.origin, path: location.pathname, title: document.title,
  userAgent: navigator.userAgent, secureContext: isSecureContext,
  serviceWorkerAvailable: 'serviceWorker' in navigator,
  controller: navigator.serviceWorker?.controller?.scriptURL || null,
  standalone: matchMedia('(display-mode: standalone)').matches,
  navigatorStandalone: navigator.standalone === true,
  online: navigator.onLine,
  anonymousReady: document.body.innerText.includes('Your workspace.') &&
    [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Sign in with a passkey' && !button.disabled),
  invalidCertificate: /certificate|not private|not secure/i.test(document.title + ' ' + document.body.innerText.slice(0, 3000))
};`;

/** No application data is injected: prepare through the production download action. */
export async function runCapability(
  client: Client,
  target: Target,
  fixture: Fixture,
  options: CapabilityOptions,
): Promise<CapabilityResult> {
  const result: CapabilityResult = {
    target,
    status: 'failed',
    startedAt: new Date().toISOString(),
    stage: 'preflight',
    command: '',
    allocation: 'not-started',
    uncertainAllocation: false,
    observations: [],
    nativeActions: [],
    screenshots: [],
    cleanup: { network: 'not-allocated', session: 'not-allocated', fixture: 'pending' },
  };
  const deadline = Date.now() + laneMilliseconds;
  const signal = AbortSignal.timeout(laneMilliseconds);
  let previousWindowHandles: string[] = [];
  const sanitize = (value: unknown): unknown =>
    typeof value === 'string'
      ? client.redact(clean(value))
      : Array.isArray(value)
        ? value.map(sanitize)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]))
          : value;
  const record = async (stage: string, value: unknown) => {
    result.observations.push({ stage, value: sanitize(value) });
    await options.journal(result);
  };
  const stage = (name: string) => {
    result.stage = name;
  };
  function remaining(maximum = 15_000) {
    const left = deadline - Date.now();
    requireCondition(left > 0 && !signal.aborted, 'lane-deadline');
    return Math.max(1, Math.min(maximum, left));
  }
  async function command(
    path: string,
    method = 'GET',
    body?: unknown,
    timeout = path === 'session' ? 45_000 : 15_000,
  ) {
    result.command = `${method} ${path.replace(result.sessionId ?? '\0', '{sessionId}')}`;
    return client.command(path, method, body, {
      timeout: remaining(timeout),
      signal,
    });
  }
  const session = (suffix: string) => `session/${result.sessionId}/${suffix}`;
  const execute = (script: string, args: unknown[] = [], timeout = 15_000) =>
    command(session('execute/sync'), 'POST', { script, args }, timeout);
  const executeAsync = (body: string, args: unknown[] = [], operation = 'browser-observation') =>
    target.browser === 'safari'
      ? observeBrowserTask(execute, body, args, {
          operation,
          deadline,
          diagnostic: (value) => record(`${result.stage}:async-observation`, value),
        })
      : command(session('execute/async'), 'POST', {
          script: `const done = arguments[arguments.length - 1]; (async () => { ${body} })().then(value => done({ok:true,value}), () => done({ok:false}));`,
          args,
        }).then((value) => {
          const answer = row(value);
          requireCondition(answer.ok === true, 'browser-observation-failed');
          return answer.value;
        });
  async function poll<T>(
    read: () => Promise<T>,
    accepts: (value: T) => boolean,
    label: string,
    maximum = 15_000,
  ): Promise<T> {
    const until = Math.min(deadline, Date.now() + maximum);
    do {
      const value = await read();
      if (accepts(value)) return value;
      await new Promise((done) => setTimeout(done, 200));
    } while (Date.now() < until);
    throw new Error(`capability-${label}`);
  }
  async function screenshot(name: string) {
    try {
      const data = await command(session('screenshot'));
      requireCondition(
        typeof data === 'string' && data.length <= 15_000_000 && /^[A-Za-z0-9+/=]+$/.test(data),
        'screenshot-invalid',
      );
      result.screenshots.push(await options.screenshot(`${target.browser}-${name}`, data));
    } catch {
      result.observations.push({ stage: result.stage, value: { screenshot: 'unavailable' } });
    }
  }
  async function context(name: string) {
    await command(session('context'), 'POST', { name });
  }
  async function controls() {
    const source = await command(session('source'));
    const parsed = nativeControls(source);
    await record(`${result.stage}:native-controls`, {
      sourceSha256: hash(String(source)),
      labels: parsed
        .flatMap((control) =>
          ['content-desc', 'label', 'name', 'text', 'resource-id']
            .filter((key) => control.attributes[key])
            .map((key) => ({
              type: control.type,
              attribute: key,
              value: clean(control.attributes[key]),
            })),
        )
        .slice(0, 100),
    });
    return { parsed, sourceSha256: hash(String(source)) };
  }
  async function tap(pattern: RegExp | RegExp[], required = true): Promise<boolean> {
    const source = await controls();
    const match = matchingNativeControl(source.parsed, pattern);
    if (match) {
      const { control, attribute, label } = match;
      const element = await command(session('element'), 'POST', {
        using: 'xpath',
        value: `//*[@${attribute}=${xpathLiteral(label)}]`,
      });
      await command(session(`element/${elementId(element)}/click`), 'POST', {});
      result.nativeActions.push({
        stage: result.stage,
        label: client.redact(clean(label)),
        type: control.type,
        sourceSha256: source.sourceSha256,
      });
      await options.journal(result);
      return true;
    }
    requireCondition(!required, 'native-control-unavailable');
    return false;
  }
  async function scroll() {
    if (target.browser === 'safari') {
      await execute('mobile: scroll', [{ direction: 'down' }]);
    } else {
      const bounds = row(await command(session('window/rect')));
      requireCondition(
        typeof bounds.width === 'number' && typeof bounds.height === 'number',
        'window-bounds-invalid',
      );
      const x = Math.floor(bounds.width / 2);
      await command(session('actions'), 'POST', {
        actions: [
          {
            type: 'pointer',
            id: 'finger',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x, y: Math.floor(bounds.height * 0.8) },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: 400, x, y: Math.floor(bounds.height * 0.35) },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
    }
  }
  async function home() {
    await context('NATIVE_APP');
    if (target.browser === 'safari') await execute('mobile: pressButton', [{ name: 'home' }]);
    else await command(session('appium/device/press_keycode'), 'POST', { keycode: 3 });
  }
  async function foreground(): Promise<string> {
    await context('NATIVE_APP');
    const value =
      target.browser === 'safari'
        ? row(await execute('mobile: activeAppInfo')).bundleId
        : await command(session('appium/device/current_package'));
    requireCondition(
      typeof value === 'string' &&
        /^[A-Za-z][\w.-]{1,200}$/.test(value) &&
        value !== 'com.apple.springboard',
      'foreground-app-unavailable',
    );
    await record(`${result.stage}:foreground`, { appId: value });
    return value;
  }
  async function attach(foregroundApp: string): Promise<Row> {
    const value = await command(session('contexts'));
    requireCondition(Array.isArray(value), 'native-contexts-unavailable');
    const contexts = value.map((entry) => (typeof entry === 'string' ? { id: entry } : row(entry)));
    await record(
      `${result.stage}:contexts`,
      contexts.map((entry) => ({
        id: clean(entry.id),
        title: clean(entry.title),
        url: clean(entry.url),
        bundleId: clean(entry.bundleId),
      })),
    );
    for (const entry of contexts.slice().reverse()) {
      if (typeof entry.id !== 'string' || entry.id === 'NATIVE_APP') continue;
      try {
        await context(entry.id);
        const selected = launchedWindow(
          await command(session('window/handles')),
          previousWindowHandles,
        );
        await command(session('window'), 'POST', { handle: selected.handle });
        const environment = row(await execute(environmentScript));
        if (environment.origin === fixture.origin) {
          const association = verifyLaunchedBrowser(
            target,
            foregroundApp,
            environment,
            entry.bundleId,
          );
          previousWindowHandles = selected.handles;
          return {
            ...environment,
            ...association,
            contextId: entry.id,
            windowHandle: selected.handle,
            windowRelation: selected.relation,
          };
        }
      } catch (error) {
        await record(`${result.stage}:context-rejected`, {
          id: clean(entry.id),
          failure: failure(error),
        });
      }
    }
    throw new Error('capability-installed-webview-unavailable');
  }
  async function launchIcon() {
    if (await tap(/^Spinel$/i, false)) return;
    // Newly added icons can be placed on a later launcher page. Every tap still
    // requires a fresh matching accessibility node after a bounded page swipe.
    for (let attempt = 0; attempt < 2; attempt++) {
      const bounds = row(await command(session('window/rect')));
      requireCondition(
        typeof bounds.width === 'number' && typeof bounds.height === 'number',
        'window-bounds-invalid',
      );
      const y = Math.floor(bounds.height * 0.5);
      await command(session('actions'), 'POST', {
        actions: [
          {
            type: 'pointer',
            id: 'launcher-finger',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: Math.floor(bounds.width * 0.8), y },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: 350, x: Math.floor(bounds.width * 0.2), y },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
      if (await tap(/^Spinel$/i, false)) return;
    }
    throw new Error('capability-home-icon-unavailable');
  }
  async function recordLaunch(name: string, environment: Row) {
    const standalone = environment.standalone === true || environment.navigatorStandalone === true;
    await record(name, {
      ...environment,
      launchMode: standalone ? 'standalone' : 'browser-shortcut',
    });
    requireCondition(target.browser !== 'safari' || standalone, 'ios-launch-not-standalone');
  }
  async function secureEnvironment(anonymous = false) {
    const environment = await poll(
      async () => row(await execute(environmentScript)),
      (value) =>
        value.origin === fixture.origin &&
        value.secureContext === true &&
        value.serviceWorkerAvailable === true &&
        typeof value.controller === 'string' &&
        value.controller === `${fixture.origin}/service-worker.js` &&
        (!anonymous || value.anonymousReady === true),
      'secure-worker-unavailable',
    );
    if (target.browser === 'safari') {
      requireCondition(
        (await executeAsync('return await Promise.resolve(true);', [], 'promise-readiness')) ===
          true,
        'browser-promise-readiness-failed',
      );
    }
    const registration = row(
      await executeAsync(
        `const registration = await navigator.serviceWorker.getRegistration('/');
      return {scope:registration?.scope || null, active:registration?.active?.scriptURL || null, state:registration?.active?.state || null};`,
        [],
        'worker-registration',
      ),
    );
    requireCondition(
      registration.scope === `${fixture.origin}/` &&
        registration.active === `${fixture.origin}/service-worker.js` &&
        registration.state === 'activated',
      'worker-registration-unavailable',
    );
    await record(`${result.stage}:secure-context`, {
      ...environment,
      userAgent: clean(environment.userAgent),
      registration,
    });
    return environment;
  }
  async function clickWeb(selector: string, label: string) {
    const id = await execute(
      `const [selector,label] = arguments; const matches = [...document.querySelectorAll(selector)].filter(element =>
      (element.getAttribute('aria-label') || element.textContent.trim()) === label && element.getBoundingClientRect().height > 0 && !element.disabled);
      return matches.length === 1 ? matches[0] : null;`,
      [selector, label],
    );
    requireCondition(id !== null, 'production-control-unavailable');
    await command(session(`element/${elementId(id)}/click`), 'POST', {});
  }
  async function itemReady(offline: boolean) {
    return poll(
      async () =>
        row(
          await execute(`return {status:document.querySelector('[aria-label="Save status"]')?.textContent || '',
      canvasHeight:Math.max(0,...[...document.querySelectorAll('.univer-container canvas')].map(canvas=>canvas.getBoundingClientRect().height)),
      phoneReadOnly:document.body.innerText.includes('View only on this phone. Edit on a larger screen.'),
      account:localStorage.getItem('spinel.offline.account')};`),
        ),
      (value) =>
        Number(value.canvasHeight) > 100 &&
        (value.phoneReadOnly === true ||
          String(value.status).includes(offline ? 'Saved on this device' : 'All changes saved.') ||
          (!offline && String(value.status).includes('Synced.'))),
      'production-item-not-ready',
    );
  }
  async function storedItems(items: Fixture['items']) {
    return row(
      await executeAsync(
        `
      const [account, ids] = arguments;
      const database = await new Promise((resolve,reject)=>{ const request=indexedDB.open('spinel-offline-'+account);
        request.onupgradeneeded=()=>{request.transaction.abort(); reject(new Error('missing'));};
        request.onerror=()=>reject(new Error('unavailable')); request.onsuccess=()=>resolve(request.result); });
      const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
      try {
        const transaction=database.transaction(['items','images'],'readonly');
        const read=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('read'));});
        const pending=ids.map(id=>read(transaction.objectStore('items').get(id)));
        const allImages=read(transaction.objectStore('images').getAll());
        const [stored,images]=await Promise.all([Promise.all(pending),allImages]);
        const summaries=await Promise.all(stored.map(async(item,index)=>({id:ids[index],present:!!item,
          bundleSha256:item?.bundle ? await digest(new TextEncoder().encode(JSON.stringify(canonical(item.bundle)))) : null,
          images:await Promise.all(images.filter(image=>image.itemId===ids[index]).map(async image=>({sha256:await digest(image.bytes),size:image.bytes.byteLength}))) })));
        return {account:localStorage.getItem('spinel.offline.account'),items:summaries};
      } finally {database.close();}
    `,
        [fixture.actor.id, items.map((item) => item.id)],
        'stored-items-read',
      ),
    );
  }
  function checkStored(value: Row, items: Fixture['items']) {
    requireCondition(
      value.account === fixture.actor.id &&
        Array.isArray(value.items) &&
        value.items.length === items.length,
      'retained-account-mismatch',
    );
    for (const item of items) {
      const observed = value.items.map(row).find((entry) => entry.id === item.id);
      const expected = fixture
        .imageRows(item.id)
        .map((image) => ({
          sha256: String(image.id),
          size: Buffer.from(String(image.bytes), 'hex').length,
        }))
        .sort((a, b) => a.sha256.localeCompare(b.sha256));
      requireCondition(
        observed?.present === true &&
          typeof observed.bundleSha256 === 'string' &&
          Array.isArray(observed.images) &&
          expected.length > 0,
        'stored-item-missing',
      );
      const images = observed.images
        .map(row)
        .map((image) => ({ sha256: String(image.sha256), size: Number(image.size) }))
        .sort((a, b) => a.sha256.localeCompare(b.sha256));
      requireCondition(
        JSON.stringify(images) === JSON.stringify(expected),
        'stored-images-mismatch',
      );
    }
  }
  async function transportProbe(reachable: boolean) {
    const probe = row(
      await executeAsync(
        `const checks=await Promise.all(['/api/auth/session','/capability-network-probe'].map(async path=>{
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),2500);
      try {const response=await fetch(path+'?probe='+crypto.randomUUID(),{cache:'no-store',credentials:'include',signal:controller.signal});return {path,reachable:true,status:response.status};}
      catch{return {path,reachable:false};}finally{clearTimeout(timer);}}));return {online:navigator.onLine,checks};`,
        [],
        'transport-probe',
      ),
    );
    await record(`${result.stage}:network`, probe);
    verifyTransportProbe(probe, reachable);
  }
  async function socketTicket(item: Fixture['items'][number]) {
    const startedAt = Date.now();
    const ticket = row(
      await executeAsync(
        `const [item,unit]=arguments;
      const response=await fetch('/sync-api/items/'+encodeURIComponent(item)+'/ticket?unitId='+encodeURIComponent(unit),{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!response.ok)throw new Error('ticket');return await response.json();`,
        [item.id, item.unitId],
        'socket-ticket',
      ),
    );
    requireCondition(
      ticket.version === 1 &&
        typeof ticket.ticket === 'string' &&
        ticket.ticket.length > 0 &&
        ticket.ticket.length <= 1024 &&
        ticket.expiresInMs === 30_000,
      'socket-ticket-unavailable',
    );
    const url = new URL(`/sync-api/items/${encodeURIComponent(item.id)}/socket`, fixture.origin);
    url.protocol = 'wss:';
    url.searchParams.set('unitId', item.unitId);
    url.searchParams.set('ticket', ticket.ticket);
    if (typeof ticket.epoch === 'string') url.searchParams.set('epoch', ticket.epoch);
    return { url: url.href, expiresAt: startedAt + ticket.expiresInMs };
  }
  async function socketProbe(ticket: { url: string; expiresAt: number }, reachable: boolean) {
    requireCondition(Date.now() + 4_000 < ticket.expiresAt, 'socket-ticket-expired');
    const observed = await executeAsync(
      `return await new Promise(resolve=>{ const socket=new WebSocket(arguments[0]);
      let completed=false;const finish=opened=>{if(completed)return;completed=true;clearTimeout(timer);socket.close();resolve({opened});};
      const timer=setTimeout(()=>finish(false),3500);socket.onopen=()=>finish(true);socket.onerror=()=>finish(false);socket.onclose=()=>finish(false); });`,
      [ticket.url],
      'socket-probe',
    );
    requireCondition(Date.now() < ticket.expiresAt, 'socket-ticket-expired');
    await record(`${result.stage}:authenticated-socket`, {
      opened: row(observed).opened,
      ticketValidThroughoutProbe: true,
      credentialsRecorded: false,
    });
    requireCondition(
      row(observed).opened === reachable,
      reachable ? 'socket-baseline-unreachable' : 'device-socket-still-online',
    );
  }
  try {
    requireCondition(
      fixture.origin === browserstackOrigin && Boolean(options.localIdentifier),
      'fixture-preflight',
    );
    const prepared = fixture.items.filter((item) => item.outcome === 'normal');
    requireCondition(
      prepared.length === 2 &&
        prepared.some((item) => item.kind === 'doc') &&
        prepared.some((item) => item.kind === 'sheet'),
      'fixture-items-missing',
    );
    await record('certificate', fixture.certificate);
    stage('session-creation');
    result.allocation = 'uncertain';
    result.uncertainAllocation = true;
    await options.journal(result); // Must complete before the allocation request can leave the runner.
    const created = row(
      await command('session', 'POST', {
        capabilities: {
          alwaysMatch: {
            browserName: target.browser,
            acceptInsecureCerts: true,
            ...(target.browser === 'safari'
              ? { 'appium:additionalWebviewBundleIds': ['*'], 'appium:fullContextList': true }
              : {}),
            'bstack:options': {
              deviceName: target.device,
              osVersion: target.osVersion,
              realMobile: true,
              local: true,
              localIdentifier: options.localIdentifier,
              projectName: 'Spinel',
              buildName: options.buildName,
              sessionName: `SPN-090 native capability: ${target.browser}`,
              idleTimeout: 60,
              networkLogs: true,
              networkLogsOptions: { captureContent: false },
            },
            timeouts: { pageLoad: 15_000, script: 10_000, implicit: 0 },
          },
        },
      }),
    );
    requireCondition(
      typeof created.sessionId === 'string' && sessionPattern.test(created.sessionId),
      'session-id-unavailable',
    );
    result.sessionId = created.sessionId;
    result.allocation = 'known';
    await options.journal(result); // Persist known IDs before inspecting any returned capability.
    const capabilities = row(created.capabilities);
    await record(
      'returned-capabilities',
      Object.fromEntries(
        [
          'browserName',
          'browserVersion',
          'platformName',
          'platformVersion',
          'deviceName',
          'appium:deviceName',
          'appium:platformVersion',
        ]
          .filter((key) => Object.hasOwn(capabilities, key))
          .map((key) => [key, clean(capabilities[key])]),
      ),
    );
    stage('anonymous-https');
    await command(session('url'), 'POST', { url: fixture.origin });
    let initial: Row;
    try {
      initial = row(await execute(environmentScript));
    } catch (error) {
      if (target.browser !== 'safari') throw error;
      const source = await command(session('source'));
      requireCondition(
        typeof source === 'string' &&
          /certificate|connection is not private|connection is not secure/i.test(source),
        'certificate-page-unverified',
      );
      initial = {
        invalidCertificate: true,
        observation: 'native-certificate-warning',
        sourceSha256: hash(source),
      };
    }
    await record('initial-environment', { ...initial, userAgent: clean(initial.userAgent) });
    if (
      target.browser === 'safari' &&
      initial.invalidCertificate === true &&
      initial.anonymousReady !== true
    )
      await execute('browserstack_executor: {"action":"acceptSsl"}');
    const anonymous = await secureEnvironment(true);
    const expected = {
      chrome: /Android.*Chrome\//,
      firefox: /Android.*Gecko\/.*Firefox\//,
      safari: /iPhone.*Version\/.*Safari\//,
    }[target.browser];
    requireCondition(
      expected.test(String(anonymous.userAgent)) &&
        !(
          target.browser !== 'safari' &&
          /SamsungBrowser\/|EdgA\/|OPR\//.test(String(anonymous.userAgent))
        ) &&
        !(target.browser === 'firefox' && /Chrome\//.test(String(anonymous.userAgent))),
      'unexpected-browser',
    );
    const initialWindows = await command(session('window/handles'));
    requireCondition(
      Array.isArray(initialWindows) && initialWindows.every((handle) => typeof handle === 'string'),
      'window-handles-invalid',
    );
    previousWindowHandles = initialWindows;
    await record('initial-window-handles', initialWindows);
    await screenshot('anonymous-secure');
    stage('native-install');
    const initialContexts = await command(session('contexts'));
    requireCondition(Array.isArray(initialContexts), 'native-contexts-unavailable');
    await record('initial-native-contexts', initialContexts);
    await context('NATIVE_APP');
    if (target.browser === 'safari') await openNativeShare(tap);
    else
      await tap(
        /^(?:More options|Menu|Open menu|Customize and control Google Chrome)$|(?:^|:)menu_button$/i,
      );
    let installed = await tap(installMenuLabel, false);
    for (let count = 0; !installed && count < 2; count++) {
      await scroll();
      installed = await tap(installMenuLabel, false);
    }
    requireCondition(installed, 'native-install-control-unavailable');
    for (let count = 0; count < 2; count++) {
      if (!(await tap(installConfirmationLabels, false))) break;
    }
    await screenshot('installed-native');
    stage('home-launch');
    await home();
    await screenshot('home-icon');
    await launchIcon();
    const foregroundApp = await foreground();
    const launched = await attach(foregroundApp);
    await recordLaunch('launched-context', launched);
    await secureEnvironment(true);
    stage('installed-authentication');
    const authenticated = row(
      await executeAsync(
        `const response=await fetch(arguments[0],{cache:'no-store',credentials:'include'});
      if(!response.ok) throw new Error('bootstrap'); const session=await fetch('/api/auth/session',{cache:'no-store',credentials:'include'});
      if(!session.ok) throw new Error('session'); const body=await session.json();return {actor:body.user?.id || null};`,
        [fixture.loginURL],
        'installed-authentication',
      ),
    );
    requireCondition(authenticated.actor === fixture.actor.id, 'installed-authentication-failed');
    await record('installed-authentication', {
      actor: authenticated.actor,
      method: 'one-use-production-session-bootstrap-in-launched-context',
    });
    stage('production-downloads');
    for (const item of prepared) {
      await command(session('url'), 'POST', { url: `${fixture.origin}/?item=${item.id}` });
      await record(`${item.kind}:ready`, await itemReady(false));
      await clickWeb('button', 'Document actions');
      await clickWeb('[role="menuitem"]', 'Available offline on this device');
      const message = `${item.name} is available offline on this device.`;
      await poll(
        () =>
          execute(
            'return [...document.querySelectorAll(\'[role="dialog"] [role="status"]\')].some(element => element.textContent.includes(arguments[0]));',
            [message],
          ),
        (value) => value === true,
        'download-incomplete',
        20_000,
      );
      await clickWeb('[role="dialog"] button', 'Done');
      await screenshot(`${item.kind}-downloaded`);
    }
    const preparedEnvironment = await secureEnvironment();
    requireCondition(
      preparedEnvironment.standalone === launched.standalone &&
        preparedEnvironment.navigatorStandalone === launched.navigatorStandalone,
      'prepared-context-changed',
    );
    await recordLaunch('prepared-context', preparedEnvironment);
    stage('online-network-baseline');
    await transportProbe(true);
    await socketProbe(await socketTicket(prepared[0]), true);
    const unusedOfflineTicket = await socketTicket(prepared[0]);
    stage('device-offline');
    result.command = 'PUT automate/sessions/{sessionId}/update_network.json';
    await client.api(
      `sessions/${result.sessionId}/update_network.json`,
      'PUT',
      { networkProfile: 'no-network' },
      { timeout: remaining(), signal },
    );
    await record('network-control', { networkProfile: 'no-network', androidAirplaneMode: false });
    await socketProbe(unusedOfflineTicket, false);
    await transportProbe(false);
    const before = await storedItems(prepared);
    checkStored(before, prepared);
    await record('retained-before-restart', before);
    await screenshot('offline-before-termination');
    stage('same-session-termination');
    const observedForeground = await foreground();
    requireCondition(observedForeground === foregroundApp, 'foreground-app-changed');
    const app =
      target.browser === 'safari'
        ? { bundleId: observedForeground }
        : { appId: observedForeground };
    await command(session('appium/device/terminate_app'), 'POST', app);
    const state = await command(session('appium/device/app_state'), 'POST', app);
    await record('terminated-app', { appId: observedForeground, state });
    requireCondition(state === 1, 'termination-not-observed');
    stage('offline-home-relaunch');
    await home();
    await launchIcon();
    const relaunchedForeground = await foreground();
    requireCondition(relaunchedForeground === foregroundApp, 'relaunch-foreground-changed');
    const relaunched = await attach(relaunchedForeground);
    await recordLaunch('offline-relaunched-context', relaunched);
    await secureEnvironment();
    await transportProbe(false);
    await record('relaunch-socket', {
      status: 'not-retested',
      reason:
        'The authenticated unused ticket was tested immediately after no-network; no fresh ticket can be issued offline.',
    });
    const after = await storedItems(prepared);
    checkStored(after, prepared);
    requireCondition(JSON.stringify(after) === JSON.stringify(before), 'retained-bundle-changed');
    await record('retained-after-restart', after);
    for (const item of prepared) {
      await command(session('url'), 'POST', { url: `${fixture.origin}/?item=${item.id}` });
      const ready = await itemReady(true);
      requireCondition(ready.account === fixture.actor.id, 'retained-account-mismatch');
      await record(`${item.kind}:offline-ready`, ready);
      await screenshot(`${item.kind}-offline-reopened`);
    }
    stage('capability-complete');
    result.status = 'passed';
  } catch (error) {
    result.failure = failure(error);
    const failedCommand = result.command;
    if (result.sessionId && Date.now() < deadline) await screenshot('failure');
    result.command = failedCommand;
  } finally {
    const cleanupDeadline = Date.now() + cleanupMilliseconds;
    if (result.sessionId) {
      const cleanupSignal = AbortSignal.timeout(cleanupMilliseconds);
      try {
        await client.api(
          `sessions/${result.sessionId}/update_network.json`,
          'PUT',
          { networkProfile: '4g-lte-good' },
          { timeout: 7_000, signal: cleanupSignal },
        );
        result.cleanup.network = 'restored-4g-lte-good';
      } catch {
        result.cleanup.network = 'restore-failed';
      }
      try {
        await client.command(`session/${result.sessionId}`, 'DELETE', undefined, {
          timeout: Math.max(1, cleanupDeadline - Date.now()),
          signal: cleanupSignal,
        });
        result.cleanup.session = 'deleted';
        result.uncertainAllocation = false;
      } catch {
        result.cleanup.session = 'delete-failed';
      }
    }
    try {
      await fixture.close();
      result.cleanup.fixture = 'closed';
    } catch {
      result.cleanup.fixture = 'close-failed';
    }
    if (
      result.cleanup.session !== 'deleted' ||
      result.cleanup.network !== 'restored-4g-lte-good' ||
      result.cleanup.fixture !== 'closed'
    ) {
      result.status = 'failed';
      result.failure ??= 'capability-cleanup-failed';
    }
    result.finishedAt = new Date().toISOString();
    await options.journal(result);
  }
  return result;
}

type Journal = ReservationIdentity & {
  schemaVersion: 1;
  scope: string;
  allocationPlan: 'two-lane-chrome-safari-remediation';
  status: 'prepared' | 'running' | 'passed' | 'failed' | 'incomplete';
  stage: string;
  reservationId: string;
  receipt: ReservationReceipt;
  lanes: CapabilityResult[];
  failure?: string;
};
export function preparedCapabilityJournal(
  identity: ReservationIdentity,
  reservation: Reservation,
  now = Date.now(),
): Journal {
  return {
    schemaVersion: 1,
    ...identity,
    scope:
      'Two-lane Chrome/Safari capability remediation with the unchanged 900-second reservation. All three required lanes remain reported; Firefox is explicitly blocked by prior evidence. This is not full-matrix acceptance.',
    allocationPlan: 'two-lane-chrome-safari-remediation',
    status: 'prepared',
    stage: 'before-device-execution',
    reservationId: reservation.id,
    receipt: {
      ...identity,
      finishedAt: new Date(now).toISOString(),
      sessionIds: [],
      uncertainAllocation: false,
    },
    lanes: [],
  };
}
export function readPreparedCapabilityJournal(
  value: unknown,
  identity: ReservationIdentity,
  reservation: Reservation,
  now = Date.now(),
): Journal {
  const journal = row(value);
  const receipt = row(journal.receipt);
  requireCondition(
    journal.schemaVersion === 1 &&
      journal.allocationPlan === 'two-lane-chrome-safari-remediation' &&
      journal.status === 'prepared' &&
      journal.stage === 'before-device-execution' &&
      journal.reservationId === reservation.id &&
      Array.isArray(journal.lanes) &&
      journal.lanes.length === 0,
    'journal-already-used',
  );
  requireCondition(
    receipt.uncertainAllocation === false &&
      Array.isArray(receipt.sessionIds) &&
      receipt.sessionIds.length === 0,
    'journal-already-used',
  );
  requireCondition(
    Object.keys(receipt).sort().join(',') ===
      [
        'runId',
        'attempt',
        'sourceSha',
        'testedSha',
        'finishedAt',
        'sessionIds',
        'uncertainAllocation',
      ]
        .sort()
        .join(','),
    'journal-invalid',
  );
  requireCondition(
    typeof receipt.finishedAt === 'string' &&
      new Date(Date.parse(receipt.finishedAt)).toISOString() === receipt.finishedAt &&
      Date.parse(receipt.finishedAt) >= Date.parse(reservation.reservedAt) &&
      Date.parse(receipt.finishedAt) <= now,
    'journal-invalid',
  );
  for (const key of ['runId', 'attempt', 'sourceSha', 'testedSha'] as const)
    requireCondition(
      journal[key] === identity[key] && receipt[key] === identity[key],
      'journal-identity-mismatch',
    );
  return journal as Journal;
}
function identityFromEnvironment(): ReservationIdentity {
  return {
    runId: process.env.GITHUB_RUN_ID ?? '',
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? '',
    sourceSha: process.env.SOURCE_SHA ?? '',
    testedSha: process.env.GITHUB_SHA ?? '',
  };
}
async function main() {
  const mode = process.argv[2];
  requireCondition(mode === 'prepare' || mode === 'run', 'invalid-mode');
  const identity = identityFromEnvironment();
  const manifest = JSON.parse(
    await readFile('artifacts/browserstack-admission.json', 'utf8'),
  ) as unknown;
  const ledger = ledgerClient({
    repository: process.env.GITHUB_REPOSITORY ?? '',
    token: process.env.GITHUB_TOKEN ?? '',
  });
  await withCapabilityAdmission(
    manifest,
    identity,
    async () => (await ledger.read()).value,
    async (reservation) => {
      await mkdir('artifacts', { recursive: true });
      if (mode === 'prepare') {
        const journal = preparedCapabilityJournal(identity, reservation);
        await writeFile(reportPath, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx' });
        return;
      }
      const lock = await open('artifacts/browserstack-capability.lock', 'wx');
      await lock.close(); // Never remove this replay guard during this job.
      const journal = readPreparedCapabilityJournal(
        JSON.parse(await readFile(reportPath, 'utf8')),
        identity,
        reservation,
      );
      const persist = async () => {
        journal.receipt = {
          ...identity,
          finishedAt: new Date().toISOString(),
          sessionIds: journal.lanes.flatMap((lane) => (lane.sessionId ? [lane.sessionId] : [])),
          uncertainAllocation: journal.lanes.some((lane) => lane.uncertainAllocation),
        };
        await writeFile(`${reportPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`);
        await rename(`${reportPath}.tmp`, reportPath);
      };
      journal.stage = 'device-execution';
      journal.status = 'running';
      await persist();
      const directory = await mkdtemp(join(tmpdir(), 'spinel-browserstack-capability-'));
      try {
        const localIdentifier = process.env.BROWSERSTACK_LOCAL_IDENTIFIER ?? '';
        requireCondition(Boolean(localIdentifier), 'missing-local-identifier');
        const client = clientFor(process.env.BS_USERNAME ?? '', process.env.BS_ACCESS_KEY ?? '');
        const targets = targetsFromInventory(
          await client.api('browsers.json', 'GET', undefined, { timeout: 15_000 }),
        );
        await mkdir('artifacts/browserstack-capability', { recursive: true });
        for (const target of targets) {
          const index = journal.lanes.length;
          journal.lanes[index] = await runCapabilityLane(target, async () => {
            let fixture: BrowserstackFixture;
            try {
              fixture = await createBrowserstackFixture(directory);
            } catch {
              return {
                target,
                status: 'failed',
                startedAt: null,
                stage: 'fixture-startup',
                command: 'not-run',
                allocation: 'not-started',
                uncertainAllocation: false,
                failure: 'capability-fixture-startup-failed',
                observations: [],
                nativeActions: [],
                screenshots: [],
                cleanup: {
                  network: 'not-allocated',
                  session: 'not-allocated',
                  fixture: 'startup-failed',
                },
              };
            }
            return runCapability(client, target, fixture, {
              localIdentifier,
              buildName: `SPN-090 Chrome/Safari remediation ${identity.runId}-${identity.attempt}`,
              journal: async (lane) => {
                journal.lanes[index] = lane;
                await persist();
              },
              screenshot: async (name, data) => {
                const path = `artifacts/browserstack-capability/${name}.png`;
                await writeFile(path, Buffer.from(data, 'base64'));
                return path;
              },
            });
          });
          await persist();
        }
        journal.stage = 'finished';
        journal.status = capabilityOutcome(journal.lanes);
        if (journal.status !== 'passed') process.exitCode = 1;
      } catch (error) {
        journal.failure = failure(error);
        journal.stage = 'failed';
        journal.status = 'failed';
        process.exitCode = 1;
      } finally {
        await rm(directory, { recursive: true, force: true });
        await persist();
      }
    },
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch((error) => {
    console.error(failure(error));
    process.exitCode = 1;
  });
