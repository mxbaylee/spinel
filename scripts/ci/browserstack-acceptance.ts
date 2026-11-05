import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import { TextX, TextXActionType } from '@univerjs/core';
import type { TextXAction } from '@univerjs/core';
import type { NativeSnapshot } from '@spinel/sync-client';
import { comparable, pending } from '../../e2e/offline-fixture.ts';
import { textPoints } from '../../e2e/doc-touch-raster.ts';
import { AuthStore } from '../../src/server/auth/store.ts';
import { WorkspaceStore } from '../../src/server/workspace/store.ts';
import { SpaceStore } from '../../src/server/workspace/spaces.ts';
import { mapNativeImageSources } from '../../src/shared/nativeImageSources.ts';
import { snapshotIdentity } from '../../src/shared/snapshotIdentity.ts';
import type { WorkspaceItem } from '../../src/shared/workspace.ts';
import type { StoredItem } from '../../web/offline/offlineStore.ts';
import { reconstructOffline } from '../../web/offline/recovery.ts';
import type { BrowserstackFixture } from './browserstack-fixture.ts';
import type { DesktopSnapshot } from './desktop-offline-fixture.ts';
import {
  capabilityScopeDefinition,
  readCapabilityScope,
  type CapabilityScope,
} from './browserstack-scope.ts';
import { prepareSpacePageOffline } from './browserstack-offline-preparation.ts';
import { webdriverErrorCode } from './browserstack.ts';
import {
  inputCounterInstallScript,
  inputCounterFocusScript,
  inputCounterReadScript,
  inputCounterDiagnostic,
} from './browserstack-input-observation.ts';
export { inputCounterInstallScript, inputCounterReadScript, inputCounterDiagnostic };

type Row = Record<string, unknown>;
type Kind = 'sheet' | 'doc';
type Point = { x: number; y: number };
type LocalCopy = {
  account: string | null;
  record: StoredItem | null;
  images: { source: string; sha256: string; size: number }[];
};

/** Unmeasured failure bounds, not a forecast of a successful physical run. */
export const phoneAcceptanceLimits = {
  operational: 780_000,
  prerequisites: 240_000,
  edits: 100_000,
  creation: 80_000,
  restart: 90_000,
  reconnect: 140_000,
  links: 80_000,
  repeat: 30_000,
} as const;

/** Provider launch/reopen, network controls and accounting stay in the existing driver. */
export type PhoneAcceptanceDriver = {
  execute(script: string, args?: unknown[], timeout?: number): Promise<unknown>;
  executeAsync(body: string, args?: unknown[], operation?: string): Promise<unknown>;
  command(suffix: string, method?: string, body?: unknown, timeout?: number): Promise<unknown>;
  navigate(path: string): Promise<void>;
  ready(offline: boolean): Promise<Row>;
  click(selector: string, label: string): Promise<void>;
  /**
   * Safari only: one native XCUITest tap or double tap at a screen point, so
   * the two taps share one gesture instead of two W3C actions calls.
   */
  nativeTouch?(point: Point, taps: 1 | 2): Promise<void>;
  /** Failure-only evidence that keeps the failed command and stalled screenshot. */
  diagnose?<T>(work: () => Promise<T>): Promise<T>;
  restart(): Promise<void>;
  network(offline: boolean): Promise<void>;
  stage(name: string, maximumMilliseconds: number): void;
  remaining(maximum?: number): number;
  record(stage: string, value: unknown): Promise<void>;
  /** Required evidence: capture, decode and write failures reject acceptance. */
  screenshot(name: string): Promise<void>;
  visibleImages(name: string, kind: Kind): Promise<Row>;
};

function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`capability-acceptance-${code}`);
}
function row(value: unknown): Row {
  requireCondition(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'observation-invalid',
  );
  return value as Row;
}
function same(actual: unknown, expected: unknown, code: string) {
  requireCondition(isDeepStrictEqual(actual, expected), code);
}

export const contentDifferenceLimit = 20;
export type ContentDifference = {
  path: string;
  change: 'added' | 'removed' | 'changed';
  actual: string;
  expected: string;
};
const valueType = (value: unknown) =>
  value === undefined
    ? 'absent'
    : value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value;
const pathKey = (key: string) => (/^[\w.-]{1,64}$/.test(key) ? key : '?');

/**
 * Lists where two comparable snapshots differ by path, change and value type.
 * Values are never returned, so a mismatch report cannot carry document text.
 */
export function contentDifferences(actual: unknown, expected: unknown) {
  const differences: ContentDifference[] = [];
  let total = 0;
  const visit = (left: unknown, right: unknown, path: string[]) => {
    if (isDeepStrictEqual(left, right)) return;
    const container = (value: unknown) => value !== null && typeof value === 'object';
    if (container(left) && container(right) && Array.isArray(left) === Array.isArray(right)) {
      const keys = new Set([...Object.keys(left as object), ...Object.keys(right as object)]);
      for (const key of [...keys].sort())
        visit((left as Row)[key], (right as Row)[key], [...path, pathKey(key)]);
      return;
    }
    total += 1;
    if (differences.length < contentDifferenceLimit)
      differences.push({
        path: path.join('.').slice(0, 240),
        change: left === undefined ? 'removed' : right === undefined ? 'added' : 'changed',
        actual: valueType(left),
        expected: valueType(right),
      });
  };
  visit(actual, expected, []);
  return { differences, omitted: total - differences.length };
}

class ContentMismatch extends Error {
  readonly report: ReturnType<typeof contentDifferences>;
  constructor(code: string, report: ReturnType<typeof contentDifferences>) {
    super(`capability-acceptance-${code}`);
    this.report = report;
  }
}
function sameContent(actual: unknown, expected: unknown, code: string) {
  if (!isDeepStrictEqual(actual, expected))
    throw new ContentMismatch(code, contentDifferences(actual, expected));
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const itemPath = (id: string) => `/?item=${id}`;
const region = (kind: Kind) => `[aria-label="${kind === 'sheet' ? 'Sheet' : 'Doc'} document"]`;
const canvasSelector = (kind: Kind) =>
  `${region(kind)} canvas[aria-label="${kind === 'sheet' ? 'Spreadsheet grid' : 'Document canvas'}"]`;

async function until<T>(
  driver: PhoneAcceptanceDriver,
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  code: string,
  maximum = 15_000,
): Promise<T> {
  const deadline = Date.now() + driver.remaining(maximum);
  do {
    const value = await read();
    if (Date.now() >= deadline) break;
    driver.remaining(1);
    if (accepts(value)) return value;
    const left = Math.min(deadline - Date.now(), driver.remaining(maximum));
    if (left <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, left)));
  } while (Date.now() < deadline);
  throw new Error(`capability-acceptance-${code}`);
}

async function fixtureOperation<T>(driver: PhoneAcceptanceDriver, work: () => Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = driver.remaining(120_000);
    const deadline = Date.now() + timeout;
    const value = await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('capability-acceptance-fixture-deadline')),
          timeout,
        );
      }),
    ]);
    requireCondition(Date.now() < deadline, 'fixture-deadline');
    driver.remaining(1);
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export {
  until as observePhoneAcceptance,
  fixtureOperation as boundedPhoneFixtureOperation,
  actions as phoneActions,
  doubleTap as phoneDoubleTap,
  nativeType as phoneNativeType,
};

/** Open only the existing database and issue readonly transactions. No data is seeded in the phone. */
export const phoneLocalCopyScript = `
const [account,itemId]=arguments;
const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('spinel-offline-'+account);
  request.onupgradeneeded=()=>{request.transaction.abort();reject(new Error('missing'));};
  request.onerror=()=>reject(new Error('unavailable'));request.onsuccess=()=>resolve(request.result);});
try {
  const transaction=database.transaction(['items','images'],'readonly');
  const read=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('read'));});
  const [record,allImages]=await Promise.all([read(transaction.objectStore('items').get(itemId)),read(transaction.objectStore('images').getAll())]);
  const images=await Promise.all(allImages.filter(image=>image.itemId===itemId).map(async image=>({source:image.source,size:image.bytes.byteLength,
    sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',image.bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('')})));
  return {account:localStorage.getItem('spinel.offline.account'),record:record || null,images:images.sort((a,b)=>a.source.localeCompare(b.source))};
} finally {database.close();}
`;

/** The application emits a detached public snapshot; this request exposes no editor or command API. */
export const phoneNativeSnapshotScript = `
const unitId=arguments[0];let found=null;
const receive=event=>{if(event.detail?.unitId===unitId)found=event.detail;};
addEventListener('spinel-sync-native-snapshot',receive);
try {dispatchEvent(new CustomEvent('spinel-sync-native-snapshot-read',{detail:{unitId}}));}
finally {removeEventListener('spinel-sync-native-snapshot',receive);}
return found;
`;

