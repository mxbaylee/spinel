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
import { observeChromeReadinessFailure } from './browserstack-chrome-readiness.ts';
import {
  capabilityScopeDefinition,
  readCapabilityScope,
  type CapabilityScope,
} from './browserstack-scope.ts';
export { readCapabilityScope, type CapabilityScope } from './browserstack-scope.ts';
import { countOfflineImagePixels, offlineImagesPainted } from './offline-image-pixels.ts';
import type { PhoneAcceptanceCases, PhoneAcceptanceDriver } from './browserstack-acceptance.ts';
import { prepareDashboardItemOffline } from './browserstack-offline-preparation.ts';
import { ledgerClient } from './browserstack-ledger.ts';
import {
  clientFor,
  cleanProviderText as clean,
  targetsFromInventory,
  webdriverErrorCode,
  type Target,
} from './browserstack.ts';
import {
  createNativeTap,
  installMenuLabel,
  installConfirmationLabels,
  openNativeShare,
  type NativeAction,
} from './browserstack-native-controls.ts';
export {
  installCandidateDiagnostics,
  installMenuLabel,
  installConfirmationLabels,
  matchingNativeConfirmation,
  matchingNativeControl,
  matchingSafariHomeScreen,
  nativeControls,
  openNativeShare,
  type NativeControl,
} from './browserstack-native-controls.ts';

type Row = Record<string, unknown>;
type Client = ReturnType<typeof clientFor>;
type Fixture = Pick<
  BrowserstackFixture,
  'origin' | 'loginURL' | 'actor' | 'items' | 'imageRows' | 'certificate' | 'close'
>;
function requireAcceptanceFixture(fixture: Fixture): asserts fixture is BrowserstackFixture {
  const value = fixture as Partial<BrowserstackFixture>;
  requireCondition(
    value.db &&
      typeof value.db.prepare === 'function' &&
      typeof value.owner?.id === 'string' &&
      [
        'read',
        'originalState',
        'recoveryMetadata',
        'remoteEdit',
        'setOffline',
        'verifyDisconnected',
      ].every((key) => typeof (value as Row)[key] === 'function'),
    'acceptance-fixture-unavailable',
  );
}
const laneMilliseconds = 180_000;
const authoredAcceptanceMilliseconds = 780_000;
const authoredPrerequisiteMilliseconds = 240_000;
const cleanupMilliseconds = 15_000;
const reportPath = 'artifacts/browserstack-capability.json';
const sessionPattern = /^[a-f0-9]{40}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-response-shape');
  return value as Row;
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
      // A late response can win the race with an abort timer. Keep this
      // observation's deadline independent of the wider lane/phase budget.
      if (Date.now() >= deadline) break;
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

/** Diagnose response shape without copying screenshot content or arbitrary provider fields. */
export function screenshotResponseShape(value: unknown): {
  type: string;
  length?: number;
  keyCount?: number;
  sampledCharacters?: number;
  sampleBase64Alphabet?: boolean;
  sampleHasWhitespace?: boolean;
  dataURLPrefix?: boolean;
} {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (typeof value === 'string') {
    const sample = value.slice(0, 1024);
    return {
      type,
      length: value.length,
      sampledCharacters: sample.length,
      sampleBase64Alphabet: /^[A-Za-z0-9+/=]+$/.test(sample),
      sampleHasWhitespace: /\s/.test(sample),
      dataURLPrefix: /^data:/i.test(sample),
    };
  }
  return {
    type,
    ...(Array.isArray(value) ? { length: value.length } : {}),
    ...(value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { keyCount: Object.keys(value).length }
      : {}),
  };
}
export const screenshotLimits = { rawCharacters: 15_000_000, decodedBytes: 10_000_000 } as const;
/** CR/LF wrapping is the only permitted transformation; never repair malformed image data. */
export function normalizedPngScreenshot(value: unknown): string {
  requireCondition(
    typeof value === 'string' && value.length > 0 && value.length <= screenshotLimits.rawCharacters,
    'screenshot-invalid',
  );
  const normalized = value.replace(/[\r\n]/g, '');
  requireCondition(
    normalized.length > 0 &&
      normalized.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(normalized),
    'screenshot-invalid',
  );
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const bytes = (normalized.length / 4) * 3 - padding;
  requireCondition(bytes >= 45 && bytes <= screenshotLimits.decodedBytes, 'screenshot-invalid');
  const decoded = Buffer.from(normalized, 'base64');
  requireCondition(
    decoded.length === bytes &&
      decoded.toString('base64') === normalized &&
      decoded.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      decoded.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex')),
    'screenshot-invalid',
  );
  return normalized;
}

