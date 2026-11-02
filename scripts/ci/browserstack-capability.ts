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
import {
  clientFor,
  targetsFromInventory,
  webdriverErrorCode,
  type Target,
} from './browserstack.ts';

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

export type NativeControl = {
  type: string;
  attributes: Record<string, string>;
  sourceIndex: number;
  parent?: NativeControl;
};
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
/** Retain the actual XML parent chain, including unlabeled and unavailable nodes. */
export function nativeControls(source: unknown): NativeControl[] {
  requireCondition(
    typeof source === 'string' && source.length <= 2_000_000,
    'native-source-invalid',
  );
  const controls: NativeControl[] = [];
  const parents: NativeControl[] = [];
  let end = 0;
  for (const match of source.matchAll(
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*)>/g,
  )) {
    requireCondition(!source.slice(end, match.index).includes('<'), 'native-source-invalid');
    end = match.index + match[0].length;
    if (match[0].startsWith('<!--') || match[0].startsWith('<?')) continue;
    if (match[1] === '/') {
      requireCondition(
        match[3].trim() === '' && parents.at(-1)?.type === match[2],
        'native-source-invalid',
      );
      parents.pop();
      continue;
    }
    const selfClosing = /\/\s*$/.test(match[3]);
    const attributesSource = selfClosing ? match[3].replace(/\/\s*$/, '') : match[3];
    const attributes: Record<string, string> = {};
    let attributeEnd = 0;
    for (const attribute of attributesSource.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      requireCondition(
        attributesSource.slice(attributeEnd, attribute.index).trim() === '' &&
          !Object.hasOwn(attributes, attribute[1]),
        'native-source-invalid',
      );
      attributes[attribute[1]] = decodeXML(attribute[2] ?? attribute[3]);
      attributeEnd = attribute.index + attribute[0].length;
    }
    requireCondition(attributesSource.slice(attributeEnd).trim() === '', 'native-source-invalid');
    const control = {
      type: match[2],
      attributes,
      sourceIndex: controls.length,
      parent: parents.at(-1),
    };
    controls.push(control);
    if (!selfClosing) parents.push(control);
    requireCondition(controls.length <= 10_000 && parents.length <= 64, 'native-source-invalid');
  }
  requireCondition(
    controls.length > 0 && parents.length === 0 && !source.slice(end).includes('<'),
    'native-source-invalid',
  );
  return controls;
}
function nativePath(control: NativeControl): NativeControl[] {
  const path = [];
  for (let current: NativeControl | undefined = control; current; current = current.parent)
    path.push(current);
  return path;
}
function nativeOwnUnavailable({ attributes }: NativeControl, headings = false) {
  return (
    ['enabled', 'visible', 'displayed'].some((key) => attributes[key] === 'false') ||
    (headings && (attributes.heading === 'true' || attributes.role === 'heading'))
  );
}
function nativeUnavailable(control: NativeControl, headings = false) {
  // WDA's visible value belongs to the element's accessibility snapshot; it
  // is not guaranteed to propagate through every structural XCUI ancestor.
  // https://appium.github.io/appium-xcuitest-driver/latest/reference/element-attributes/#visible
  const path = control.type.startsWith('XCUIElementType') ? [control] : nativePath(control);
  return path.some((entry) => nativeOwnUnavailable(entry, headings));
}
function nativeRole(control: NativeControl) {
  return control.type === 'node' ? control.attributes.class : control.type;
}
function nativeExplicitlyAvailable(control: NativeControl) {
  return (
    control.attributes.enabled === 'true' &&
    (control.attributes.visible === 'true' || control.attributes.displayed === 'true') &&
    !nativeUnavailable(control, true)
  );
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
export function matchingNativeControl(
  controls: NativeControl[],
  patterns: RegExp | RegExp[],
  labelAttributes = ['content-desc', 'label', 'name', 'text', 'resource-id'],
) {
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    for (const control of controls) {
      if (nativeUnavailable(control)) continue;
      const attribute = labelAttributes.find((key) => pattern.test(control.attributes[key] ?? ''));
      if (attribute) {
        const label = control.attributes[attribute];
        const predicates = [
          `name()=${xpathLiteral(control.type)}`,
          `@${attribute}=${xpathLiteral(label)}`,
          ...['enabled', 'visible', 'displayed'].map((key) => `not(@${key}='false')`),
          ...['resource-id', 'class']
            .filter((key) => control.attributes[key] && key !== attribute)
            .map((key) => `@${key}=${xpathLiteral(control.attributes[key])}`),
        ];
        return { control, attribute, label, selector: `//*[${predicates.join(' and ')}]` };
      }
    }
  }
  return null;
}
const safariShareContainerNames = ['ActivityListView', 'ShareSheet.RemoteContainerView'];
export function matchingSafariHomeScreen(controls: NativeControl[]) {
  const candidates = controls.filter(
    (control) =>
      control.type === 'XCUIElementTypeCell' &&
      control.attributes.label === 'Add to Home Screen' &&
      control.attributes.enabled === 'true' &&
      control.attributes.visible === 'true' &&
      !nativeOwnUnavailable(control, true),
  );
  requireCondition(candidates.length <= 1, 'native-control-ambiguous');
  const match = matchingNativeControl(candidates, /^Add to Home Screen$/, ['label']);
  if (match) {
    // Qualify only containers actually present on this target's parsed path.
    // Their visibility is not substituted for the selected cell's own state.
    const containers = nativePath(match.control)
      .slice(1)
      .filter((entry) => safariShareContainerNames.includes(entry.attributes.name));
    const qualifiers = [
      "@enabled='true'",
      "@visible='true'",
      "not(@heading='true')",
      "not(@role='heading')",
      ...containers.map(
        (entry) =>
          `ancestor::*[name()=${xpathLiteral(entry.type)} and @name=${xpathLiteral(entry.attributes.name)}]`,
      ),
    ];
    match.selector = `${match.selector.slice(0, -1)} and ${qualifiers.join(' and ')}]`;
  }
  return match;
}
const pinCatalogId = 'com.android.launcher3.widgetpicker:id/pin_widgets_catalog';
const pinDragLayerId = 'com.google.android.apps.nexuslauncher:id/add_item_drag_layer';
const pinLabel = 'Add to home screen';
const androidConfirmationContainers = [
  'android.widget.Button',
  'android.view.View',
  'android.view.ViewGroup',
  'android.widget.LinearLayout',
  'android.widget.FrameLayout',
  'android.widget.RelativeLayout',
];
function nativeIdentity(control: NativeControl) {
  return [
    `name()=${xpathLiteral(control.type)}`,
    ...['resource-id', 'class', 'name', 'text', 'content-desc', 'label']
      .filter((key) => control.attributes[key])
      .map((key) => `@${key}=${xpathLiteral(control.attributes[key])}`),
    ...['enabled', 'visible', 'displayed'].map((key) => `not(@${key}='false')`),
    "not(@heading='true')",
    "not(@role='heading')",
  ].join(' and ');
}
function matchingPinConfirmation(controls: NativeControl[]) {
  const labels = controls.filter(
    (control) =>
      nativeRole(control) === 'android.widget.TextView' &&
      control.attributes.text === pinLabel &&
      nativePath(control).some(({ attributes }) => attributes['resource-id'] === pinCatalogId),
  );
  if (!labels.length) return null;
  requireCondition(labels.length === 1, 'native-confirmation-ambiguous');
  const labelControl = labels[0];
  const path = nativePath(labelControl);
  const catalogIndex = path.findIndex(
    ({ attributes }) => attributes['resource-id'] === pinCatalogId,
  );
  const catalog = path[catalogIndex];
  const layer = path
    .slice(catalogIndex + 1)
    .find(({ attributes }) => attributes['resource-id'] === pinDragLayerId);
  requireCondition(
    nativeExplicitlyAvailable(labelControl) &&
      nativeExplicitlyAvailable(catalog) &&
      layer &&
      nativeExplicitlyAvailable(layer),
    'native-pin-confirmation-unavailable',
  );
  // Walk only this label's parents. A clickable sibling or the catalog itself
  // never supplies an action. The first exposed action must be an allowed role.
  const targetIndex = path
    .slice(0, catalogIndex)
    .findIndex(({ attributes }) => attributes.clickable === 'true');
  const control = path[targetIndex];
  requireCondition(
    control &&
      nativeExplicitlyAvailable(control) &&
      (androidConfirmationContainers.includes(nativeRole(control)) || control === labelControl),
    'native-pin-confirmation-unavailable',
  );
  const subtree = controls.filter((candidate) => nativePath(candidate).includes(control));
  const humanLabels = (candidate: NativeControl) =>
    ['text', 'content-desc', 'label'].map((key) => candidate.attributes[key]).filter(Boolean);
  requireCondition(
    subtree.every((candidate) => humanLabels(candidate).every((label) => label === pinLabel)) &&
      subtree.filter(
        (candidate) => candidate !== control && humanLabels(candidate).includes(pinLabel),
      ).length === Number(control !== labelControl),
    'native-confirmation-ambiguous',
  );
  const descendantPath = path
    .slice(0, targetIndex)
    .reverse()
    .map((entry) => `*[${nativeIdentity(entry)}]`)
    .join('/');
  const conflictingLabel = ['text', 'content-desc', 'label']
    .map(
      (key) => `(string-length(normalize-space(@${key}))>0 and @${key}!=${xpathLiteral(pinLabel)})`,
    )
    .join(' or ');
  const exactLabel = ['text', 'content-desc', 'label']
    .map((key) => `@${key}=${xpathLiteral(pinLabel)}`)
    .join(' or ');
  const selector =
    `//*[${nativeIdentity(control)} and @clickable='true' and @enabled='true' and (@visible='true' or @displayed='true')` +
    (descendantPath ? ` and ./${descendantPath}` : '') +
    ` and not(${conflictingLabel}) and not(.//*[${conflictingLabel}])` +
    ` and count(.//*[${exactLabel}])=${Number(control !== labelControl)}` +
    ` and ancestor::*[${nativeIdentity(catalog)} and @enabled='true' and (@visible='true' or @displayed='true')]` +
    ` and ancestor::*[${nativeIdentity(layer)}]` +
    " and not(ancestor::*[@enabled='false' or @visible='false' or @displayed='false' or @heading='true' or @role='heading'])]";
  return { control, attribute: 'text', label: pinLabel, selector };
}
/** Menu titles and sheet headings are not confirmation actions. */
export function matchingNativeConfirmation(controls: NativeControl[]) {
  const actionable = controls.filter((control) => {
    const attributes = control.attributes;
    if (
      nativeUnavailable(control, true) ||
      attributes.clickable === 'false' ||
      nativePath(control).some(({ attributes }) => attributes['resource-id'] === pinCatalogId)
    )
      return false;
    const role = nativeRole(control);
    if (role === 'android.widget.Button' || role === 'XCUIElementTypeButton') return true;
    return attributes.clickable === 'true' && androidConfirmationContainers.includes(role);
  });
  const match = matchingNativeControl(actionable, installConfirmationLabels, [
    'content-desc',
    'label',
    'text',
  ]);
  if (match) {
    const identity = ["not(@heading='true')", "not(@role='heading')", "not(@clickable='false')"];
    if (match.control.attributes.clickable === 'true') identity.push("@clickable='true'");
    // An observed native identifier narrows the selected button; it does not
    // substitute for its visible action label or actionable role.
    if (match.control.attributes.name)
      identity.push(`@name=${xpathLiteral(match.control.attributes.name)}`);
    if (identity.length)
      match.selector = `${match.selector.slice(0, -1)} and ${identity.join(' and ')}]`;
  }
  return match ?? matchingPinConfirmation(controls);
}
function nativeControlState(control: NativeControl) {
  return Object.fromEntries(
    ['clickable', 'enabled', 'visible', 'displayed', 'heading'].map((key) => {
      const value = control.attributes[key];
      return [key, value === undefined ? null : /^(?:true|false)$/.test(value) ? value : 'unknown'];
    }),
  );
}
function nativeControlDiagnostic(control: NativeControl) {
  return {
    type: control.type,
    sourceIndex: control.sourceIndex,
    identity: Object.fromEntries(
      ['resource-id', 'class', 'name', 'text', 'content-desc', 'label', 'role']
        .filter((key) => control.attributes[key])
        .map((key) => [key, clean(control.attributes[key])]),
    ),
    state: nativeControlState(control),
  };
}
export function installCandidateDiagnostics(controls: NativeControl[]) {
  const candidates = controls.filter((control) =>
    ['label', 'text', 'content-desc', 'name'].some((key) =>
      installMenuLabel.test(control.attributes[key] ?? ''),
    ),
  );
  return {
    status: candidates.length ? 'candidates-observed' : 'missing-label',
    candidateCount: candidates.length,
    omittedCandidates: Math.max(0, candidates.length - 12),
    candidates: candidates.slice(0, 12).map((control) => ({
      candidate: nativeControlDiagnostic(control),
      ownUnavailable: nativeOwnUnavailable(control, true),
      availabilityScope: control.type.startsWith('XCUIElementType')
        ? 'own-element'
        : 'parent-chain',
      safariCellRejection:
        control.attributes.label !== 'Add to Home Screen'
          ? 'label'
          : control.type !== 'XCUIElementTypeCell'
            ? 'role'
            : control.attributes.enabled !== 'true' ||
                control.attributes.visible !== 'true' ||
                nativeOwnUnavailable(control, true)
              ? 'own-state'
              : null,
      shareContainerQualification: {
        observedCount: nativePath(control)
          .slice(1)
          .filter((entry) => safariShareContainerNames.includes(entry.attributes.name)).length,
        containers: nativePath(control)
          .slice(1)
          .filter((entry) => safariShareContainerNames.includes(entry.attributes.name))
          .slice(0, 4)
          .map((entry) => ({
            type: entry.type,
            name: entry.attributes.name,
            sourceIndex: entry.sourceIndex,
          })),
      },
      ancestors: nativePath(control).slice(1, 17).map(nativeControlDiagnostic),
      omittedAncestors: Math.max(0, nativePath(control).length - 17),
    })),
  };
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
  nativeActions: {
    stage: string;
    label: string;
    type: string;
    sourceSha256: string;
    target?: ReturnType<typeof nativeControlDiagnostic>;
    selectorSha256?: string;
  }[];
  timing?: CapabilityTiming;
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
  const status = document.querySelector('[aria-label="Save status"]')?.textContent || '';
  const canvasHeight = Math.max(0,...[...document.querySelectorAll('.univer-container canvas')].map(canvas=>canvas.getBoundingClientRect().height));
  const phoneReadOnly = document.body.innerText.includes('View only on this phone. Edit on a larger screen.');
  phase = 'storage';
  const account = localStorage.getItem('spinel.offline.account');
  return {...observation, phase:'editor', status, canvasHeight, phoneReadOnly, account};
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
      String(value.status).includes(offline ? 'Saved on this device' : 'All changes saved.') ||
      (!offline && String(value.status).includes('Synced.')))
  );
}