export const phoneDocSelectionScript = `
const unitId=arguments[0];let found=null;
const receive=event=>{if(event.detail?.unitId===unitId)found=event.detail;};
addEventListener('spinel-doc-selection-evidence',receive);
try {dispatchEvent(new Event('spinel-doc-selection-read'));}
finally {removeEventListener('spinel-doc-selection-evidence',receive);}
return found;
`;

async function local(driver: PhoneAcceptanceDriver, fixture: BrowserstackFixture, itemId: string) {
  const observed = row(
    await driver.executeAsync(
      phoneLocalCopyScript,
      [fixture.actor.id, itemId],
      'acceptance-local-copy',
    ),
  );
  requireCondition(
    observed.account === fixture.actor.id && Array.isArray(observed.images),
    'local-account-mismatch',
  );
  return observed as LocalCopy;
}

export function verifyEditablePhone(value: unknown, kind: Kind) {
  const observed = row(value);
  requireCondition(observed.mobile === true && observed.kind === kind, 'mobile-editor-unavailable');
  requireCondition(observed.readOnly === false, 'native-authoring-read-only');
  if (kind === 'doc') requireCondition(observed.edit === true, 'native-doc-edit-unavailable');
}

/** The pinned mobile Doc exposes Edit as an icon-only button's accessible label. */
export const phoneEditableScript = `
const [selector,kind]=arguments;const root=document.querySelector(selector);
const visible=element=>{const box=element.getBoundingClientRect();const style=getComputedStyle(element);
  return box.width>0 && box.height>0 && style.display!=='none' && style.visibility!=='hidden' &&
    !element.hidden && !element.disabled && element.getAttribute('aria-disabled')!=='true';};
return {kind,mobile:root?.getAttribute('data-mobile')==='true',
  readOnly:!root || /View only|Edit on a larger screen/.test(root.innerText+' '+(document.querySelector('[aria-label="Save status"]')?.textContent || '')),
  edit:[...root?.querySelectorAll('button') || []].some(button=>(button.getAttribute('aria-label') || button.textContent.trim())==='Edit' && visible(button))};
`;

async function editable(driver: PhoneAcceptanceDriver, kind: Kind) {
  const observed = await driver.execute(phoneEditableScript, [region(kind), kind]);
  verifyEditablePhone(observed, kind);
}

export function verifyRetainedEdit(
  copy: LocalCopy,
  expected: { account: string; item: string; unitId: string; kind: Kind },
) {
  requireCondition(
    copy.account === expected.account && copy.record?.bundle.accountId === expected.account,
    'durable-account-mismatch',
  );
  requireCondition(
    copy.record?.bundle.itemId === expected.item &&
      copy.record.bundle.unitId === expected.unitId &&
      copy.record.bundle.readOnly === false,
    'durable-bundle-mismatch',
  );
  const outbox = copy.record?.outbox;
  requireCondition(
    outbox?.account === expected.account &&
      outbox.item === expected.item &&
      outbox.unitId === expected.unitId,
    'durable-identity-mismatch',
  );
  requireCondition(
    copy.record?.bundle.kind === expected.kind && pending(outbox.checkpoint),
    'durable-edit-missing',
  );
  requireCondition(
    !outbox.checkpoint.recoveryMissing && !outbox.checkpoint.failure,
    'durable-edit-failed',
  );
  return reconstructOffline(outbox.checkpoint, expected.kind);
}

async function nativeSnapshot(driver: PhoneAcceptanceDriver, unitId: string) {
  return until(
    driver,
    async () => {
      const value = await driver.execute(phoneNativeSnapshotScript, [unitId]);
      return value === null ? null : row(value);
    },
    (value) => Boolean(value && value.unitId === unitId && value.snapshot),
    'native-snapshot-unavailable',
  );
}

async function assertNative(
  driver: PhoneAcceptanceDriver,
  unitId: string,
  expected: NativeSnapshot,
) {
  const observed = await nativeSnapshot(driver, unitId);
  same(
    comparable(observed!.snapshot as NativeSnapshot),
    comparable(expected),
    'native-snapshot-mismatch',
  );
  return { unitId, revision: observed!.revision, snapshotSha256: digest(comparable(expected)) };
}

/** A retained image graph is incomplete evidence until the visible canvas paints it. */
export async function assertPhoneImageCheckpoint(
  driver: PhoneAcceptanceDriver,
  item: { unitId: string; kind: Kind },
  expected: NativeSnapshot,
  name: string,
) {
  const native = await assertNative(driver, item.unitId, expected);
  const rendering = await driver.visibleImages(name, item.kind);
  return { native, rendering };
}

async function saved(driver: PhoneAcceptanceDriver, text = 'Saved on this device') {
  await until(
    driver,
    () =>
      driver.execute(
        `return document.querySelector('[aria-label="Save status"]')?.textContent || '';`,
      ),
    (value) => typeof value === 'string' && value.includes(text),
    'save-status-unavailable',
  );
}

function elementId(value: unknown) {
  const element = row(value);
  const id = element['element-6066-11e4-a52e-4f735466cecf'] ?? element.ELEMENT;
  requireCondition(
    typeof id === 'string' && /^[\w:.-]{1,200}$/.test(id),
    'native-element-unavailable',
  );
  return id;
}

async function actions(driver: PhoneAcceptanceDriver, value: unknown) {
  let original: unknown;
  let failed = false;
  try {
    await driver.command('actions', 'POST', { actions: [value] });
  } catch (error) {
    failed = true;
    original = error;
  }
  try {
    await driver.command('actions', 'DELETE');
  } catch (error) {
    if (failed) throw original;
    // Every sequence ends with its own pointerUp or keyUp, so the release is
    // redundant. Safari's driver answers it with `unknown command` (run
    // 41771504170); only that answer, after a successful POST, is tolerated.
    if (webdriverErrorCode(error) !== 'unknown command') throw error;
    if (!releaseUnsupported.has(driver)) {
      releaseUnsupported.add(driver);
      await driver.record('actions-release-unsupported', { webdriverErrorCode: 'unknown command' });
    }
  }
  if (failed) throw original;
}
const releaseUnsupported = new WeakSet<PhoneAcceptanceDriver>();

async function hit(driver: PhoneAcceptanceDriver, selector: string, point: Point) {
  const visible = await driver.execute(
    `
    const [selector,point]=arguments;const node=document.querySelector(selector);const target=document.elementFromPoint(point.x,point.y);
    return Boolean(node && point.x>=0 && point.y>=0 && point.x<innerWidth && point.y<innerHeight &&
      (target===node || (target && node.parentElement?.contains(target))));
  `,
    [selector, point],
  );
  requireCondition(visible === true, 'native-touch-target-obscured');
}

/**
 * Records, in the page, the input events a double tap produced: type, pointer
 * type, milliseconds since installation, offset from the tap point and, given
 * the canvas selector, whether the event's target was that canvas (`grid`),
 * something else beside it (`region`) or neither (`other`), and the target's
 * tag with its nearest `data-u-comp` name (`element`). At most 24 events; no
 * text, target content or URL. A later install replaces it.
 */
export const tapTraceInstallScript = `
  const [point,selector]=arguments;const key='__spinelTapTrace';window[key]?.stop();
  const origin=performance.now();const events=[];
  const types=['pointerdown','pointerup','pointercancel','touchstart','touchend','touchcancel','click','dblclick'];
  const where=(target)=>{if(typeof selector!=='string')return null;const node=document.querySelector(selector);
    if(!node)return 'other';if(target===node)return 'grid';return node.parentElement?.contains(target)?'region':'other';};
  const name=(target)=>{if(typeof target?.tagName!=='string'||typeof target.closest!=='function')return null;
    const comp=target.closest('[data-u-comp]')?.getAttribute('data-u-comp');
    return target.tagName.toLowerCase().slice(0,16)+(comp?'['+comp.slice(0,40)+']':'');};
  const keep=(event)=>{if(events.length>=24)return;const touch=event.changedTouches?.[0];
    const x=touch?touch.clientX:event.clientX;const y=touch?touch.clientY:event.clientY;
    events.push({type:event.type,pointerType:typeof event.pointerType==='string'?event.pointerType.slice(0,8):null,
      milliseconds:Math.round(event.timeStamp-origin),
      dx:Number.isFinite(x)?Math.round(x-point.x):null,dy:Number.isFinite(y)?Math.round(y-point.y):null,
      target:where(event.target),element:name(event.target)});};
  for(const type of types)window.addEventListener(type,keep,{capture:true,passive:true});
  window[key]={events,selector,stop:()=>{for(const type of types)window.removeEventListener(type,keep,{capture:true});delete window[key];}};
  return true;
`;
/**
 * Returns the trace, the visual viewport and the canvas box; `true` as the
 * first argument keeps it recording.
 */