/** Required acceptance evidence must be captured, decoded and saved successfully. */
export async function captureRequiredPngScreenshot(
  read: (timeout: number) => Promise<unknown>,
  save: (normalized: string) => Promise<string>,
  deadline = Date.now() + 15_000,
) {
  const remaining = () => {
    const left = deadline - Date.now();
    requireCondition(Number.isFinite(left) && left > 0, 'screenshot-deadline');
    return left;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const allotted = remaining();
  const capture = async () => {
    const normalized = normalizedPngScreenshot(await read(allotted));
    remaining();
    const bytes = Buffer.from(normalized, 'base64');
    const sharp = (await import('sharp')).default;
    remaining();
    const decoded = await sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch(() => {
        throw new Error('capability-screenshot-decode-failed');
      });
    remaining();
    const file = await save(normalized);
    remaining();
    requireCondition(typeof file === 'string' && file.length > 0, 'screenshot-save-failed');
    return {
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      raster: {
        data: decoded.data,
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
      },
    };
  };
  try {
    return await Promise.race([
      capture(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('capability-screenshot-deadline')), allotted);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function elementId(value: unknown): string {
  const element = row(value);
  const id = element['element-6066-11e4-a52e-4f735466cecf'] ?? element.ELEMENT;
  requireCondition(typeof id === 'string' && /^[\w:.-]{1,200}$/.test(id), 'element-id-invalid');
  return id;
}
type Observation = { stage: string; value: unknown };
type CapabilityTiming = {
  laneLimitMilliseconds: number;
  stages: {
    stage: string;
    startedElapsedMilliseconds: number;
    durationMilliseconds: number | null;
  }[];
  commands: {
    stage: string;
    command: string;
    startedElapsedMilliseconds: number;
    durationMilliseconds: number | null;
    timeoutMilliseconds: number;
    remainingAtStartMilliseconds: number;
    remainingAtEndMilliseconds?: number;
    outcome: 'running' | 'completed' | 'failed';
    failure?: string;
    webdriverErrorCode?: string;
    laneAborted?: boolean;
    commandAborted?: boolean;
    deadlineReached?: boolean;
  }[];
  omittedCommands: number;
  omittedStages: number;
  failure?: {
    elapsedMilliseconds: number;
    remainingMilliseconds: number;
    laneAborted: boolean;
    deadlineReached: boolean;
  };
  cleanupElapsedMilliseconds?: number;
  totalElapsedMilliseconds?: number;
};
export type CapabilityResult = {
  target: Target;
  status: 'passed' | 'failed' | 'blocked' | 'not-run';
  startedAt: string | null;
  finishedAt?: string;
  stage: string;
  command: string;
  sessionId?: string;
  allocation: 'not-started' | 'uncertain' | 'known';
  uncertainAllocation: boolean;
  failure?: string;
  observations: Observation[];
  nativeActions: (NativeAction & { stage: string })[];
  timing?: CapabilityTiming;
  screenshots: string[];
  cleanup: { network: string; session: string; fixture: string };
};
function notRunLane(target: Target, stage: string, reason: string): CapabilityResult {
  return {
    target,
    status: 'not-run',
    startedAt: null,
    stage,
    command: 'not-run',
    allocation: 'not-started',
    uncertainAllocation: false,
    observations: [{ stage, value: { reason, currentRunAcceptance: 'not-assessed' } }],
    nativeActions: [],
    screenshots: [],
    cleanup: { network: 'not-allocated', session: 'not-allocated', fixture: 'not-created' },
  };
}
/** A maintained blocker is evidence, not a successful or silently skipped lane. */
export async function runCapabilityLane(
  target: Target,
  execute: () => Promise<CapabilityResult>,
  scope: CapabilityScope = 'all',
): Promise<CapabilityResult> {
  readCapabilityScope(scope);
  const selection = capabilityScopeDefinition(scope);
  if (selection.browser && target.browser !== selection.browser && target.browser !== 'firefox')
    return notRunLane(
      target,
      `${scope}-only`,
      `This ${target.browser} lane is not selected by ${scope}. Historical results are not current-source acceptance.`,
    );
  if (selection.context === 'ordinary-tab' && target.browser !== selection.browser)
    return notRunLane(
      target,
      `${scope}-only`,
      `Only the selected ordinary-tab browser is executed. This ${target.browser} lane has no allocation or current-source acceptance.`,
    );
  if (target.browser !== 'firefox' || selection.context === 'ordinary-tab') return execute();
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
          classification: 'observed-provider-route-limitation',
          underlyingCause: 'unclassified',
          reason:
            'The recorded real Android Firefox Automate session rejected its native-context command with HTTP 400. Native launcher control remains unobserved through this route; the response does not establish a general Firefox or BrowserStack limitation. This scope does not repeat the unchanged allocation.',
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
            'Revisit when concrete public BrowserStack Automate evidence establishes a supported native Firefox control route. Keep this route limitation and unobserved product coverage visible alongside successful supported-scope results.',
        },
      },
    ],
  };
}
type CapabilityOutcome = 'passed' | 'failed' | 'incomplete';
function completeLaneSet(lanes: CapabilityResult[]) {
  return (
    lanes.length === 3 &&
    ['chrome', 'firefox', 'safari'].every(
      (browser) => lanes.filter((lane) => lane?.target?.browser === browser).length === 1,
    ) &&
    lanes.every((lane) => ['passed', 'failed', 'blocked', 'not-run'].includes(lane.status))
  );
}
function failedLane(lane: CapabilityResult) {
  return (
    lane.status === 'failed' ||
    (lane.status === 'passed' &&
      (lane.failure !== undefined ||
        typeof lane.startedAt !== 'string' ||
        !Number.isFinite(Date.parse(lane.startedAt)) ||
        typeof lane.finishedAt !== 'string' ||
        !Number.isFinite(Date.parse(lane.finishedAt)) ||
        lane.allocation !== 'known' ||
        !sessionPattern.test(lane.sessionId ?? '') ||
        lane.uncertainAllocation !== false ||
        lane.cleanup?.network !== 'restored-4g-lte-good' ||
        lane.cleanup?.session !== 'deleted' ||
        lane.cleanup?.fixture !== 'closed'))
  );
}
/** This remains the complete three-browser result, regardless of requested scope. */
export function capabilityOutcome(lanes: CapabilityResult[]): CapabilityOutcome {
  if (!completeLaneSet(lanes)) return 'incomplete';
  if (lanes.some((lane) => lane.status === 'not-run')) return 'incomplete';
  if (lanes.some(failedLane)) return 'failed';
  if (lanes.some((lane) => lane.status === 'blocked')) return 'incomplete';
  return 'passed';
}
/** The CLI may pass a completed selected scope without claiming full-matrix coverage. */
export function capabilityRunOutcome(
  lanes: CapabilityResult[],
  scope: CapabilityScope = 'all',
): { status: CapabilityOutcome; fullMatrixStatus: CapabilityOutcome; exitCode: 0 | 1 } {
  readCapabilityScope(scope);
  const fullMatrixStatus = capabilityOutcome(lanes);
  let status = fullMatrixStatus;
  if (scope !== 'all' && completeLaneSet(lanes)) {
    const selection = capabilityScopeDefinition(scope);
    const selected = lanes.find((lane) => lane.target.browser === selection.browser)!;
    status =
      lanes.some(failedLane) ||
      (selected.status === 'passed' && selected.stage !== selection.completionStage)
        ? 'failed'
        : selected.status === 'passed'
          ? 'passed'
          : 'incomplete';
  }
  return { status, fullMatrixStatus, exitCode: status === 'passed' ? 0 : 1 };
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
  windowRelation?: string,
) {
  requireCondition(environment.origin === browserstackOrigin, 'launched-origin-mismatch');
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
  // WebKit 239951@main documents SafariViewService as the shared UIProcess
  // for iOS Home Screen web apps. Accept only this exact host pair, with a
  // newly observed window; the origin, browser and standalone gates still apply.
  // https://github.com/WebKit/WebKit/commit/f8247a6613c1a7ca1720888348231b88b057b613
  const homeScreenUIProcess =
    target.browser === 'safari' &&
    foreground === 'com.apple.webapp' &&
    bundleId === 'com.apple.SafariViewService' &&
    windowRelation === 'new-after-native-launch';
  requireCondition(
    bundleId === undefined || bundleId === null || bundleId === foreground || homeScreenUIProcess,
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
    contextAssociation: homeScreenUIProcess
      ? 'webkit-home-screen-ui-process'
      : bundleId == null
        ? 'bundle-not-exposed'
        : 'same-native-app',
  };
}
export function launchEnvironmentDiagnostic(environment: Row) {
  return Object.fromEntries([
    ...['origin', 'path', 'title', 'userAgent', 'controller'].map((key) => [
      key,
      typeof environment[key] === 'string' ? clean(environment[key]) : null,
    ]),
    ...[
      'secureContext',
      'serviceWorkerAvailable',
      'standalone',
      'navigatorStandalone',
      'online',
      'anonymousReady',
      'invalidCertificate',
    ].map((key) => [key, typeof environment[key] === 'boolean' ? environment[key] : null]),
  ]);
}
type CapabilityOptions = {
  scope?: CapabilityScope;
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
  anonymousReady: (document.body?.innerText || '').includes('Your workspace.') &&
    [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Sign in with a passkey' && !button.disabled),
  invalidCertificate: /certificate|not private|not secure/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0, 3000))
};`;
function verifyBrowserIdentity(target: Target, environment: Row) {
  const expected = {
    chrome: /Android.*Chrome\//,
    firefox: /Android.*Gecko\/.*Firefox\//,
    safari: /iPhone.*Version\/.*Safari\//,
  }[target.browser];
  const userAgent = String(environment.userAgent);
  requireCondition(
    expected.test(userAgent) &&
      !(target.browser !== 'safari' && /SamsungBrowser\/|EdgA\/|OPR\//.test(userAgent)) &&
      !(target.browser === 'firefox' && /Chrome\//.test(userAgent)),
    'unexpected-browser',
  );
}
export function verifyOrdinaryTabContext(target: Target, environment: unknown) {
  const value = row(environment);
  verifyBrowserIdentity(target, value);
  requireCondition(
    value.origin === browserstackOrigin &&
      value.secureContext === true &&
      value.controller === `${browserstackOrigin}/service-worker.js` &&
      value.standalone === false &&
      value.navigatorStandalone === false,
    'ordinary-tab-context-invalid',
  );
}
export const ordinaryTabReloadMarkerScript = `
if (location.origin !== arguments[0]) return false;
const key=Symbol.for('spinel.capability.page-lifetime');
if (Object.hasOwn(globalThis,key)) return false;
Object.defineProperty(globalThis,key,{value:arguments[1],configurable:true});
return true;`;
export const ordinaryTabReloadObservationScript = `return {
  origin:location.origin, href:location.href, readyState:document.readyState,
  oldDocumentMarkerPresent:Object.hasOwn(globalThis,Symbol.for('spinel.capability.page-lifetime')),
  standalone:matchMedia('(display-mode: standalone)').matches,
  navigatorStandalone:navigator.standalone === true
};`;

/** A page reload in one actual tab, never an OS/browser-process restart. */
export async function reloadOrdinaryTab(
  command: (suffix: string, method: string, body: unknown, timeout: number) => Promise<unknown>,
  options: { origin: string; windowHandle: unknown; deadline: number },
) {
  requireCondition(
    options.origin === browserstackOrigin &&
      typeof options.windowHandle === 'string' &&
      /^[\w:.-]{1,200}$/.test(options.windowHandle),
    'ordinary-tab-reload-input-invalid',
  );
  const until = Math.min(options.deadline, Date.now() + 15_000);
  const send = async (suffix: string, method = 'GET', body?: unknown) => {
    const left = until - Date.now();
    requireCondition(left > 0, 'ordinary-tab-reload-deadline');
    const value = await command(suffix, method, body, left);
    requireCondition(Date.now() < until, 'ordinary-tab-reload-deadline');
    return value;
  };
  requireCondition((await send('window')) === options.windowHandle, 'ordinary-tab-window-changed');
  const before = await send('url');
  let safeURL = false;
  if (typeof before === 'string' && before.length <= 4096) {
    try {
      const url = new URL(before);
      safeURL = url.origin === options.origin && !url.username && !url.password;
    } catch {
      // The observed URL is a precondition, never a navigation destination.
    }
  }
  requireCondition(safeURL, 'ordinary-tab-origin-changed');
  requireCondition(
    (await send('execute/sync', 'POST', {
      script: ordinaryTabReloadMarkerScript,
      args: [options.origin, randomUUID()],
    })) === true,
    'ordinary-tab-marker-unavailable',
  );
  // One normal WebDriver refresh. An uncertain command is never replayed.
  await send('refresh', 'POST', {});
  requireCondition((await send('window')) === options.windowHandle, 'ordinary-tab-window-changed');
  requireCondition((await send('url')) === before, 'ordinary-tab-url-changed');
  const after = row(
    await send('execute/sync', 'POST', {
      script: ordinaryTabReloadObservationScript,
      args: [],
    }),
  );
  requireCondition(
    after.origin === options.origin &&
      after.href === before &&
      ['interactive', 'complete'].includes(String(after.readyState)) &&
      after.oldDocumentMarkerPresent === false &&
      after.standalone === false &&
      after.navigatorStandalone === false,
    'ordinary-tab-document-not-replaced',
  );
  return {
    operation: 'webdriver-refresh',
    sameWindow: true,
    exactURLRetained: true,
    oldDocumentDiscarded: true,
    browserStorageCopied: false,
    nativeAppTerminationObserved: false,
    nativeProcessRestartOwner: 'scripts/ci/desktop-offline.ts',
  };
}
/** Every execute result is checked, including `mobile:` commands; BrowserStack's hub answers its own executor commands. */
export function checksAppiumEnvelope(path: string, body: unknown): boolean {
  const script = (body as Row | undefined)?.script;
  return (
    /\/execute\/(sync|async)$/.test(path) &&
    !(typeof script === 'string' && script.startsWith('browserstack_executor:'))
  );
}

// Appium 1.x reads every command result as a possible legacy envelope. (Its
// L319-L324 `protocol` unwrap applies only to Appium's own {protocol, value}
// wrapper, so a script's own `protocol` key passes through.) A top-level `status`
// that is not numerically 0 throws UnknownError, which turned a
// ready document with an empty save status into HTTP 500 (Android Chrome run
// 41395124342); so does a top-level `value` object with a truthy `error`:
// https://github.com/appium/appium-base-driver/blob/v5.3.1/lib/protocol/protocol.js#L355-L358
// Synchronous scripts return none of these keys. Asynchronous results arrive wrapped as
// {ok, value} or {phase, value}. UiAutomator2 keeps Chrome's execute/sync local and
// proxies execute/async past these checks (its webview no-proxy list:
// https://github.com/appium/appium-uiautomator2-driver/blob/v1.44.2/lib/driver.js#L98-L111),
// but the same rule is applied so Safari and future drivers are safe. On Chrome that is
// stricter than Appium: an async result whose top-level `value` carries a truthy
// `error` fails as the envelope rule rather than its own reason. It never passes.
/** Which Appium 1.x envelope check would throw on this script result, if any. */
export function appiumEnvelopeHazard(value: unknown): 'status' | 'value-error' | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Row;
  if (
    result.status !== undefined &&
    result.status !== null &&
    !isNaN(result.status as number) &&
    parseInt(String(result.status), 10) !== 0
  )
    return 'status';
  const inner = result.value;
  return inner !== null &&
    typeof inner === 'object' &&
    !Array.isArray(inner) &&
    (inner as Row).error
    ? 'value-error'
    : null;
}
export const itemReadinessScript = `
const observation = {
  phase: 'document',
  readyState: ['loading','interactive','complete'].includes(document.readyState) ? document.readyState : 'unknown',
  bodyPresent: Boolean(document.body), originMatch: location.origin === arguments[0], documentReady: false
};
if (!observation.bodyPresent || !observation.originMatch || observation.readyState === 'loading') return observation;
if (observation.readyState === 'unknown') return {...observation, failure:'document-state-unavailable'};
observation.documentReady = true;
let phase = 'dom';
try {
  const saveStatus = document.querySelector('[aria-label="Save status"]')?.textContent || '';
  const canvasHeight = Math.max(0,...[...document.querySelectorAll('.univer-container canvas')].map(canvas=>canvas.getBoundingClientRect().height));
  const phoneReadOnly = document.body.innerText.includes('View only on this phone. Edit on a larger screen.');
  phase = 'storage';
  const account = localStorage.getItem('spinel.offline.account');
  return {...observation, phase:'editor', saveStatus, canvasHeight, phoneReadOnly, account};
} catch (error) {
  const errorName = ['SecurityError','TypeError','InvalidStateError','NotSupportedError','QuotaExceededError'].includes(error?.name) ? error.name : 'unknown';
  return {...observation, phase, failure:phase === 'storage' ? 'storage-unavailable' : 'dom-observation-failed', errorName};
}`;
export function itemReadinessSatisfied(value: Row, offline: boolean) {
  return (
    value.failure === undefined &&
    value.documentReady === true &&
    Number(value.canvasHeight) > 100 &&
    (value.phoneReadOnly === true ||
      String(value.saveStatus).includes(offline ? 'Saved on this device' : 'All changes saved.') ||
      (!offline && String(value.saveStatus).includes('Synced.')))
  );
}

/** Observe public installation resources without preparing or writing any cache.
 * The caller has already proved the device's uncached HTTP/socket outage. Reload
 * bypasses incidental HTTP cache; only the product's retained runtime can answer.
 */
export const installationAssetsScript = `
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 6000);
let phase = 'manifest';
const read = async (path, type, maximum) => {
  const response = await fetch(path, {cache:'reload',credentials:'omit',redirect:'error',signal:controller.signal});
  if (!response.ok || response.redirected || response.url !== location.origin + path ||
      response.headers.get('Content-Type')?.split(';')[0].trim() !== type || !response.body) throw new Error('resource');
  const reader = response.body.getReader(); const chunks=[]; let size=0;
  try {
    for (;;) {
      controller.signal.throwIfAborted();
      const part = await reader.read(); if(part.done)break;
      size += part.value.byteLength; if(size>maximum)throw new Error('size'); chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  if(!size)throw new Error('empty');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
};
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
try {
  const bytes=await read('/manifest.webmanifest','application/manifest+json',16384);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(manifest.id!=='/' || manifest.start_url!=='/' || manifest.scope!=='/' || manifest.name!=='Spinel' ||
      manifest.short_name!=='Spinel' || manifest.display!=='standalone' || !Array.isArray(manifest.icons) || manifest.icons.length!==2)throw new Error('manifest');
  for(const size of [192,512]){
    const icons=manifest.icons.filter(icon=>icon.src==='/app-icon-'+size+'.png' && icon.sizes===size+'x'+size && icon.type==='image/png' && icon.purpose==='any maskable');
    if(icons.length!==1)throw new Error('manifest');
  }
  phase='icons';
  const icons=await Promise.all([180,192,512].map(async size=>{
    const path='/app-icon-'+size+'.png';const bytes=await read(path,'image/png',100000);
    if([137,80,78,71,13,10,26,10].some((byte,index)=>bytes[index]!==byte))throw new Error('png');
    const blobURL=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
    let decodeTimer;
    try {
      const icon=new Image();icon.src=blobURL;
      await Promise.race([icon.decode(),new Promise((_,reject)=>{decodeTimer=setTimeout(()=>reject(new Error('decode')),2000);})]);
      if(icon.naturalWidth!==size || icon.naturalHeight!==size)throw new Error('dimensions');
      return {path,bytes:bytes.byteLength,width:icon.naturalWidth,height:icon.naturalHeight,sha256:await digest(bytes)};
    } finally {clearTimeout(decodeTimer);URL.revokeObjectURL(blobURL);}
  }));
  return {ok:true,manifest:{path:'/manifest.webmanifest',bytes:bytes.byteLength,sha256:await digest(bytes)},icons};
} catch {return {ok:false,phase};}
finally {clearTimeout(timer);controller.abort();}
`;

export function verifyInstallationAssets(value: unknown) {
  const observed = row(value);
  const validDigest = (entry: Row, maximum: number) =>
    Number.isInteger(entry.bytes) &&
    Number(entry.bytes) > 0 &&
    Number(entry.bytes) <= maximum &&
    typeof entry.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(entry.sha256);
  requireCondition(observed.ok === true, 'offline-installation-assets-unavailable');
  const manifest = row(observed.manifest);
  requireCondition(
    manifest.path === '/manifest.webmanifest' && validDigest(manifest, 16_384),
    'offline-installation-manifest-invalid',
  );
  requireCondition(
    Array.isArray(observed.icons) && observed.icons.length === 3,
    'offline-installation-icons-invalid',
  );
  const icons = observed.icons.map(row);
  for (const size of [180, 192, 512])
    requireCondition(
      icons.filter(
        (icon) =>
          icon.path === `/app-icon-${size}.png` &&
          icon.width === size &&
          icon.height === size &&
          validDigest(icon, 100_000),
      ).length === 1,
      'offline-installation-icons-invalid',
    );
}

export const chromeItemNavigationScript = `
const [origin, previousURL, itemURL] = arguments;
if (location.origin !== origin || location.href !== previousURL) return false;
location.assign(itemURL);
return true;`;
type NavigationCommand = (
  suffix: 'window' | 'url' | 'execute/sync',
  method: 'GET' | 'POST',
  body: unknown,
  timeout: number,
) => Promise<unknown>;
/** Candidate experiment: one in-window navigation, followed only by bounded reads.
 * https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-assign
 * https://www.w3.org/TR/webdriver2/#get-window-handle
 * https://www.w3.org/TR/webdriver2/#get-current-url
 */
export async function navigateChromeItem(
  command: NavigationCommand,
  options: {
    origin: string;
    itemId: string;
    windowHandle: unknown;
    previousURL?: string;
    deadline: number;
  },
  diagnostic: Row,
): Promise<string> {
  Object.assign(diagnostic, {
    operation: 'chrome-item-navigation-experiment',
    transport: 'location.assign',
    phase: 'before',
    assignmentAttempted: false,
    assignmentAcknowledged: false,
    reads: 0,
  });
  requireCondition(
    options.origin === browserstackOrigin &&
      /^[\w-]{1,200}$/.test(options.itemId) &&
      typeof options.windowHandle === 'string' &&
      /^[\w:.-]{1,200}$/.test(options.windowHandle),
    'item-navigation-input-invalid',
  );
  const itemURL = `${options.origin}/?item=${options.itemId}`;
  const until = Math.min(options.deadline, Date.now() + 15_000);
  const send = async (
    suffix: 'window' | 'url' | 'execute/sync',
    method: 'GET' | 'POST',
    body?: unknown,
  ) => {
    const left = until - Date.now();
    requireCondition(left > 0, 'item-navigation-deadline');
    const value = await command(suffix, method, body, Math.min(15_000, left));
    requireCondition(Date.now() < until, 'item-navigation-deadline');
    return value;
  };
  const sameOrigin = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 4096) return false;
    try {
      const url = new URL(value);
      return url.origin === options.origin && !url.username && !url.password;
    } catch {
      return false;
    }
  };
  try {
    diagnostic.windowMatch = (await send('window', 'GET')) === options.windowHandle;
    requireCondition(diagnostic.windowMatch, 'item-navigation-window-changed');
    const before = await send('url', 'GET');
    diagnostic.originMatch = sameOrigin(before);
    diagnostic.previousItemMatch =
      options.previousURL === undefined ? null : before === options.previousURL;
    requireCondition(diagnostic.originMatch, 'item-navigation-origin-changed');
    requireCondition(
      diagnostic.previousItemMatch !== false,
      'item-navigation-previous-item-changed',
    );
    diagnostic.phase = 'assign';
    // The script repeats the URL/origin precondition immediately before its one
    // mutation. A command error is uncertain and is never retried.
    diagnostic.assignmentAttempted = true;
    const issued = await send('execute/sync', 'POST', {
      script: chromeItemNavigationScript,
      args: [options.origin, before, itemURL],
    });
    diagnostic.assignmentAcknowledged = issued === true;
    requireCondition(issued === true, 'item-navigation-precondition-changed');
    diagnostic.phase = 'after';
    for (;;) {
      diagnostic.reads = Number(diagnostic.reads) + 1;
      diagnostic.windowMatch = (await send('window', 'GET')) === options.windowHandle;
      requireCondition(diagnostic.windowMatch, 'item-navigation-window-changed');
      const after = await send('url', 'GET');
      diagnostic.originMatch = sameOrigin(after);
      diagnostic.itemURLMatch = after === itemURL;
      requireCondition(diagnostic.originMatch, 'item-navigation-origin-changed');
      if (diagnostic.itemURLMatch) {
        diagnostic.phase = 'verified';
        return itemURL;
      }
      requireCondition(after === before, 'item-navigation-unexpected-url');
      requireCondition(Date.now() < until, 'item-navigation-deadline');
      await new Promise((done) => setTimeout(done, Math.min(200, until - Date.now())));
    }
  } catch (error) {
    diagnostic.failure = failure(error);
    throw error;
  }
}

export async function runCapability(
  client: Client,
  target: Target,
  fixture: Fixture,
  options: CapabilityOptions,
): Promise<CapabilityResult> {
  const scope = options.scope ?? 'all';
  const selection = capabilityScopeDefinition(scope);
  const acceptanceScope = selection?.authored === true;
  const tabScope = selection?.context === 'ordinary-tab';
  const operationalMilliseconds = acceptanceScope
    ? authoredAcceptanceMilliseconds
    : laneMilliseconds;
  const began = Date.now();
  const timing: CapabilityTiming = {
    laneLimitMilliseconds: operationalMilliseconds,
    stages: [{ stage: 'preflight', startedElapsedMilliseconds: 0, durationMilliseconds: null }],
    commands: [],
    omittedCommands: 0,
    omittedStages: 0,
  };
  const result: CapabilityResult = {
    target,
    status: 'failed',
    startedAt: new Date(began).toISOString(),
    stage: 'preflight',
    command: '',
    allocation: 'not-started',
    uncertainAllocation: false,
    observations: [],
    nativeActions: [],
    screenshots: [],
    timing,
    cleanup: { network: 'not-allocated', session: 'not-allocated', fixture: 'pending' },
  };
  const deadline = began + operationalMilliseconds;
  const signal = AbortSignal.timeout(operationalMilliseconds);
  let phaseDeadline = acceptanceScope ? began + authoredPrerequisiteMilliseconds : deadline;
  let allocationCommandDeadline: number | undefined;
  const activeDeadline = () => Math.min(deadline, phaseDeadline);
  let previousWindowHandles: string[] = [];
  let currentItemURL: string | undefined;
  let chromeReadinessObserved = false;
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
  const stage = (name: string, maximumMilliseconds?: number) => {
    remaining(1);
    if (acceptanceScope) {
      if (maximumMilliseconds !== undefined) {
        requireCondition(
          Number.isSafeInteger(maximumMilliseconds) && maximumMilliseconds > 0,
          'phase-limit-invalid',
        );
        phaseDeadline = Math.min(deadline, Date.now() + maximumMilliseconds);
      }
    }
    const elapsed = Date.now() - began;
    const previous = timing.stages.at(-1)!;
    previous.durationMilliseconds = elapsed - previous.startedElapsedMilliseconds;
    if (timing.stages.length === 32) {
      timing.stages.shift();
      timing.omittedStages++;
    }
    timing.stages.push({
      stage: name,
      startedElapsedMilliseconds: elapsed,
      durationMilliseconds: null,
    });
    result.stage = name;
  };
  function remaining(maximum = 15_000) {
    const left = deadline - Date.now();
    requireCondition(left > 0 && !signal.aborted, 'lane-deadline');
    const phaseLeft = phaseDeadline - Date.now();
    requireCondition(phaseLeft > 0, 'phase-deadline');
    return Math.max(1, Math.min(maximum, left, phaseLeft));
  }
  async function timedProviderCommand(
    name: string,
    timeout: number,
    action: (options: { timeout: number; signal: AbortSignal }) => Promise<unknown>,
    allocationRequest = false,
  ) {
    result.command = name;
    const started = Date.now();
    const entry: CapabilityTiming['commands'][number] = {
      stage: result.stage,
      command: name,
      startedElapsedMilliseconds: started - began,
      durationMilliseconds: null,
      timeoutMilliseconds: Math.max(0, Math.min(timeout, deadline - started)),
      remainingAtStartMilliseconds: Math.max(0, deadline - started),
      outcome: 'running',
    };
    if (timing.commands.length === 512) {
      timing.commands.shift();
      timing.omittedCommands++;
    }
    timing.commands.push(entry);
    let commandSignal: AbortSignal | undefined;
    try {
      const allotted = remaining(timeout);
      entry.timeoutMilliseconds = allotted;
      if (allocationRequest) allocationCommandDeadline = started + allotted;
      commandSignal = AbortSignal.timeout(allotted);
      const value = await action({
        timeout: allotted,
        signal: AbortSignal.any([signal, commandSignal]),
      });
      // A late allocation response can contain the only known session ID.
      // Persist it first below, then reject the deadline and delete that session.
      if (!allocationRequest) {
        remaining(1);
        requireCondition(
          Date.now() < started + allotted && !commandSignal.aborted,
          'command-deadline',
        );
      }
      entry.outcome = 'completed';
      return value;
    } catch (error) {
      entry.outcome = 'failed';
      entry.failure = failure(error);
      const code = webdriverErrorCode(error);
      if (code) entry.webdriverErrorCode = code;
      entry.laneAborted = signal.aborted;
      entry.commandAborted = commandSignal?.aborted ?? false;
      entry.deadlineReached = Date.now() >= deadline;
      throw error;
    } finally {
      entry.durationMilliseconds = Date.now() - started;
      entry.remainingAtEndMilliseconds = Math.max(0, deadline - Date.now());
    }
  }
  const command = (
    path: string,
    method = 'GET',
    body?: unknown,
    timeout = path === 'session' ? 45_000 : 15_000,
  ) =>
    timedProviderCommand(
      `${method} ${path.replace(result.sessionId ?? '\0', '{sessionId}').replace(/\/element\/[^/]+(?=\/|$)/g, '/element/{elementId}')}`,
      timeout,
      (options) => client.command(path, method, body, options),
      path === 'session' && method === 'POST',
    ).then((value) => {
      // A result Appium 1.x would misread as an error fails here on every driver,
      // so a script regression surfaces in tests and on drivers that pass it through.
      // The reason names the rule that fired. An async body that itself carries a
      // top-level `error` reports this reason rather than its own; it fails closed
      // either way, as Appium would.
      if (checksAppiumEnvelope(path, body)) {
        const hazard = appiumEnvelopeHazard(value);
        requireCondition(!hazard, `appium-envelope-${hazard}`);
      }
      return value;
    });
  const session = (suffix: string) => `session/${result.sessionId}/${suffix}`;
  const execute = (script: string, args: unknown[] = [], timeout = 15_000) =>
    command(session('execute/sync'), 'POST', { script, args }, timeout);
  async function navigateItem(item: Fixture['items'][number], attached: Row, previousURL?: string) {
    const itemURL = `${fixture.origin}/?item=${item.id}`;
    if (target.browser !== 'chrome') {
      await command(session('url'), 'POST', { url: itemURL });
      return (currentItemURL = itemURL);
    }
    const diagnostic: Row = { kind: item.kind };
    // Buffer safe booleans and phases; final journaling preserves a failed
    // command without another persistence operation masking that failure.
    result.observations.push({ stage: `${result.stage}:item-navigation`, value: diagnostic });
    currentItemURL = await navigateChromeItem(
      (suffix, method, body, timeout) => command(session(suffix), method, body, timeout),
      {
        origin: fixture.origin,
        itemId: item.id,
        windowHandle: attached.windowHandle,
        previousURL,
        deadline: activeDeadline(),
      },
      diagnostic,
    );
    return currentItemURL;
  }
  const executeAsync = (body: string, args: unknown[] = [], operation = 'browser-observation') =>
    target.browser === 'safari'
      ? observeBrowserTask(execute, body, args, {
          operation,
          deadline: activeDeadline(),
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
    const until = Math.min(activeDeadline(), Date.now() + maximum);
    do {
      const value = await read();
      remaining(1);
      requireCondition(Date.now() < until, label);
      if (accepts(value)) return value;
      await new Promise((done) => setTimeout(done, 200));
    } while (Date.now() < until);
    throw new Error(`capability-${label}`);
  }
  async function screenshot(name: string) {
    let responseShape: ReturnType<typeof screenshotResponseShape> | undefined;
    try {
      const data = await command(session('screenshot'));
      responseShape = screenshotResponseShape(data);
      result.screenshots.push(
        await options.screenshot(`${target.browser}-${name}`, normalizedPngScreenshot(data)),
      );
    } catch (error) {
      result.observations.push({
        stage: result.stage,
        value: {
          screenshot: 'unavailable',
          failure: failure(error),
          ...(responseShape ? { responseShape } : {}),
        },
      });
    }
  }
  async function requiredScreenshot(
    name: string,
    captureDeadline = Date.now() + remaining(15_000),
  ) {
    const captured = await captureRequiredPngScreenshot(
      (timeout) => command(session('screenshot'), 'GET', undefined, timeout),
      (data) => options.screenshot(`${target.browser}-${name}`, data),
      captureDeadline,
    );
    remaining(1);
    if (!result.screenshots.includes(captured.file)) result.screenshots.push(captured.file);
    return captured;
  }
  async function visibleImages(name: string, kind: 'sheet' | 'doc') {
    let captures = 0;
    const imageDeadline = Date.now() + remaining(15_000);
    const painted = await poll(
      async () => {
        const captured = await requiredScreenshot(name, imageDeadline);
        captures++;
        return {
          file: captured.file,
          sha256: captured.sha256,
          width: captured.raster.width,
          height: captured.raster.height,
          colorPixelCounts: countOfflineImagePixels(captured.raster, kind),
        };
      },
      (value) => offlineImagesPainted(value.colorPixelCounts, kind),
      'image-pixels-unavailable',
      15_000,
    );
    // Appium captures the actual device screen, including OS chrome. Use the
    // controlled fixture palette, as desktop acceptance does; do not invent a
    // DOM-to-screen offset or substitute an offscreen canvas/model for pixels.
    return { ...painted, captures, source: 'actual-provider-screenshot' };
  }
  async function context(name: string) {
    await command(session('context'), 'POST', { name });
  }
  const { tap, waitForConfirmationTransition } = createNativeTap({
    readSource: () => command(session('source')),
    poll,
    click: async (selector) => {
      const elements = await command(session('elements'), 'POST', {
        using: 'xpath',
        value: selector,
      });
      requireCondition(Array.isArray(elements), 'native-elements-invalid');
      requireCondition(elements.length > 0, 'native-control-stale');
      requireCondition(elements.length === 1, 'native-control-ambiguous');
      await command(session(`element/${elementId(elements[0])}/click`), 'POST', {});
    },
    record: (value) => record(`${result.stage}:native-controls`, value),
    recordAction: async (action) => {
      result.nativeActions.push({ stage: result.stage, ...action });
      await options.journal(result);
    },
    redact: (value) => client.redact(value),
  });
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
        await record(`${result.stage}:context-candidate`, {
          contextId: clean(entry.id),
          contextBundleId: clean(entry.bundleId),
          nativeForeground: foregroundApp,
          windowHandle: selected.handle,
          windowRelation: selected.relation,
          environment: launchEnvironmentDiagnostic(environment),
        });
        if (environment.origin === fixture.origin) {
          const association = verifyLaunchedBrowser(
            target,
            foregroundApp,
            environment,
            entry.bundleId,
            selected.relation,
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
      launchMode: tabScope
        ? 'ordinary-browser-tab'
        : standalone
          ? 'standalone'
          : 'browser-shortcut',
    });
    if (tabScope) verifyOrdinaryTabContext(target, environment);
    else requireCondition(target.browser !== 'safari' || standalone, 'ios-launch-not-standalone');
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
  // Failure-only evidence keeps the stalled page's screenshot first and leaves
  // the command that failed as the lane's command.
  async function diagnose<T>(work: () => Promise<T>): Promise<T> {
    const failedCommand = result.command;
    try {
      await screenshot('download-stalled');
      return await work();
    } finally {
      result.command = failedCommand;
    }
  }
  async function clickWeb(selector: string, label: string, waitForControl = false) {
    const find = () =>
      execute(
        `const [selector,label] = arguments; const matches = [...document.querySelectorAll(selector)].filter(element =>
      (element.getAttribute('aria-label') || element.textContent.trim()) === label && element.getBoundingClientRect().height > 0 && !element.disabled);
      return matches.length === 1 ? matches[0] : null;`,
        [selector, label],
      );
    // Dashboard data can arrive after navigation. Observe readiness before one
    // click; never retry a click or reinterpret a stale/ambiguous target as success.
    const id = waitForControl
      ? await poll(find, (value) => value !== null, 'production-control-unavailable')
      : await find();
    requireCondition(id !== null, 'production-control-unavailable');
    await command(session(`element/${elementId(id)}/click`), 'POST', {});
  }
  async function itemReady(offline: boolean) {
    let last: Row | null = null;
    let reads = 0;
    try {
      return await poll(
        async () => {
          reads++;
          last = row(await execute(itemReadinessScript, [fixture.origin]));
          if (last.failure !== undefined) {
            const failureCodes: Record<string, string> = {
              'storage-unavailable': 'production-storage-unavailable',
              'dom-observation-failed': 'production-dom-observation-failed',
              'document-state-unavailable': 'production-document-state-unavailable',
            };
            throw new Error(
              `capability-${failureCodes[String(last.failure)] ?? 'production-observation-invalid'}`,
            );
          }
          return last;
        },
        (value) => itemReadinessSatisfied(value, offline),
        'production-item-not-ready',
      );
    } catch (error) {
      // Keep the operational failure primary. The existing final journal flush
      // persists this buffered diagnostic after cleanup, without an extra write.
      result.observations.push({
        stage: `${result.stage}:item-readiness-failure`,
        value: sanitize({
          operation: 'item-readiness',
          offline,
          reads,
          last:
            last &&
            Object.fromEntries(
              [
                'phase',
                'readyState',
                'bodyPresent',
                'originMatch',
                'documentReady',
                'failure',
                'errorName',
                'canvasHeight',
                'phoneReadOnly',
              ]
                .filter((key) => Object.hasOwn(last!, key))
                .map((key) => [key, last![key]]),
            ),
        }),
      });
      if (
        target.browser === 'chrome' &&
        !chromeReadinessObserved &&
        currentItemURL !== undefined &&
        failure(error) === 'http-500' &&
        webdriverErrorCode(error) === 'unknown error'
      ) {
        chromeReadinessObserved = true;
        const failedCommand = result.command;
        try {
          const diagnostic = await observeChromeReadinessFailure(execute, {
            expectedItemURL: currentItemURL,
            deadline,
          });
          result.observations.push({
            stage: `${result.stage}:chrome-readiness-document`,
            value: diagnostic,
          });
        } finally {
          // A distinct observation must not replace the command that failed.
          // The helper returns bounded diagnostics, never a new operational error.
          result.command = failedCommand;
        }
      }
      throw error;
    }
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
  async function restartInstalled(foregroundApp: string, prefix = '') {
    stage(`${prefix}same-session-termination`);
    const observedForeground = await foreground();
    requireCondition(observedForeground === foregroundApp, 'foreground-app-changed');
    const app =
      target.browser === 'safari'
        ? { bundleId: observedForeground }
        : { appId: observedForeground };
    await command(session('appium/device/terminate_app'), 'POST', app);
    const state = await command(session('appium/device/app_state'), 'POST', app);
    await record(`${prefix}terminated-app`, { appId: observedForeground, state });
    requireCondition(state === 1, 'termination-not-observed');
    stage(`${prefix}offline-home-relaunch`);
    await home();
    await launchIcon();
    const relaunchedForeground = await foreground();
    requireCondition(relaunchedForeground === foregroundApp, 'relaunch-foreground-changed');
    const relaunched = await attach(relaunchedForeground);
    await recordLaunch(`${prefix}offline-relaunched-context`, relaunched);
    await secureEnvironment();
    await transportProbe(false);
    const installationAssets = await executeAsync(
      installationAssetsScript,
      [],
      'offline-installation-assets',
    );
    verifyInstallationAssets(installationAssets);
    await record(`${prefix}offline-installation-assets`, installationAssets);
    await record(`${prefix}relaunch-socket`, {
      status: 'not-retested',
      reason:
        'The authenticated unused ticket was tested immediately after no-network; no fresh ticket can be issued offline.',
    });
    return relaunched;
  }
  async function reloadTab(attached: Row, prefix = '') {
    stage(`${prefix}offline-page-reload`);
    const observed = await reloadOrdinaryTab(
      (suffix, method, body, timeout) => command(session(suffix), method, body, timeout),
      { origin: fixture.origin, windowHandle: attached.windowHandle, deadline: activeDeadline() },
    );
    await record(`${prefix}ordinary-tab-reload`, observed);
    const environment = await secureEnvironment();
    verifyOrdinaryTabContext(target, environment);
    await transportProbe(false);
    const assets = await executeAsync(installationAssetsScript, [], 'offline-installation-assets');
    verifyInstallationAssets(assets);
    await record(`${prefix}offline-installation-assets`, assets);
    await record(`${prefix}page-reload-socket`, {
      status: 'not-retested',
      reason:
        'The unused authenticated ticket was tested before this page reload; no fresh ticket is issued offline.',
    });
    return { ...environment, windowHandle: attached.windowHandle };
  }
  try {
    readCapabilityScope(scope);
    requireCondition(
      !selection.browser || target.browser === selection.browser,
      'scope-target-mismatch',
    );
    requireCondition(
      fixture.origin === browserstackOrigin && Boolean(options.localIdentifier),
      'fixture-preflight',
    );
    const prepared = fixture.items.filter((item) => acceptanceScope || item.outcome === 'normal');
    requireCondition(
      prepared.length === (acceptanceScope ? 4 : 2) &&
        prepared.some((item) => item.kind === 'doc') &&
        prepared.some((item) => item.kind === 'sheet'),
      'fixture-items-missing',
    );
    let acceptance: typeof import('./browserstack-acceptance.ts') | undefined;
    let acceptanceFixture: BrowserstackFixture | undefined;
    let acceptanceCases: PhoneAcceptanceCases | undefined;
    if (acceptanceScope) {
      requireAcceptanceFixture(fixture);
      acceptanceFixture = fixture;
      acceptance = await import('./browserstack-acceptance.ts');
      requireCondition(
        acceptance.phoneAcceptanceLimits.operational === operationalMilliseconds &&
          acceptance.phoneAcceptanceLimits.prerequisites === authoredPrerequisiteMilliseconds,
        'acceptance-bounds-mismatch',
      );
      acceptanceCases = acceptance.seedPhoneAcceptance(fixture);
      remaining(1);
      await record('acceptance-contract', {
        scope,
        bounds: acceptance.phoneAcceptanceLimits,
        boundsMeasured: false,
        build: 'production with read-only VITE_SYNC_EVIDENCE observations',
        browser: target.browser,
        launchContext: selection.context,
        reopenOperation: tabScope ? 'cold-page-reload' : 'native-termination-and-home-relaunch',
        nativeAppRestart: tabScope ? 'not-observed-by-this-scope' : 'required-before-continuation',
        ordinaryBrowserTabAcceptance: tabScope
          ? 'selected-not-yet-observed'
          : 'not-run-by-this-scope',
        nativeRestartAlternative: tabScope ? 'scripts/ci/desktop-offline.ts' : null,
        otherPhysicalLanes: 'not-run-by-this-scope',
      });
    }
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
              sessionName: `SPN-090 ${acceptanceScope ? 'authored acceptance' : 'native capability'}: ${target.browser}`,
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
    remaining(1);
    requireCondition(
      allocationCommandDeadline !== undefined && Date.now() < allocationCommandDeadline,
      'command-deadline',
    );
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
    verifyBrowserIdentity(target, anonymous);
    const initialWindows = await command(session('window/handles'));
    requireCondition(
      Array.isArray(initialWindows) && initialWindows.every((handle) => typeof handle === 'string'),
      'window-handles-invalid',
    );
    previousWindowHandles = initialWindows;
    await record('initial-window-handles', initialWindows);
    let foregroundApp: string | undefined;
    let launched: Row;
    if (tabScope) {
      stage('ordinary-tab-context');
      const currentWindow = await command(session('window'));
      requireCondition(
        typeof currentWindow === 'string' && initialWindows.includes(currentWindow),
        'ordinary-tab-window-unavailable',
      );
      verifyOrdinaryTabContext(target, anonymous);
      launched = { ...anonymous, windowHandle: currentWindow };
      await record('ordinary-tab-context', {
        ...launched,
        storageContext: 'actual-current-tab-within-this-device-session',
        storageTransfer: 'none',
        nativeContextCommand: 'not-requested',
        nativeAppRestart: 'not-observed-by-this-scope',
        nativeRestartAlternative: 'scripts/ci/desktop-offline.ts',
        firefoxNativeLimit:
          target.browser === 'firefox'
            ? {
                runId: '41361564434',
                evidencePath: 'docs/implementation/evidence/SPN-090-capability-41361564434.json',
                command: 'GET session/{sessionId}/contexts',
                failure: 'http-400',
                disposition: 'accepted-observation-limit-for-the-attempted-route',
              }
            : null,
      });
    } else {
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
      let installed = await tap(installMenuLabel, false, false, target.browser === 'safari');
      for (let count = 0; !installed && count < 2; count++) {
        await scroll();
        installed = await tap(installMenuLabel, false, false, target.browser === 'safari');
      }
      requireCondition(installed, 'native-install-control-unavailable');
      for (let count = 0; count < 2; count++) {
        if (!(await tap(installConfirmationLabels, false, true))) break;
      }
      // The last allowed click must also finish its native transition. This is
      // observation only: the two-click limit never grows to a third action.
      await waitForConfirmationTransition();
      stage('home-launch');
      await home();
      await launchIcon();
      foregroundApp = await foreground();
      launched = await attach(foregroundApp);
    }
    let attached = launched;
    await recordLaunch('launched-context', launched);
    await secureEnvironment(true);
    const authenticationStage = tabScope
      ? 'ordinary-tab-authentication'
      : 'installed-authentication';
    stage(authenticationStage);
    const authenticated = row(
      await executeAsync(
        `const response=await fetch(arguments[0],{cache:'no-store',credentials:'include'});
      if(!response.ok) throw new Error('bootstrap'); const session=await fetch('/api/auth/session',{cache:'no-store',credentials:'include'});
      if(!session.ok) throw new Error('session'); const body=await session.json();return {actor:body.user?.id || null};`,
        [fixture.loginURL],
        authenticationStage,
      ),
    );
    requireCondition(
      authenticated.actor === fixture.actor.id,
      tabScope ? 'ordinary-tab-authentication-failed' : 'installed-authentication-failed',
    );
    await record(authenticationStage, {
      actor: authenticated.actor,
      method: tabScope
        ? 'one-use-production-session-bootstrap-in-actual-tab'
        : 'one-use-production-session-bootstrap-in-launched-context',
    });
    stage('production-downloads');
    let previousItemURL: string | undefined;
    for (const item of prepared) {
      previousItemURL = await navigateItem(item, launched, previousItemURL);
      await record(`${item.kind}:ready`, await itemReady(false));
      await prepareDashboardItemOffline(
        {
          click: (selector, label) => clickWeb(selector, label, true),
          execute,
          poll,
          record,
          failure: (code) => new Error(`capability-${code}`),
          diagnose,
        },
        item,
      );
    }
    const acceptanceDriver: PhoneAcceptanceDriver = {
      execute,
      executeAsync,
      command: (suffix, method, body, timeout) => command(session(suffix), method, body, timeout),
      navigate: async (path) => {
        requireCondition(
          /^\/(?:\?item=[\w-]{1,200}|spaces\/[\w-]{1,200}\?item=[\w-]{1,200})?$/.test(path),
          'acceptance-navigation-invalid',
        );
        await command(session('url'), 'POST', { url: fixture.origin + path });
        currentItemURL = path.includes('?item=') ? fixture.origin + path : undefined;
      },
      ready: itemReady,
      click: (selector, label) => clickWeb(selector, label, true),
      diagnose,
      restart: async () => {
        attached = tabScope
          ? await reloadTab(attached, 'pending-')
          : await restartInstalled(foregroundApp!, 'pending-');
      },
      network: async (offline) => {
        requireCondition(acceptance && acceptanceFixture, 'acceptance-fixture-unavailable');
        // Before cutting transport again, obtain an unused authenticated ticket
        // while it is still reachable. No expired/offline ticket is fabricated.
        const ticket = offline ? await socketTicket(prepared[0]) : undefined;
        if (!offline)
          await acceptance.boundedPhoneFixtureOperation(acceptanceDriver, () =>
            acceptanceFixture!.setOffline(false),
          );
        const networkProfile = offline ? 'no-network' : '4g-lte-good';
        await timedProviderCommand(
          'PUT automate/sessions/{sessionId}/update_network.json',
          15_000,
          (bounds) =>
            client.api(
              `sessions/${result.sessionId}/update_network.json`,
              'PUT',
              { networkProfile },
              bounds,
            ),
        );
        await record(`${result.stage}:network-control`, {
          networkProfile,
          androidAirplaneMode: false,
        });
        if (ticket) await socketProbe(ticket, false);
        await transportProbe(!offline);
        if (offline) {
          await acceptance.boundedPhoneFixtureOperation(acceptanceDriver, () =>
            acceptanceFixture!.setOffline(true),
          );
          await acceptance.boundedPhoneFixtureOperation(acceptanceDriver, () =>
            acceptanceFixture!.verifyDisconnected(),
          );
        } else await socketProbe(await socketTicket(prepared[0]), true);
      },
      stage,
      remaining,
      record,
      screenshot: async (name) => {
        await requiredScreenshot(name);
      },
      visibleImages,
    };
    if (acceptance && acceptanceFixture && acceptanceCases)
      await acceptance.preparePhoneAcceptance(acceptanceDriver, acceptanceFixture, acceptanceCases);
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
    await timedProviderCommand(
      'PUT automate/sessions/{sessionId}/update_network.json',
      15_000,
      (options) =>
        client.api(
          `sessions/${result.sessionId}/update_network.json`,
          'PUT',
          { networkProfile: 'no-network' },
          options,
        ),
    );
    await record('network-control', { networkProfile: 'no-network', androidAirplaneMode: false });
    await socketProbe(unusedOfflineTicket, false);
    await transportProbe(false);
    const before = await storedItems(prepared);
    checkStored(before, prepared);
    await record(tabScope ? 'retained-before-page-reload' : 'retained-before-restart', before);
    attached = tabScope ? await reloadTab(attached) : await restartInstalled(foregroundApp!);
    const after = await storedItems(prepared);
    checkStored(after, prepared);
    requireCondition(JSON.stringify(after) === JSON.stringify(before), 'retained-bundle-changed');
    await record(tabScope ? 'retained-after-page-reload' : 'retained-after-restart', after);
    previousItemURL = undefined;
    for (const item of prepared) {
      previousItemURL = await navigateItem(item, attached, previousItemURL);
      const ready = await itemReady(true);
      requireCondition(ready.account === fixture.actor.id, 'retained-account-mismatch');
      await record(`${item.kind}:offline-ready`, ready);
      const captureName = `${item.kind}${acceptanceScope ? `-${item.outcome}` : ''}-offline-reopened`;
      if (acceptanceScope)
        await record(
          `${item.kind}:${item.outcome}:offline-rendering`,
          await visibleImages(captureName, item.kind),
        );
      else await screenshot(captureName);
    }
    if (acceptance && acceptanceFixture && acceptanceCases)
      await acceptance.runPhoneAcceptance(
        acceptanceDriver,
        acceptanceFixture,
        acceptanceCases,
        scope,
      );
    stage(selection.completionStage);
    result.status = 'passed';
  } catch (error) {
    result.failure = failure(error);
    timing.failure = {
      elapsedMilliseconds: Date.now() - began,
      remainingMilliseconds: Math.max(0, deadline - Date.now()),
      laneAborted: signal.aborted,
      deadlineReached: Date.now() >= deadline,
    };
    const failedCommand = result.command;
    if (result.sessionId && Date.now() < deadline) await screenshot('failure');
    result.command = failedCommand;
  } finally {
    const cleanupStarted = Date.now();
    const previous = timing.stages.at(-1)!;
    previous.durationMilliseconds = cleanupStarted - began - previous.startedElapsedMilliseconds;
    const cleanupDeadline = cleanupStarted + cleanupMilliseconds;
    if (result.sessionId) {
      const cleanupSignal = AbortSignal.timeout(cleanupMilliseconds);
      try {
        const networkDeadline = Math.min(cleanupDeadline, Date.now() + 7_000);
        await client.api(
          `sessions/${result.sessionId}/update_network.json`,
          'PUT',
          { networkProfile: '4g-lte-good' },
          { timeout: Math.max(1, networkDeadline - Date.now()), signal: cleanupSignal },
        );
        result.cleanup.network =
          Date.now() < networkDeadline && !cleanupSignal.aborted
            ? 'restored-4g-lte-good'
            : 'restored-after-deadline';
      } catch {
        result.cleanup.network = 'restore-failed';
      }
      try {
        await client.command(`session/${result.sessionId}`, 'DELETE', undefined, {
          timeout: Math.max(1, cleanupDeadline - Date.now()),
          signal: cleanupSignal,
        });
        result.cleanup.session =
          Date.now() < cleanupDeadline && !cleanupSignal.aborted
            ? 'deleted'
            : 'deleted-after-deadline';
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
    timing.cleanupElapsedMilliseconds = Date.now() - cleanupStarted;
    timing.totalElapsedMilliseconds = Date.now() - began;
    result.finishedAt = new Date().toISOString();
    await options.journal(result);
  }
  return result;
}

type Journal = ReservationIdentity & {
  schemaVersion: 1;
  scope: string;
  capabilityScope: CapabilityScope;
  allocationPlan: 'two-lane-chrome-safari-remediation' | Exclude<CapabilityScope, 'all'>;
  status: 'prepared' | 'running' | 'passed' | 'failed' | 'incomplete';
  fullMatrixStatus: CapabilityOutcome;
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
  scope: CapabilityScope = 'all',
): Journal {
  readCapabilityScope(scope);
  const selection = capabilityScopeDefinition(scope);
  return {
    schemaVersion: 1,
    ...identity,
    scope:
      scope === 'chrome-navigation-diagnostic'
        ? 'Chrome-only location.assign navigation and failure-only document observation with the unchanged 900-second reservation. Selected-scope execution is reported separately from full-matrix coverage. All three lanes remain reported; Firefox has an observed route limitation and Safari is not run. Full-matrix coverage remains incomplete when Chrome passes.'
        : selection.authored
          ? `${selection.browser}-only authored ${selection.context} acceptance with a 780-second operational bound and the unchanged 900-second reservation. Selected-scope execution is separate from the three-lane capability aggregate. Other browsers are not allocated. ${selection.context === 'ordinary-tab' ? 'Reopen is a verified cold page reload, not OS termination or a native process restart; native desktop coverage owns that alternative observation. Installed-context acceptance is not run by this scope.' : 'The existing actual installed capability prerequisites must pass before authored continuation. Ordinary-tab acceptance is not run by this scope.'} A selected pass does not complete every contract in the approved coverage map.`
          : 'Two-lane Chrome/Safari capability remediation with the unchanged 900-second reservation. All three required lanes remain reported; Firefox is explicitly blocked by prior evidence. This is not full-matrix acceptance.',
    capabilityScope: scope,
    allocationPlan: scope === 'all' ? 'two-lane-chrome-safari-remediation' : scope,
    status: 'prepared',
    fullMatrixStatus: 'incomplete',
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
  scope: CapabilityScope = 'all',
): Journal {
  readCapabilityScope(scope);
  const journal = row(value);
  const receipt = row(journal.receipt);
  requireCondition(
    journal.schemaVersion === 1 &&
      journal.capabilityScope === scope &&
      journal.allocationPlan === (scope === 'all' ? 'two-lane-chrome-safari-remediation' : scope) &&
      journal.status === 'prepared' &&
      journal.fullMatrixStatus === 'incomplete' &&
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
  const scope = readCapabilityScope(process.env.BS_CAPABILITY_SCOPE);
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
        const journal = preparedCapabilityJournal(identity, reservation, Date.now(), scope);
        await writeFile(reportPath, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx' });
        return;
      }
      const lock = await open('artifacts/browserstack-capability.lock', 'wx');
      await lock.close(); // Never remove this replay guard during this job.
      const journal = readPreparedCapabilityJournal(
        JSON.parse(await readFile(reportPath, 'utf8')),
        identity,
        reservation,
        Date.now(),
        scope,
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
        // Retain all three required lanes before any allocation, including when
        // a later fixture or command fails before another lane can be visited.
        journal.lanes = await Promise.all(
          targets.map((target) =>
            runCapabilityLane(
              target,
              async () =>
                notRunLane(
                  target,
                  'before-lane-execution',
                  'This lane has not started; no fixture or session has been allocated.',
                ),
              scope,
            ),
          ),
        );
        await persist();
        await mkdir('artifacts/browserstack-capability', { recursive: true });
        for (const [index, target] of targets.entries()) {
          journal.lanes[index] = await runCapabilityLane(
            target,
            async () => {
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
                scope,
                localIdentifier,
                buildName: `SPN-090 ${scope} ${identity.runId}-${identity.attempt}`,
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
            },
            scope,
          );
          await persist();
        }
        journal.stage = 'finished';
        const outcome = capabilityRunOutcome(journal.lanes, scope);
        journal.status = outcome.status;
        journal.fullMatrixStatus = outcome.fullMatrixStatus;
        process.exitCode = outcome.exitCode;
      } catch (error) {
        journal.failure = failure(error);
        journal.stage = 'failed';
        journal.status = 'failed';
        journal.fullMatrixStatus = capabilityOutcome(journal.lanes);
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
