import { createHash } from 'node:crypto';
import { cleanProviderText as clean } from './browserstack.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`capability-${code}`);
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
// Chrome's ⋮ button, by label in either spelling (an en-GB phone says
// "Customise", run 41733180670) or by its resource id, which Appium reports as
// `com.android.chrome:id/menu_button`.
export const chromeMenuLabel =
  /^(?:More options|Menu|Open menu|Customi[sz]e and control Google Chrome)$|(?:^|[:/])menu_button$/i;
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

export type NativeAction = {
  label: string;
  type: string;
  sourceSha256: string;
  target?: ReturnType<typeof nativeControlDiagnostic>;
  selectorSha256?: string;
};
type NativeControlObservation = {
  sourceSha256: string;
  labels: {
    type: string;
    attribute: string;
    value: string;
    state: ReturnType<typeof nativeControlState>;
  }[];
  pinCandidates: {
    candidate: ReturnType<typeof nativeControlDiagnostic>;
    ancestors: ReturnType<typeof nativeControlDiagnostic>[];
    omittedAncestors: number;
  }[];
  installCandidates: ReturnType<typeof installCandidateDiagnostics>;
};
/** Session transport, lane bounds and journal persistence stay with the caller. */
export interface NativeControlDriver {
  readSource(): Promise<unknown>;
  poll<T>(read: () => Promise<T>, accepts: (value: T) => boolean, label: string): Promise<T>;
  click(selector: string): Promise<void>;
  record(observation: NativeControlObservation): Promise<void>;
  recordAction(action: NativeAction): Promise<void>;
  redact(value: string): string;
}

/** Native controls for one device session, with no replay of attempted confirmations. */
export function createNativeTap(driver: NativeControlDriver) {
  async function controls() {
    const source = await driver.readSource();
    const parsed = nativeControls(source);
    await driver.record({
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
    driver.poll(
      async () => {
        const observed = await controls();
        try {
          return {
            source: observed,
            match: matchingNativeConfirmation(observed.parsed),
            pending: false,
          };
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== 'capability-native-pin-confirmation-unavailable'
          )
            throw error;
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
    } else if (confirmation) {
      // Opening the install menu can return before its first confirmation is
      // present. Absence is pending here, never completed installation. Observe
      // only; retain the same poll/lane limits and never repeat the menu action.
      ({ source, match } = await driver.poll(
        async () => {
          const observed = await controls();
          return { source: observed, match: matchingNativeConfirmation(observed.parsed) };
        },
        (observed) => observed.match !== null,
        'native-first-confirmation-unavailable',
      ));
    } else {
      source = await controls();
      match = safariInstall
        ? matchingSafariHomeScreen(source.parsed)
        : matchingNativeControl(source.parsed, pattern);
    }
    if (match) {
      const { control, label, selector } = match;
      if (confirmation) {
        requireCondition(!confirmationSelectors.has(selector), 'native-confirmation-unchanged');
        confirmationSelectors.add(selector);
      }
      await driver.click(selector);
      await driver.recordAction({
        label: driver.redact(clean(label)),
        type: control.type,
        sourceSha256: source.sourceSha256,
        target: nativeControlDiagnostic(control),
        selectorSha256: hash(selector),
      });
      return true;
    }
    requireCondition(!required, 'native-control-unavailable');
    return false;
  }
  return {
    tap,
    async waitForConfirmationTransition() {
      if (confirmationSelectors.size) await observeConfirmationTransition();
    },
  };
}