export const tapTraceReadScript = `
  const trace=window.__spinelTapTrace;if(!trace)return {installed:false,events:[]};
  const events=trace.events.slice(0,24);const view=window.visualViewport;
  const node=typeof trace.selector==='string'?document.querySelector(trace.selector):null;const box=node?.getBoundingClientRect();
  const viewport=view?{scale:view.scale,offsetLeft:view.offsetLeft,offsetTop:view.offsetTop}:null;
  const canvas=box?{x:box.x,y:box.y,width:box.width,height:box.height}:null;
  if(arguments[0]!==true)trace.stop();return {installed:true,events,viewport,canvas};
`;

/** Keeps only the bounded fields the install script records. */
export function tapTraceDiagnostic(value: unknown) {
  const observed = value !== null && typeof value === 'object' ? (value as Row) : {};
  const integer = (field: unknown) =>
    typeof field === 'number' && Number.isSafeInteger(field) ? field : null;
  const measure = (field: unknown, keys: string[], scale: number) => {
    if (field === null || typeof field !== 'object') return null;
    const entry = field as Row;
    if (!keys.every((key) => typeof entry[key] === 'number' && Number.isFinite(entry[key])))
      return null;
    return Object.fromEntries(
      keys.map((key) => [key, Math.round((entry[key] as number) * scale) / scale]),
    );
  };
  const events = Array.isArray(observed.events) ? observed.events.slice(0, 24) : [];
  return {
    installed: observed.installed === true,
    events: events.map((event) => {
      const entry = event !== null && typeof event === 'object' ? (event as Row) : {};
      return {
        type:
          typeof entry.type === 'string' && /^[a-z]{1,16}$/.test(entry.type) ? entry.type : 'other',
        pointerType:
          typeof entry.pointerType === 'string' && /^[a-z]{1,8}$/.test(entry.pointerType)
            ? entry.pointerType
            : null,
        milliseconds: integer(entry.milliseconds),
        dx: integer(entry.dx),
        dy: integer(entry.dy),
        target: ['grid', 'region', 'other'].includes(entry.target as string)
          ? (entry.target as string)
          : null,
        element:
          typeof entry.element === 'string' &&
          /^[a-z][a-z0-9-]{0,15}(\[[\w-]{1,40}\])?$/.test(entry.element)
            ? entry.element
            : null,
      };
    }),
    viewport: measure(observed.viewport, ['scale', 'offsetLeft', 'offsetTop'], 100),
    canvas: measure(observed.canvas, ['x', 'y', 'width', 'height'], 1),
  };
}

/** Largest believable offset between an aimed and a landed tap, in CSS pixels. */
export const tapCalibrationLimit = 120;
const calibrations = new WeakMap<PhoneAcceptanceDriver, Point>();

/**
 * Where a tap aimed at `point` landed, from the page's own trace: the first
 * pointerdown or touchstart. Unseen, or further than `tapCalibrationLimit`
 * away, fails rather than guessing.
 */
export function tapOffset(trace: ReturnType<typeof tapTraceDiagnostic>): Point {
  const landed = trace.events.find(
    (event) =>
      (event.type === 'pointerdown' || event.type === 'touchstart') &&
      event.dx !== null &&
      event.dy !== null,
  );
  requireCondition(landed, 'native-tap-calibration-unseen');
  requireCondition(
    Math.abs(landed.dx!) <= tapCalibrationLimit && Math.abs(landed.dy!) <= tapCalibrationLimit,
    'native-tap-calibration-offset',
  );
  return { x: landed.dx!, y: landed.dy! };
}

/** Pause between the two taps of a double tap; Univer allows 500 ms. */
export const doubleTapPauseMilliseconds = 250;
const touch = (point: Point, taps: 1 | 2) => ({
  type: 'pointer',
  id: 'phone-acceptance-touch',
  parameters: { pointerType: 'touch' },
  actions: [
    { type: 'pointerMove', origin: 'viewport', duration: 0, x: point.x, y: point.y },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerUp', button: 0 },
    ...(taps === 2
      ? [
          { type: 'pause', duration: doubleTapPauseMilliseconds },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ]
      : []),
  ],
});

async function press(driver: PhoneAcceptanceDriver, point: Point, taps: 1 | 2) {
  if (driver.nativeTouch) await driver.nativeTouch(point, taps);
  else await actions(driver, touch(point, taps));
}

/**
 * Once per session: one single tap on the target, measured by the page trace.
 * Safari run 41782555335 landed 62 px above its aim. The calibration tap only
 * selects; the double tap starts at least 600 ms later, past Univer's 500 ms
 * double-click window, so the two never combine.
 */
async function calibrate(driver: PhoneAcceptanceDriver, point: Point, selector: string) {
  const known = calibrations.get(driver);
  if (known) return known;
  await hit(driver, selector, point);
  await driver.execute(tapTraceInstallScript, [point, selector]);
  const tapped = Date.now();
  await press(driver, point, 1);
  await until(
    driver,
    async () => tapTraceDiagnostic(await driver.execute(tapTraceReadScript, [true])),
    (trace) =>
      trace.events.some((event) => event.type === 'pointerdown' || event.type === 'touchstart'),
    'native-tap-calibration-unseen',
    3_000,
  ).catch((error: unknown) => {
    // Unseen is decided below from the final read; a deadline still fails as itself.
    if ((error as Error)?.message !== 'capability-acceptance-native-tap-calibration-unseen')
      throw error;
  });
  const trace = tapTraceDiagnostic(await driver.execute(tapTraceReadScript));
  await driver.record('native-tap-calibration', trace);
  const offset = tapOffset(trace);
  calibrations.set(driver, offset);
  const wait = 600 - (Date.now() - tapped);
  if (wait > 0)
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, driver.remaining(wait))));
  return offset;
}

// Univer counts a double click only when both clicks land within 500 ms and
// 10 px (engine-render InputManager). Safari history, all 2026-11-04 (owner's
// choices): back to back, run 41782555335 saw one tap 62 px above the aim, so
// the aim is calibrated; a 100 ms pause, run 41898771272 saw overlapping
// touches; two separate sequences, run 41903366803 saw two clean taps 715 ms
// apart, since each Safari actions call takes about 600 ms; one sequence with
// a 250 ms pause, run 41910575626 saw both downs at 460 ms with no up between.
// So Safari now uses XCUITest's own `mobile: tap` and `mobile: doubleTap`
// (`nativeTouch`), calibrated the same way; Android keeps the W3C sequence.
// The page trace records what each produced.
// Run 41928778203 (owner's choice, 2026-11-04): calibrating on A1 itself
// landed 62 px higher, on the sheet-tab bar, and every later event targeted
// something other than the grid. So the sheet calibrates at the grid's middle,
// where the landing stays in the grid, and the target is checked again after.
async function doubleTap(
  driver: PhoneAcceptanceDriver,
  selector: string,
  point: Point,
  calibration: Point = point,
) {
  const actual = { x: Math.round(point.x), y: Math.round(point.y) };
  const calibrationPoint = { x: Math.round(calibration.x), y: Math.round(calibration.y) };
  await hit(driver, selector, actual);
  const offset = await calibrate(driver, calibrationPoint, selector);
  await hit(driver, selector, actual);
  const aimed = { x: actual.x - offset.x, y: actual.y - offset.y };
  requireCondition(aimed.x >= 0 && aimed.y >= 0, 'native-tap-calibration-offset');
  await driver.execute(tapTraceInstallScript, [actual, selector]);
  await press(driver, aimed, 2);
  return actual;
}

/** On an editor that did not open, records the page's tap trace, then rethrows. */
export async function withTapTrace<T>(
  driver: PhoneAcceptanceDriver,
  kind: Kind,
  opened: () => Promise<T>,
): Promise<T> {
  try {
    return await opened();
  } catch (failure) {
    let trace: unknown = 'unavailable';
    try {
      trace = tapTraceDiagnostic(await driver.execute(tapTraceReadScript));
    } catch {
      // The editor failure stays the result.
    }
    await driver.record(`native-${kind}-tap-trace`, trace);
    throw failure;
  }
}

async function canvasBox(driver: PhoneAcceptanceDriver, kind: Kind) {
  const observed = row(
    await driver.execute(
      `
    const canvas=document.querySelector(arguments[0]);if(!canvas)return null;
    const box=canvas.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};
  `,
      [canvasSelector(kind)],
    ),
  );
  requireCondition(
    ['x', 'y', 'width', 'height'].every(
      (key) => typeof observed[key] === 'number' && Number.isFinite(observed[key]),
    ) &&
      Number(observed.width) > 100 &&
      Number(observed.height) > 100,
    'native-canvas-unavailable',
  );
  return observed as { x: number; y: number; width: number; height: number };
}