/** No application data is injected: prepare through the production download action. */
export async function runCapability(
  client: Client,
  target: Target,
  fixture: Fixture,
  options: CapabilityOptions,
): Promise<CapabilityResult> {
  const began = Date.now();
  const timing: CapabilityTiming = {
    laneLimitMilliseconds: laneMilliseconds,
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
  const deadline = began + laneMilliseconds;
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
    return Math.max(1, Math.min(maximum, left));
  }
  async function timedProviderCommand(
    name: string,
    timeout: number,
    action: (options: { timeout: number; signal: AbortSignal }) => Promise<unknown>,
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
      commandSignal = AbortSignal.timeout(allotted);
      const value = await action({
        timeout: allotted,
        signal: AbortSignal.any([signal, commandSignal]),
      });
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
    );
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
              state: nativeControlState(control),
            })),
        )
        .slice(0, 100),
      pinCandidates: parsed
        .filter((control) => control.attributes.text === pinLabel)
        .slice(0, 4)
        .map((control) => ({
          candidate: nativeControlDiagnostic(control),
          ancestors: nativePath(control).slice(1, 17).map(nativeControlDiagnostic),
          omittedAncestors: Math.max(0, nativePath(control).length - 17),
        })),
      installCandidates: installCandidateDiagnostics(parsed),
    });
    return { parsed, sourceSha256: hash(String(source)) };
  }
  const confirmationSelectors = new Set<string>();
  const observeConfirmationTransition = () =>
    poll(
      async () => {
        const observed = await controls();
        try {
          return {
            source: observed,
            match: matchingNativeConfirmation(observed.parsed),
            pending: false,
          };
        } catch (error) {
          if (failure(error) !== 'capability-native-pin-confirmation-unavailable') throw error;
          // A clicked pin sheet can disable or hide its action while closing.
          // The retained label is still pending, not evidence of disappearance.
          return { source: observed, match: null, pending: true };
        }
      },
      (observed) =>
        !observed.pending &&
        (!observed.match || !confirmationSelectors.has(observed.match.selector)),
      'native-confirmation-unchanged',
    );
  async function tap(
    pattern: RegExp | RegExp[],
    required = true,
    confirmation = false,
    safariInstall = false,
  ): Promise<boolean> {
    let source: Awaited<ReturnType<typeof controls>>;
    let match: ReturnType<typeof matchingNativeConfirmation>;
    if (confirmation && confirmationSelectors.size) {
      ({ source, match } = await observeConfirmationTransition());
    } else {
      source = await controls();
      match = safariInstall
        ? matchingSafariHomeScreen(source.parsed)
        : confirmation
          ? matchingNativeConfirmation(source.parsed)
          : matchingNativeControl(source.parsed, pattern);
    }
    if (match) {
      const { control, label, selector } = match;
      if (confirmation) {
        requireCondition(!confirmationSelectors.has(selector), 'native-confirmation-unchanged');
        confirmationSelectors.add(selector);
      }
      const elements = await command(session('elements'), 'POST', {
        using: 'xpath',
        value: selector,
      });
      requireCondition(Array.isArray(elements), 'native-elements-invalid');
      requireCondition(elements.length > 0, 'native-control-stale');
      requireCondition(elements.length === 1, 'native-control-ambiguous');
      await command(session(`element/${elementId(elements[0])}/click`), 'POST', {});
      result.nativeActions.push({
        stage: result.stage,
        label: client.redact(clean(label)),
        type: control.type,
        sourceSha256: source.sourceSha256,
        target: nativeControlDiagnostic(control),
        selectorSha256: hash(selector),
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
    if (confirmationSelectors.size) await observeConfirmationTransition();
    stage('home-launch');
    await home();
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
    await record('retained-before-restart', before);
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