async function docTextPoint(driver: PhoneAcceptanceDriver) {
  const observed = row(
    await driver.execute(
      `
    const canvas=document.querySelector(arguments[0]);if(!canvas || canvas.width*canvas.height>16000000)return null;
    const rect=canvas.getBoundingClientRect();return {box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},png:canvas.toDataURL('image/png')};
  `,
      [canvasSelector('doc')],
    ),
  );
  requireCondition(
    typeof observed.png === 'string' &&
      observed.png.startsWith('data:image/png;base64,') &&
      observed.png.length < 12_000_000,
    'native-canvas-raster-unavailable',
  );
  const { data, info } = await sharp(
    Buffer.from(observed.png.slice('data:image/png;base64,'.length), 'base64'),
    { limitInputPixels: 16_000_000 },
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const points = textPoints({
    data,
    ...info,
    box: observed.box as { x: number; y: number; width: number; height: number },
  });
  for (const point of points) {
    const visible = await driver.execute(
      `const [selector,p]=arguments;const node=document.querySelector(selector);const target=document.elementFromPoint(p.x,p.y);return Boolean(node && (target===node || (target && node.parentElement?.contains(target))));`,
      [canvasSelector('doc'), point],
    );
    if (visible === true) return point;
  }
  throw new Error('capability-acceptance-native-text-pixels-unavailable');
}

/** How long one key may take to reach the editor as an insertion. */
export const keyInsertionMilliseconds = 2_000;

// Run 41938061698 (owner's choice, 2026-11-04): three keys sent in one action
// 40 ms apart left only the first, "7", in A1. Each key is now its own action,
// sent once the native editor has focus, and the next waits until the page has
// counted this one's insertion. Every step is recorded; a dropped key fails
// with its index recorded.
async function nativeType(driver: PhoneAcceptanceDriver, text: string) {
  const steps: (ReturnType<typeof inputCounterDiagnostic> & { index: number })[] = [];
  const keys = Array.from(text);
  let failure: unknown;
  let failed = false;
  let installed = false;
  let cleanupObservation = inputCounterDiagnostic(null);
  let cleanup: 'not-installed' | 'stopped' | 'failed' = 'not-installed';
  try {
    installed = true; // An uncertain install is still owned and needs removal.
    await driver.execute(inputCounterInstallScript);
    for (const [index, value] of keys.entries()) {
      let last = inputCounterDiagnostic(null);
      try {
        const focused = await until(
          driver,
          () => driver.execute(inputCounterFocusScript, [index]),
          (value) => value !== null,
          'native-input-not-focused',
        );
        elementId(focused);
        // Native actions remain unchanged. Observation never resends a key.
        await actions(driver, {
          type: 'key',
          id: 'phone-acceptance-keys',
          actions: [
            { type: 'keyDown', value },
            { type: 'keyUp', value },
          ],
        });
        await until(
          driver,
          async () => (last = inputCounterDiagnostic(await driver.execute(inputCounterReadScript))),
          (state) => state.count !== null && state.count >= index + 1,
          'native-input-character-dropped',
          keyInsertionMilliseconds,
        );
        requireCondition(
          last.trace?.current &&
            last.trace.index === index &&
            last.trace.pending === 0 &&
            last.trace.dropped === 0,
          'native-input-observation-unavailable',
        );
      } finally {
        steps.push({ index, ...last });
      }
    }
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (installed) {
    try {
      // One removal read, using the existing failure-evidence budget when needed.
      // No action, navigation or new polling loop follows a failed insertion.
      const stop = () => driver.execute(inputCounterReadScript, [true]);
      const value = failed && driver.diagnose ? await driver.diagnose(stop) : await stop();
      const final = inputCounterDiagnostic(value);
      cleanupObservation = final; // Never replace the deadline's first-failure snapshot.
      requireCondition(final.installed && final.trace?.current, 'native-input-removal-unavailable');
      cleanup = 'stopped';
    } catch (error) {
      cleanup = 'failed';
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  }
  try {
    await driver.record('native-input-keys', {
      keys: keys.length,
      steps,
      cleanup,
      cleanupObservation,
    });
  } catch (error) {
    if (!failed) {
      failed = true;
      failure = error;
    }
  }
  if (failed) throw failure;
}

async function author(
  driver: PhoneAcceptanceDriver,
  item: { id: string; unitId: string; kind: Kind },
  baseline: NativeSnapshot,
  text: string,
  blank = false,
) {
  await editable(driver, item.kind);
  await assertNative(driver, item.unitId, baseline);
  let caret: number | undefined;
  let point: Point;
  if (item.kind === 'sheet') {
    const box = await canvasBox(driver, 'sheet');
    point = await doubleTap(
      driver,
      canvasSelector('sheet'),
      { x: box.x + 80, y: box.y + 40 },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    await withTapTrace(driver, 'sheet', () =>
      until(
        driver,
        () =>
          driver.execute(
            `return [...document.querySelectorAll('[data-u-comp="mobile-formula-bar"]')].some(node=>node.getBoundingClientRect().height>0);`,
          ),
        (value) => value === true,
        'native-sheet-formula-bar-unavailable',
      ),
    );
  } else {
    await driver.click(`${region('doc')} button`, 'Edit');
    const box = blank ? await canvasBox(driver, 'doc') : undefined;
    // Reuse connection-status.spec.ts's modern blank-body target. The modern
    // page's top inset/margin places its first line near y100, not in its margin.
    point = await doubleTap(
      driver,
      canvasSelector('doc'),
      box ? { x: box.x + 40, y: box.y + 100 } : await docTextPoint(driver),
    );
    const selected = await withTapTrace(driver, 'doc', () =>
      until(
        driver,
        async () => {
          const value = await driver.execute(phoneDocSelectionScript, [item.unitId]);
          return value === null ? null : row(value);
        },
        (value) => {
          const range = value?.nativeRange as Row | null;
          const logical = value?.currentLogicalRange as Row | null;
          return Boolean(
            value?.inputFocused &&
            !value.pendingSelection &&
            range?.collapsed &&
            logical?.collapsed &&
            range.start === range.end &&
            range.start === logical.start &&
            range.end === logical.end &&
            range.segmentId === '' &&
            logical.segmentId === '',
          );
        },
        'native-doc-caret-unavailable',
      ),
    );
    const range = row(selected!.nativeRange);
    caret = Number(range.start);
    requireCondition(
      !('sheets' in baseline) &&
        Number.isSafeInteger(caret) &&
        caret >= 0 &&
        caret <= (baseline.body?.dataStream.length ?? 0) - 2,
      'native-doc-caret-invalid',
    );
    requireCondition(
      selected!.text === baseline.body?.dataStream,
      'native-doc-before-input-mismatch',
    );
    requireCondition(row(selected!.shortcutContext).drawing !== true, 'native-doc-drawing-focused');
  }
  await nativeType(driver, text);
  if (item.kind === 'sheet') await driver.click('[data-u-comp="mobile-formula-bar"] button', 'OK');
  await saved(driver);
  await driver.record('native-authored-input', {
    itemId: item.id,
    kind: item.kind,
    text,
    point,
    caret: caret ?? null,
    transport: driver.nativeTouch
      ? 'XCUITest native taps and W3C key actions; native mobile editor'
      : 'W3C touch and key actions; native mobile editor',
    softwareKeyboardTyping: 'not-claimed',
  });
  return caret;
}

function imageHashes(fixture: BrowserstackFixture, itemId: string) {
  return fixture
    .imageRows(itemId)
    .map((image) => ({ sha256: image.id, size: Buffer.from(image.bytes, 'hex').length }))
    .sort((a, b) => a.sha256.localeCompare(b.sha256));
}
function verifyImages(copy: LocalCopy, expected: { sha256: string; size: number }[]) {
  same(
    copy.images
      .map(({ sha256, size }) => ({ sha256, size }))
      .sort((a, b) => a.sha256.localeCompare(b.sha256)),
    expected,
    'retained-images-mismatch',
  );
}
function copiedContent(snapshot: NativeSnapshot) {
  const scoped = snapshotIdentity(structuredClone(snapshot), 'phone-comparison');
  const images = mapNativeImageSources(
    scoped,
    (source) =>
      source.replace(/^\/api\/items\/[^/]+\/images\//, '/api/items/phone-comparison/images/'),
    { updateSourceType: true },
  );
  return comparable({ ...images, name: undefined, title: undefined } as NativeSnapshot);
}
function verifyImageOwners(snapshot: NativeSnapshot, itemId: string, expected: string[]) {
  const hashes = new Set<string>();
  mapNativeImageSources(snapshot, (source) => {
    const prefix = `/api/items/${itemId}/images/`;
    requireCondition(source.startsWith(prefix), 'published-image-owner-mismatch');
    hashes.add(source.slice(prefix.length));
    return source;
  });
  same([...hashes].sort(), expected.slice().sort(), 'published-image-set-mismatch');
}

/** Read the generation established by the physical opening; never initialize it out of band. */
export async function readPhoneOpenedCopy(
  driver: PhoneAcceptanceDriver,
  fixture: Pick<BrowserstackFixture, 'db' | 'read'>,
  copyId: string,
  href: string,
) {
  await driver.navigate(href);
  await driver.ready(false);
  const generation = fixture.db
    .prepare('SELECT unit_id FROM spinel_live_units WHERE item_id=?')
    .get(copyId);
  // CollaborationGenerations.active uses the item id until a rotated mapping exists.
  // This fallback still requires a native unit which the phone already opened.
  const copyUnitId = generation?.unit_id ?? copyId;
  requireCondition(
    typeof copyUnitId === 'string' &&
      Boolean(
        fixture.db.prepare('SELECT unit_id FROM spinel_sync_units WHERE unit_id=?').get(copyUnitId),
      ),
    'phone-copy-generation-unavailable',
  );
  return fixtureOperation(driver, () => fixture.read(copyId, copyUnitId));
}

export type PhoneAcceptanceCases = {
  workspace: WorkspaceStore;
  spaces: SpaceStore;
  rejectedFolder: WorkspaceItem;
  replacementFolder: WorkspaceItem;
  moveFolder: WorkspaceItem;
  uncached: WorkspaceItem;
  space: { id: string; name: string };
  spaceChild: { id: string; name: string };
  spaceMissing: { id: string; name: string };
  spaceFolder: { id: string; name: string };
  spacePrepared?: LocalCopy;
};

/** Initial disposable server seeding only. The launched phone prepares every private record through production UI. */
export function seedPhoneAcceptance(fixture: BrowserstackFixture): PhoneAcceptanceCases {
  const workspace = new WorkspaceStore(new AuthStore(fixture.db), { spacesEnabled: true });
  const spaces = new SpaceStore(workspace);
  const rejectedFolder = workspace.create(fixture.owner.id, {
    name: 'Phone shared destination',
    kind: 'folder',
    parentId: null,
  });
  workspace.share(fixture.owner.id, rejectedFolder.id, fixture.actor.id, 'editor');
  const replacementFolder = workspace.create(fixture.actor.id, {
    name: 'Phone recovered drafts',
    kind: 'folder',
    parentId: null,
  });
  const moveFolder = workspace.create(fixture.owner.id, {
    name: 'Phone moved originals',
    kind: 'folder',
    parentId: null,
  });
  const uncached = workspace.create(fixture.actor.id, {
    name: 'Phone online only',
    kind: 'sheet',
    parentId: null,
  });
  const space = spaces.createRoot(fixture.actor.id, {
    name: 'Phone field kit',
    parentId: null,
  }).space;
  const child = (name: string, kind: 'doc' | 'folder') =>
    spaces.createChild(fixture.actor.id, space.id, { name, kind, parentId: space.id }).item;
  return {
    workspace,
    spaces,
    rejectedFolder,
    replacementFolder,
    moveFolder,
    uncached,
    space,
    spaceChild: child('Phone prepared page', 'doc'),
    spaceMissing: child('Phone unprepared page', 'doc'),
    spaceFolder: child('Phone page destination', 'folder'),
  };
}

async function bodyIncludes(driver: PhoneAcceptanceDriver, text: string) {
  await until(
    driver,
    () => driver.execute('return document.body?.innerText || "";'),
    (value) => typeof value === 'string' && value.includes(text),
    'production-message-unavailable',
  );
}
/**
 * At phone width the file places are only in the Browse files drawer
 * (web/Rail.tsx); its Shared with me button closes the drawer (run 41736478986).
 * Every Shared with me visit goes through here.
 */
async function openSharedWithMe(driver: PhoneAcceptanceDriver) {
  await driver.click('button', 'Browse files');
  await driver.click('[role="dialog"] button', 'Shared with me');
}

/** Exported for its test: a phone reaches a shared folder through openSharedWithMe. */
export async function openFolder(
  driver: PhoneAcceptanceDriver,
  folder: { name: string },
  shared: boolean,
) {
  await driver.navigate('/');
  if (shared) await openSharedWithMe(driver);
  await driver.click('button', `${folder.name} Folder`);
  await until(
    driver,
    () =>
      driver.execute(
        `return [...document.querySelectorAll('h1,h2,h3')].some(node=>node.textContent.trim()===arguments[0]) && Boolean(document.querySelector('[role="list"][aria-label="Folder contents"]')) && [...document.querySelectorAll('button')].some(node=>node.textContent.trim()==='New' && !node.disabled);`,
        [folder.name],
      ),
    (value) => value === true,
    'cached-folder-not-ready',
  );
}

async function cachedFolder(
  driver: PhoneAcceptanceDriver,
  fixture: BrowserstackFixture,
  folder: WorkspaceItem,
) {
  await until(
    driver,
    () =>
      driver.executeAsync(
        `
    const [account,folder]=arguments;
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('spinel-offline-'+account);
      request.onupgradeneeded=()=>{request.transaction.abort();reject(new Error('missing'));};
      request.onerror=()=>reject(new Error('unavailable'));request.onsuccess=()=>resolve(request.result);});
    try {const request=database.transaction('meta','readonly').objectStore('meta').get('catalog');
      const catalog=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('read'));});
      return (catalog?.views?.[folder] || []).some(item=>item.id===folder && item.kind==='folder' && ['owner','editor','admin'].includes(item.access));
    } finally {database.close();}
  `,
        [fixture.actor.id, folder.id],
        'acceptance-cached-folder',
      ),
    (value) => value === true,
    'folder-not-durably-cached',
  );
}

/** Called online after all four existing image-backed downloads, inside the prerequisite bound. */
export async function preparePhoneAcceptance(
  driver: PhoneAcceptanceDriver,
  fixture: BrowserstackFixture,
  cases: PhoneAcceptanceCases,
) {
  requireCondition(
    fixture.items.length === 4 &&
      fixture.items
        .filter((item) => item.kind === 'doc')
        .every(
          (item) =>
            !('sheets' in item.baseline.snapshot) &&
            item.baseline.snapshot.documentStyle?.documentFlavor === 2,
        ),
    'fixture-modern-docs-unavailable',
  );
  const href = `/spaces/${cases.space.id}?item=${cases.spaceChild.id}`;
  await driver.navigate(href);
  await driver.ready(false);
  await prepareSpacePageOffline(
    {
      click: (selector, label) => driver.click(selector, label),
      execute: (script, args) => driver.execute(script, args),
      poll: (read, accepts, label, maximum) => until(driver, read, accepts, label, maximum),
      record: (stage, value) => driver.record(stage, value),
      failure: (code) => new Error(`capability-acceptance-${code}`),
      diagnose: driver.diagnose && ((work) => driver.diagnose!(work)),
      left: () => driver.remaining(Number.MAX_SAFE_INTEGER),
    },
    { kind: 'doc', name: cases.spaceChild.name },
  );
  await openFolder(driver, cases.replacementFolder, false);
  await cachedFolder(driver, fixture, cases.replacementFolder);
  await openFolder(driver, cases.rejectedFolder, true);
  await cachedFolder(driver, fixture, cases.rejectedFolder);
  cases.spacePrepared = await local(driver, fixture, cases.spaceChild.id);
  requireCondition(
    cases.spacePrepared.record?.bundle.spaceId === cases.space.id,
    'space-preparation-scope-mismatch',
  );
  await driver.record('acceptance-prepared-cases', {
    ordinary: fixture.items.map(({ id, kind, outcome }) => ({ id, kind, outcome })),
    space: { spaceId: cases.space.id, itemId: cases.spaceChild.id, href },
    cachedCreationFolders: [cases.replacementFolder.id, cases.rejectedFolder.id],
    uncachedItemId: cases.uncached.id,
    bounds: phoneAcceptanceLimits,
    boundsMeasured: false,
  });
}

type Draft = {
  id: string;
  unitId: string;
  kind: Kind;
  text: string;
  before: LocalCopy;
  expected: NativeSnapshot;
  rejected: boolean;
};

async function createDraft(
  driver: PhoneAcceptanceDriver,
  fixture: BrowserstackFixture,
  cases: PhoneAcceptanceCases,
  kind: Kind,
): Promise<Draft> {
  const rejected = kind === 'sheet';
  const folder = rejected ? cases.rejectedFolder : cases.replacementFolder;
  await openFolder(driver, folder, rejected);
  await driver.click('button', 'New');
  await driver.click('[role="menuitem"]', kind === 'sheet' ? 'Sheet' : 'Doc');
  const name = `Phone offline ${kind}`;
  const input = await driver.execute(
    `const dialog=[...document.querySelectorAll('[role="dialog"]')].find(node=>node.getBoundingClientRect().height>0);const label=dialog && [...dialog.querySelectorAll('label')].find(node=>node.textContent.trim()==='Name');return label?.querySelector('input') || null;`,
  );
  const id = elementId(input);
  await driver.command(`element/${id}/clear`, 'POST', {});
  await driver.command(`element/${id}/value`, 'POST', { text: name });
  await driver.click('[role="dialog"] button', 'Create');
  const itemId = await until(
    driver,
    () => driver.execute('return new URL(location.href).searchParams.get("item");'),
    (value) => typeof value === 'string' && uuid.test(value) && value !== folder.id,
    'created-item-url-unavailable',
  );
  requireCondition(typeof itemId === 'string', 'created-item-url-unavailable');
  await driver.ready(true);
  const blank = await local(driver, fixture, itemId);
  const creation = blank.record?.creation;
  requireCondition(
    creation?.request.itemId === itemId &&
      creation.request.kind === kind &&
      creation.request.parentId ===
        (rejected ? cases.rejectedFolder.id : cases.replacementFolder.id),
    'creation-request-mismatch',
  );
  requireCondition(
    !fixture.db.prepare('SELECT id FROM workspace_items WHERE id=?').get(itemId),
    'creation-published-offline',
  );
  const unitId = creation.request.unitId;
  const snapshot = blank.record?.outbox
    ? reconstructOffline(blank.record.outbox.checkpoint, kind)
    : blank.record!.bundle.snapshot;
  const text = kind === 'sheet' ? '953' : 'Phone953 ';
  const caret = await author(driver, { id: itemId, unitId, kind }, snapshot, text, true);
  const before = await until(
    driver,
    () => local(driver, fixture, itemId),
    (value) => pending(value.record?.outbox?.checkpoint),
    'created-edit-not-durable',
  );
  const expected = verifyRetainedEdit(before, {
    account: fixture.actor.id,
    item: itemId,
    unitId,
    kind,
  });
  await verifyAuthoredRecorded(driver, expected, snapshot, kind, text, caret);
  await assertNative(driver, unitId, expected);
  await driver.record('offline-created-draft', {
    itemId,
    unitId,
    kind,
    parentId: creation.request.parentId,
    requestSha256: digest(creation.request),
    checkpointSha256: digest(before.record!.outbox!.checkpoint),
    nativeSha256: digest(comparable(expected)),
    serverItemAbsent: true,
  });
  return { id: itemId, unitId, kind, text, before, expected, rejected };
}

/** Records a bounded path-only difference list before a content mismatch fails. */
async function verifyAuthoredRecorded(
  driver: PhoneAcceptanceDriver,
  ...args: Parameters<typeof verifyAuthoredContent>
) {
  try {
    verifyAuthoredContent(...args);
  } catch (error) {
    if (error instanceof ContentMismatch)
      await driver.record('authored-content-differences', { kind: args[2], ...error.report });
    throw error;
  }
}

export function verifyAuthoredContent(
  snapshot: NativeSnapshot,
  baseline: NativeSnapshot,
  kind: Kind,
  text: string,
  caret?: number,
) {
  if (kind === 'sheet') {
    requireCondition('sheets' in snapshot && 'sheets' in baseline, 'authored-kind-mismatch');
    requireCondition(
      snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[0]?.[0]?.v === Number(text),
      'authored-sheet-value-mismatch',
    );
    const expected = structuredClone(baseline);
    const sheet = expected.sheets[expected.sheetOrder[0]];
    sheet.cellData ??= {};
    sheet.cellData[0] ??= {};
    sheet.cellData[0][0] = { v: Number(text), t: 2 };
    sameContent(comparable(snapshot), comparable(expected), 'authored-sheet-changed-other-content');
  } else {
    requireCondition(
      !('sheets' in snapshot) && !('sheets' in baseline) && typeof caret === 'number',
      'authored-kind-mismatch',
    );
    const before = baseline.body?.dataStream;
    requireCondition(
      typeof before === 'string' &&
        snapshot.body?.dataStream === before.slice(0, caret) + text + before.slice(caret),
      'authored-doc-value-mismatch',
    );
    const expected = structuredClone(baseline);
    const edits: TextXAction[] = [
      ...(caret > 0 ? [{ t: TextXActionType.RETAIN as const, len: caret }] : []),
      { t: TextXActionType.INSERT, len: text.length, body: { dataStream: text } },
    ];
    expected.body = TextX.apply(expected.body!, edits);
    // The independent public TextX transform shifts every body/image/range
    // anchor. Comparing the entire Doc prevents a matching text string from
    // blessing lost images, paragraphs, notes or unrelated native metadata.
    sameContent(comparable(snapshot), comparable(expected), 'authored-doc-changed-other-content');
  }
}

/** Continues only after the selected context's first offline reopen has passed. */
export async function runPhoneAcceptance(
  driver: PhoneAcceptanceDriver,
  fixture: BrowserstackFixture,
  cases: PhoneAcceptanceCases,
  scope: CapabilityScope,
) {
  const selection = capabilityScopeDefinition(readCapabilityScope(scope));
  requireCondition(selection.authored && selection.browser, 'scope-not-authored');
  const ordinaryTab = selection.context === 'ordinary-tab';
  const reopenName = ordinaryTab ? 'page-reload' : 'restart';
  const originals = new Map<string, unknown>();
  const retained = new Map<string, LocalCopy>();
  const expected = new Map<string, NativeSnapshot>();
  const originalImages = new Map(
    fixture.items.map((item) => [item.id, fixture.imageRows(item.id)]),
  );
  const revisionCounts = new Map(
    fixture.items.map((item) => [
      item.id,
      Number(
        fixture.db
          .prepare('SELECT count(*) AS n FROM spinel_sync_revisions WHERE unit_id=?')
          .get(item.unitId)!.n,
      ),
    ]),
  );
  const recoveryReceipts = () =>
    fixture.db
      .prepare('SELECT * FROM workspace_offline_recoveries WHERE user_id=? ORDER BY recovery_id')
      .all(fixture.actor.id);
  const creationReceipts = () =>
    fixture.db
      .prepare('SELECT * FROM workspace_offline_creations WHERE user_id=? ORDER BY item_id')
      .all(fixture.actor.id);
  const completed = new Map<string, DesktopSnapshot>();
  driver.stage('acceptance-native-offline-edits', phoneAcceptanceLimits.edits);
  // A server-side outage independently fences remote-edit setup and stays in
  // addition to the already-observed provider no-network control.
  await fixtureOperation(driver, () => fixture.setOffline(true));
  await fixtureOperation(driver, () => fixture.verifyDisconnected());
  requireCondition(cases.spacePrepared?.record, 'space-preparation-missing');
  const spaceAfterFirstRestart = await local(driver, fixture, cases.spaceChild.id);
  same(
    spaceAfterFirstRestart.record?.bundle,
    cases.spacePrepared.record.bundle,
    `space-first-${reopenName}-bundle-mismatch`,
  );
  same(
    spaceAfterFirstRestart.images,
    cases.spacePrepared.images,
    `space-first-${reopenName}-images-mismatch`,
  );
  cases.spacePrepared = spaceAfterFirstRestart;
  for (const item of fixture.items) {
    await driver.navigate(itemPath(item.id));
    await driver.ready(true);
    const text = item.kind === 'sheet' ? '731' : 'Phone731 ';
    const caret = await author(driver, item, item.baseline.snapshot, text);
    const captured = await until(
      driver,
      () => local(driver, fixture, item.id),
      (value) => pending(value.record?.outbox?.checkpoint),
      'native-edit-not-durable',
    );
    const snapshot = verifyRetainedEdit(captured, {
      account: fixture.actor.id,
      item: item.id,
      unitId: item.unitId,
      kind: item.kind,
    });
    await verifyAuthoredRecorded(driver, snapshot, item.baseline.snapshot, item.kind, text, caret);
    verifyImages(captured, imageHashes(fixture, item.id));
    await assertNative(driver, item.unitId, snapshot);
    same(
      await fixtureOperation(driver, () => fixture.read(item.id, item.unitId)),
      item.baseline,
      'server-changed-while-offline',
    );
    retained.set(item.id, captured);
    expected.set(item.id, snapshot);
    await driver.record('durable-native-offline-edit', {
      itemId: item.id,
      kind: item.kind,
      outcome: item.outcome,
      checkpointSha256: digest(captured.record!.outbox!.checkpoint),
      nativeSha256: digest(comparable(snapshot)),
      images: captured.images,
      serverUnchanged: true,
    });
  }

  driver.stage('acceptance-offline-creation', phoneAcceptanceLimits.creation);
  const drafts = [
    await createDraft(driver, fixture, cases, 'sheet'),
    await createDraft(driver, fixture, cases, 'doc'),
  ];
  same(creationReceipts(), [], 'offline-creation-receipt-present');
  driver.stage(
    ordinaryTab ? 'acceptance-pending-page-reload' : 'acceptance-pending-native-restart',
    phoneAcceptanceLimits.restart,
  );
  await driver.restart();
  for (const item of [...fixture.items, ...drafts]) {
    const before = retained.get(item.id) ?? drafts.find((draft) => draft.id === item.id)!.before;
    const restored = await local(driver, fixture, item.id);
    same(restored, before, `pending-${reopenName}-record-mismatch`);
    await driver.navigate(itemPath(item.id));
    await driver.ready(true);
    const actual = await local(driver, fixture, item.id);
    same(
      actual.record?.outbox?.checkpoint,
      before.record?.outbox?.checkpoint,
      'pending-reopen-checkpoint-mismatch',
    );
    const snapshot =
      expected.get(item.id) ?? drafts.find((draft) => draft.id === item.id)!.expected;
    const name = `${item.kind}-${'outcome' in item ? item.outcome : 'created'}-pending-reopened`;
    let evidence: { native: Row; rendering?: Row };
    if ('outcome' in item) {
      evidence = await assertPhoneImageCheckpoint(driver, item, snapshot, name);
    } else {
      const native = await assertNative(driver, item.unitId, snapshot);
      await driver.screenshot(name);
      evidence = { native };
    }
    await driver.record(
      ordinaryTab ? 'pending-page-reload-retained' : 'pending-native-restart-retained',
      {
        reopenOperation: ordinaryTab ? 'cold-page-reload' : 'native-termination-and-home-relaunch',
        nativeAppRestart: ordinaryTab ? 'not-observed-by-this-scope' : 'observed',
        itemId: item.id,
        kind: item.kind,
        ...evidence,
        checkpointSha256: digest(actual.record!.outbox!.checkpoint),
        images: actual.images,
      },
    );
  }
  requireCondition(cases.spacePrepared?.record, 'space-preparation-missing');
  same(
    await local(driver, fixture, cases.spaceChild.id),
    cases.spacePrepared,
    `space-first-${reopenName}-mismatch`,
  );

  driver.stage('acceptance-core-reconnect', phoneAcceptanceLimits.reconnect);
  await driver.navigate('/');
  for (const item of fixture.items.filter((entry) => entry.outcome === 'conflict')) {
    const remote = await fixtureOperation(driver, () => fixture.remoteEdit(item));
    originals.set(item.id, fixture.originalState(item));
    await driver.record('conflicting-live-edit', {
      itemId: item.id,
      beforeRevision: remote.beforeRevision,
      afterRevision: remote.after.revision,
      mutationId: remote.mutationId,
    });
  }
  cases.workspace.share(fixture.owner.id, cases.rejectedFolder.id, fixture.actor.id, null);
  same(recoveryReceipts(), [], 'recovery-present-before-reconnect');
  await driver.network(false);
  const copiedIds = new Set<string>();
  for (const item of fixture.items) {
    await driver.navigate(itemPath(item.id));
    if (item.outcome === 'normal') {
      await saved(driver, 'Synced.');
      const committed = await fixtureOperation(driver, () => fixture.read(item.id, item.unitId));
      requireCondition(
        committed.revision === item.baseline.revision + 1,
        'normal-replay-revision-mismatch',
      );
      requireCondition(
        Number(
          fixture.db
            .prepare('SELECT count(*) AS n FROM spinel_sync_revisions WHERE unit_id=?')
            .get(item.unitId)!.n,
        ) ===
          revisionCounts.get(item.id)! + 1,
        'normal-replay-count-mismatch',
      );
      same(
        comparable(committed.snapshot),
        comparable(expected.get(item.id)!),
        'normal-server-snapshot-mismatch',
      );
      same(
        fixture.imageRows(item.id),
        originalImages.get(item.id),
        'normal-server-images-mismatch',
      );
      const clean = await local(driver, fixture, item.id);
      requireCondition(
        clean.record?.outbox &&
          !pending(clean.record.outbox.checkpoint) &&
          clean.record.outbox.checkpoint.revision === committed.revision,
        'normal-outbox-not-clean',
      );
      await assertNative(driver, item.unitId, committed.snapshot);
      completed.set(item.id, committed);
      await driver.record('normal-reconnect-exact-content-once', {
        itemId: item.id,
        revision: committed.revision,
        snapshotSha256: digest(comparable(committed.snapshot)),
        revisionCount: revisionCounts.get(item.id)! + 1,
      });
    } else {
      await until(
        driver,
        () =>
          driver.execute(
            `return [...document.querySelectorAll('button')].some(node=>node.getAttribute('aria-label')==='Save details: Needs attention');`,
          ),
        (value) => value === true,
        'conflict-attention-unavailable',
      );
      await driver.click('button', 'Save details: Needs attention');
      const href = await until(
        driver,
        () =>
          driver.execute(
            `return [...document.querySelectorAll('[role="dialog"] a')].find(node=>node.textContent.trim()==='Open copy')?.getAttribute('href') || '';`,
          ),
        (value) => typeof value === 'string' && value.length > 0,
        'published-copy-unavailable',
      );
      const copyId = new URL(String(href), fixture.origin).searchParams.get('item');
      requireCondition(
        copyId && uuid.test(copyId) && copyId !== item.id && !copiedIds.has(copyId),
        'published-copy-identity-invalid',
      );
      copiedIds.add(copyId);
      same(fixture.originalState(item), originals.get(item.id), 'conflict-original-changed');
      const metadata = fixture.recoveryMetadata(copyId);
      requireCondition(
        metadata.owner_id === fixture.actor.id &&
          metadata.parent_id === null &&
          metadata.space_id === null &&
          metadata.kind === item.kind &&
          String(metadata.name).startsWith(`${item.name} (offline copy, `),
        'published-copy-metadata-mismatch',
      );
      // The phone opens/prepares the copy through production first. The desktop
      // readRecovered helper performs a collaboration POST, so it is not an
      // observation-only server read at this physical initialization boundary.
      const copied = await readPhoneOpenedCopy(driver, fixture, copyId, String(href));
      same(
        copiedContent(copied.snapshot),
        copiedContent(expected.get(item.id)!),
        'conflict-copy-content-mismatch',
      );
      verifyImageOwners(
        copied.snapshot,
        copyId,
        originalImages.get(item.id)!.map(({ id }) => id),
      );
      same(fixture.imageRows(copyId), originalImages.get(item.id), 'conflict-copy-images-mismatch');
      await until(
        driver,
        () => local(driver, fixture, item.id),
        (value) => value.record === null && value.images.length === 0,
        'recovered-original-still-downloaded',
      );
      const evidence = await assertPhoneImageCheckpoint(
        driver,
        { unitId: copied.unitId, kind: item.kind },
        copied.snapshot,
        `${item.kind}-published-offline-copy`,
      );
      completed.set(copyId, copied);
      await driver.record('conflict-copy-preserves-original', {
        itemId: item.id,
        copyId,
        unitId: copied.unitId,
        revision: copied.revision,
        snapshotSha256: digest(copiedContent(copied.snapshot)),
        imageHashes: imageHashes(fixture, copyId),
        ...evidence,
      });
    }
  }
  same(
    recoveryReceipts()
      .map((receipt) => String(receipt.item_id))
      .sort(),
    [...copiedIds].sort(),
    'recovery-receipt-count-mismatch',
  );
  for (const draft of drafts) {
    await driver.navigate(itemPath(draft.id));
    if (draft.rejected) {
      await saved(driver, 'Needs attention');
      const rejected = await until(
        driver,
        () => local(driver, fixture, draft.id),
        (value) => value.record?.creation?.canRelocate === true,
        'rejected-folder-not-recoverable',
      );
      same(
        rejected.record?.creation?.request,
        draft.before.record?.creation?.request,
        'rejected-creation-request-changed',
      );
      same(
        rejected.record?.outbox?.checkpoint,
        draft.before.record?.outbox?.checkpoint,
        'rejected-creation-edit-changed',
      );
      requireCondition(
        !fixture.db.prepare('SELECT id FROM workspace_items WHERE id=?').get(draft.id),
        'rejected-creation-published',
      );
      requireCondition(
        !creationReceipts().some((receipt) => receipt.item_id === draft.id),
        'rejected-creation-receipt-present',
      );
      await driver.click('button', 'Back to files');
      await driver.navigate('/');
      await driver.click('button', `More actions for Phone offline ${draft.kind}`);
      await driver.click('[role="menuitem"]', 'Choose another folder…');
      const option = await driver.execute(
        `const select=document.querySelector('[role="dialog"] select');return select ? [...select.options].find(option=>option.value===arguments[0]) || null : null;`,
        [cases.replacementFolder.id],
      );
      await driver.command(`element/${elementId(option)}/click`, 'POST', {});
      await driver.click('[role="dialog"] button', 'Choose folder');
      await driver.navigate(itemPath(draft.id));
    }
    await saved(driver, 'Synced.');
    const stored = fixture.recoveryMetadata(draft.id);
    requireCondition(
      stored.owner_id === fixture.actor.id &&
        stored.parent_id === cases.replacementFolder.id &&
        stored.kind === draft.kind,
      'created-item-metadata-mismatch',
    );
    const committed = await fixtureOperation(driver, () => fixture.read(draft.id, draft.unitId));
    same(
      comparable(committed.snapshot),
      comparable(draft.expected),
      'created-server-snapshot-mismatch',
    );
    const clean = await local(driver, fixture, draft.id);
    requireCondition(
      clean.record && !clean.record.creation && !pending(clean.record.outbox?.checkpoint),
      'created-item-not-clean',
    );
    const receipts = creationReceipts().filter((receipt) => receipt.item_id === draft.id);
    requireCondition(
      receipts.length === 1 &&
        receipts[0].user_id === fixture.actor.id &&
        receipts[0].owner_id === fixture.actor.id &&
        receipts[0].unit_id === draft.unitId,
      'creation-receipt-mismatch',
    );
    await assertNative(driver, draft.unitId, committed.snapshot);
    completed.set(draft.id, committed);
    await driver.record('offline-creation-published-once', {
      itemId: draft.id,
      kind: draft.kind,
      recoveredRejectedFolder: draft.rejected,
      parentId: stored.parent_id,
      revision: committed.revision,
      snapshotSha256: digest(comparable(committed.snapshot)),
    });
  }
  requireCondition(creationReceipts().length === 2, 'creation-total-mismatch');

  driver.stage('acceptance-stable-links-and-negatives', phoneAcceptanceLimits.links);
  const moved = fixture.items.find((item) => item.kind === 'sheet' && item.outcome === 'normal')!;
  const renamed = `${moved.name} renamed`;
  cases.workspace.update(fixture.owner.id, moved.id, {
    name: renamed,
    parentId: cases.moveFolder.id,
  });
  await driver.navigate(itemPath(moved.id));
  await driver.ready(false);
  await bodyIncludes(driver, renamed);
  await assertNative(driver, moved.unitId, completed.get(moved.id)!.snapshot);
  cases.spaces.updateChild(fixture.actor.id, cases.space.id, cases.spaceChild.id, {
    name: 'Phone prepared page renamed',
    parentId: cases.spaceFolder.id,
  });
  const spaceHref = `/spaces/${cases.space.id}?item=${cases.spaceChild.id}`;
  await driver.navigate(spaceHref);
  await driver.ready(false);
  await bodyIncludes(driver, 'Phone prepared page renamed');
  const spaceBefore = await local(driver, fixture, cases.spaceChild.id);
  requireCondition(
    spaceBefore.record?.bundle.spaceId === cases.space.id,
    'renamed-space-scope-mismatch',
  );
  const removed = fixture.items.find((item) => item.kind === 'doc' && item.outcome === 'normal')!;
  await driver.navigate('/');
  await openSharedWithMe(driver);
  await driver.click('button', `More actions for ${removed.name}`);
  await driver.click('[role="menuitem"]', 'Remove from device');
  await bodyIncludes(driver, `${removed.name} was removed from this device.`);
  requireCondition(
    (await local(driver, fixture, removed.id)).record === null,
    'removed-item-still-downloaded',
  );
  await driver.network(true);
  await driver.navigate(itemPath(moved.id));
  await driver.ready(true);
  await assertNative(driver, moved.unitId, completed.get(moved.id)!.snapshot);
  await driver.navigate(spaceHref);
  await driver.ready(true);
  const spaceNative = await nativeSnapshot(driver, spaceBefore.record!.bundle.unitId);
  same(
    comparable(spaceNative!.snapshot as NativeSnapshot),
    comparable(
      spaceBefore.record!.outbox
        ? reconstructOffline(spaceBefore.record!.outbox.checkpoint, 'doc')
        : spaceBefore.record!.bundle.snapshot,
    ),
    'renamed-space-native-mismatch',
  );
  for (const negative of [
    { id: cases.uncached.id, reason: 'never-downloaded' },
    { id: removed.id, reason: 'removed-from-device' },
  ]) {
    await driver.navigate(itemPath(negative.id));
    await until(
      driver,
      () =>
        driver.execute(
          `return {body:document.body?.innerText || '',editors:document.querySelectorAll('.univer-container').length,item:new URL(location.href).searchParams.get('item')};`,
        ),
      (value) => {
        const state = row(value);
        return (
          state.item === negative.id &&
          state.editors === 0 &&
          /needs a connection|not available offline|not downloaded|not been prepared|not saved on this device/i.test(
            String(state.body),
          )
        );
      },
      'unprepared-item-opened',
    );
    requireCondition(
      (await local(driver, fixture, negative.id)).record === null,
      'negative-created-device-copy',
    );
    await driver.record('offline-item-negative', {
      itemId: negative.id,
      reason: negative.reason,
      noNativeEditor: true,
    });
  }
  const missingHref = `/spaces/${cases.space.id}?item=${cases.spaceMissing.id}`;
  await driver.navigate(missingHref);
  await bodyIncludes(
    driver,
    'This page needs a connection. It has not been prepared in this Space on this device.',
  );
  const missing = row(
    await driver.execute(
      `return {path:location.pathname, item:new URL(location.href).searchParams.get('item'),editors:document.querySelectorAll('.univer-container').length};`,
    ),
  );
  same(
    missing,
    { path: `/spaces/${cases.space.id}`, item: cases.spaceMissing.id, editors: 0 },
    'explicit-space-child-substituted',
  );
  await driver.record('stable-links-and-negative-cases', {
    ordinary: {
      itemId: moved.id,
      href: itemPath(moved.id),
      renamed,
      parentId: cases.moveFolder.id,
    },
    space: {
      spaceId: cases.space.id,
      itemId: cases.spaceChild.id,
      href: spaceHref,
      parentId: cases.spaceFolder.id,
    },
    unavailableExplicitChild: missing,
  });

  driver.stage('acceptance-repeated-reconnect', phoneAcceptanceLimits.repeat);
  const recoveryBefore = recoveryReceipts();
  const creationBefore = creationReceipts();
  await driver.network(false);
  for (const [id, committed] of completed) {
    await driver.navigate(itemPath(id));
    await driver.ready(false);
    same(
      await fixtureOperation(driver, () => fixture.read(id, committed.unitId)),
      committed,
      'repeated-reconnect-changed-server',
    );
  }
  for (const item of fixture.items.filter((entry) => entry.outcome === 'conflict'))
    same(
      fixture.originalState(item),
      originals.get(item.id),
      'repeated-reconnect-changed-original',
    );
  same(recoveryReceipts(), recoveryBefore, 'repeated-reconnect-duplicated-recovery');
  same(creationReceipts(), creationBefore, 'repeated-reconnect-duplicated-creation');
  await driver.record(`acceptance-${scope}-complete`, {
    scope,
    browser: selection.browser,
    launchContext: selection.context,
    reopenOperation: ordinaryTab ? 'cold-page-reload' : 'native-termination-and-home-relaunch',
    nativeAppRestart: ordinaryTab ? 'not-observed-by-this-scope' : 'observed',
    nativeRestartAlternative: ordinaryTab ? 'scripts/ci/desktop-offline.ts' : null,
    normalItems: fixture.items.filter((item) => item.outcome === 'normal').map((item) => item.id),
    conflictCopies: [...copiedIds],
    creations: drafts.map(({ id, kind, rejected }) => ({
      id,
      kind,
      recoveredRejectedFolder: rejected,
    })),
    stableLinkAndNegativeCases: 'observed',
    repeatedReconnection: 'exact-server-and-receipt-equality',
    ordinaryBrowserTabAcceptance: ordinaryTab ? 'observed' : 'not-run-by-this-scope',
    installedContextAcceptance: ordinaryTab ? 'not-run-by-this-scope' : 'observed',
    otherPhysicalLanes: 'not-run-by-this-scope',
  });
}
