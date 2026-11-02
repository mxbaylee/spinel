import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { readAdmissionPolicy, type ReservationIdentity } from './browserstack-admission.ts';
import {
  capabilityOutcome,
  chromeItemNavigationScript,
  installMenuLabel,
  installCandidateDiagnostics,
  itemReadinessScript,
  itemReadinessSatisfied,
  launchEnvironmentDiagnostic,
  launchedWindow,
  matchingNativeConfirmation,
  matchingNativeControl,
  matchingSafariHomeScreen,
  nativeControls,
  navigateChromeItem,
  normalizedPngScreenshot,
  observeBrowserTask,
  openNativeShare,
  preparedCapabilityJournal,
  readPreparedCapabilityJournal,
  readCapabilityScope,
  runCapability,
  runCapabilityLane,
  screenshotResponseShape,
  screenshotLimits,
  verifyCapabilityAdmission,
  verifyLaunchedBrowser,
  verifyTransportProbe,
  withCapabilityAdmission,
  type CapabilityResult,
} from './browserstack-capability.ts';
import { clientFor } from './browserstack.ts';

const now = Date.parse('2026-11-01T18:01:00.000Z');
const identity: ReservationIdentity = {
  runId: '555',
  attempt: '1',
  sourceSha: 'a'.repeat(40),
  testedSha: 'b'.repeat(40),
};
const sessionId = 'c'.repeat(40);
const target = { browser: 'chrome', device: 'Google Pixel 10', osVersion: '16' } as const;
// A complete 1x1 RGBA PNG, including valid IHDR/IDAT/IEND chunks and CRCs.
const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQTl/3HwAEIQI43iG0hQAAAABJRU5ErkJggg==';
function admission() {
  const policy = readAdmissionPolicy(
    JSON.parse(
      readFileSync(
        new URL('../../docs/implementation/SPN-090-budget-assumptions.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const reservation = {
    ...identity,
    id: `${identity.runId}-${identity.attempt}-${identity.sourceSha}`,
    policySha256: createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
    seconds: 900 * policy.chargedSecondsPerElapsedSecond,
    reservedAt: '2026-11-01T18:00:00.000Z',
    baselineSessionIds: [],
    sessionIds: [],
    status: 'reserved',
    uncertainAllocation: false,
    finishedAt: null,
    reconciledAt: null,
  };
  const admissionState = { schemaVersion: 1, reservations: [reservation] };
  const manifest = {
    schemaVersion: 2,
    ...identity,
    policy,
    reservation,
    admissionState,
    allocationAllowed: true,
    persistence: {
      status: 'verified',
      commit: 'd'.repeat(40),
      url: 'https://github.com/mxbaylee/spinel/commit/' + 'd'.repeat(40),
    },
  };
  // The durable accounting envelope deliberately keeps report policy under latest.
  const durable = { schemaVersion: 2, ledger: {}, admissionState, latest: { policy } };
  return structuredClone({ manifest, durable, reservation });
}

test('admission matches the current durable accounting envelope before invoking a provider action', async () => {
  const { manifest, durable, reservation } = admission();
  const calls: string[] = [];
  const result = await withCapabilityAdmission(
    manifest,
    identity,
    async () => {
      calls.push('ledger-read');
      return durable;
    },
    async (verified) => {
      calls.push('provider-action');
      return verified;
    },
    now,
  );
  assert.deepEqual(result, reservation);
  assert.deepEqual(calls, ['ledger-read', 'provider-action']);
});

test('wrong run, stale, missing, changed-policy and consumed admissions all deny before provider calls', async () => {
  const cases = [
    (value: ReturnType<typeof admission>) => {
      value.manifest.attempt = '2';
    },
    (value: ReturnType<typeof admission>) => {
      value.manifest.allocationAllowed = false;
    },
    (value: ReturnType<typeof admission>) => {
      value.manifest.persistence.status = 'failed';
    },
    (value: ReturnType<typeof admission>) => {
      value.manifest.reservation.seconds += 1;
    },
    (value: ReturnType<typeof admission>) => {
      value.durable.admissionState.reservations = [];
    },
    (value: ReturnType<typeof admission>) => {
      value.durable.latest.policy.safetyReserveSeconds += 1;
    },
    (value: ReturnType<typeof admission>) => {
      value.durable.admissionState.reservations[0].status = 'held';
    },
    (value: ReturnType<typeof admission>) => {
      value.manifest.reservation.reservedAt = '2026-10-30T18:00:00.000Z';
    },
  ];
  for (const change of cases) {
    const value = admission();
    change(value);
    let providerCalls = 0;
    await assert.rejects(
      withCapabilityAdmission(
        value.manifest,
        identity,
        async () => value.durable,
        async () => {
          providerCalls++;
        },
        now,
      ),
    );
    assert.equal(providerCalls, 0);
  }
  const { manifest, durable } = admission();
  assert.throws(
    () => verifyCapabilityAdmission(manifest, durable, identity, now + 25 * 60 * 60 * 1000),
    /capability-admission-stale/,
  );
  assert.throws(() =>
    verifyCapabilityAdmission(manifest, durable, { ...identity, testedSha: 'e'.repeat(40) }, now),
  );
});

test('native XML retains unavailable and unlabeled parents while matching only available exact controls', () => {
  const controls = nativeControls(
    '<hierarchy><node text="Install &amp; open" content-desc="Add to Home screen" enabled="true"/><node text="Spinel" visible="false"/><XCUIElementTypeButton label="Add" enabled="true"/></hierarchy>',
  );
  assert.equal(controls.length, 4);
  assert.equal(controls[1].attributes.text, 'Install & open');
  assert.equal(controls[1].attributes['content-desc'], 'Add to Home screen');
  assert.equal(controls[1].parent, controls[0]);
  assert.equal(controls[2].attributes.visible, 'false');
  assert.equal(controls[3].type, 'XCUIElementTypeButton');
  assert.equal(matchingNativeControl(controls, /^Spinel$/), null);
  assert.throws(() => nativeControls({ source: 'not XML' }), /capability-native-source-invalid/);
  for (const malformed of [
    '<hierarchy><node text="Add"/></wrong>',
    '<hierarchy><node text="Add"/>',
    '<hierarchy><node text="Add" enabled="true" enabled="false"/></hierarchy>',
    '<hierarchy><node text="unterminated/></hierarchy>',
    '<hierarchy><node invalid/></hierarchy>',
    '<hierarchy><!-- unfinished',
  ])
    assert.throws(() => nativeControls(malformed), /capability-native-source-invalid/);
});

test('the observed Chrome universal-install label is selected from native XML without accepting unrelated text', () => {
  const controls = nativeControls(
    '<hierarchy><node text="Install and create shortcut" visible="false"/><node text="New tab"/><node text="Install and create shortcut" resource-id="com.android.chrome:id/menu_item_text" enabled="true"/></hierarchy>',
  );
  const selected = matchingNativeControl(controls, installMenuLabel);
  assert.equal(selected?.label, 'Install and create shortcut');
  assert.equal(selected?.attribute, 'text');
  assert.equal(selected?.control.attributes['resource-id'], 'com.android.chrome:id/menu_item_text');
  assert.equal(
    selected?.selector,
    "//*[name()='node' and @text='Install and create shortcut' and not(@enabled='false') and not(@visible='false') and not(@displayed='false') and @resource-id='com.android.chrome:id/menu_item_text']",
  );
  assert.equal(
    matchingNativeControl(
      nativeControls('<node text="Do not install this app"/>'),
      installMenuLabel,
    ),
    null,
  );
  assert.equal(
    matchingNativeConfirmation(
      nativeControls(
        '<android.widget.Button text="Create shortcut"/><android.widget.Button text="Install"/>',
      ),
    )?.label,
    'Install',
  );
  assert.equal(
    matchingNativeConfirmation(
      nativeControls(
        '<android.widget.Button text="Install" enabled="false"/><android.widget.Button text="Create shortcut"/>',
      ),
    )?.label,
    'Create shortcut',
  );
  assert.equal(
    matchingNativeConfirmation(
      nativeControls('<android.widget.Button text="Cancel"/><android.widget.Button text="Add"/>'),
    )?.label,
    'Add',
  );
});

const chromeConfirmationXML = `<hierarchy>
  <android.widget.TextView class="android.widget.TextView" text="Create shortcut" resource-id="com.android.chrome:id/title" clickable="false" enabled="true"/>
  <android.widget.ImageView content-desc="Spinel" resource-id="com.android.chrome:id/icon"/>
  <android.widget.EditText text="Spinel" resource-id="com.android.chrome:id/shortcut_name"/>
  <android.widget.Button class="android.widget.Button" text="Cancel" resource-id="com.android.chrome:id/negative_button" clickable="true" enabled="true"/>
  <android.widget.Button class="android.widget.Button" text="Add" resource-id="com.android.chrome:id/positive_button" clickable="true" enabled="true"/>
</hierarchy>`;
const pinText =
  '<android.widget.TextView text="Add to home screen" clickable="false" enabled="true" displayed="true"/>';
const pinTarget = `<android.view.View clickable="true" enabled="true" displayed="true"><android.view.View enabled="true" displayed="true">${pinText}</android.view.View></android.view.View>`;
// The fourth run proved the label is not clickable but retained no hierarchy.
// This conditional fixture places the clickable widget-details entry beside
// the Add path to prove that a sibling cannot supply the missing parent action.
const pinPanel = (
  content: string,
) => `<android.widget.FrameLayout resource-id="com.google.android.apps.nexuslauncher:id/add_item_drag_layer" clickable="false" enabled="true" displayed="true">
  <android.view.View resource-id="com.android.launcher3.widgetpicker:id/pin_widgets_catalog" clickable="false" enabled="true" displayed="true">
    <android.view.View resource-id="com.android.launcher3.widgetpicker:id/widget_details" clickable="true" enabled="true" displayed="true"><android.widget.TextView text="Spinel"/></android.view.View>
    ${content}
  </android.view.View>
</android.widget.FrameLayout>`;
const launcherPinConfirmationXML = pinPanel(pinTarget);

test('Chrome confirmation selects the observed Add button rather than the Create shortcut title or name field', () => {
  const selected = matchingNativeConfirmation(nativeControls(chromeConfirmationXML));
  assert.equal(selected?.label, 'Add');
  assert.equal(selected?.control.type, 'android.widget.Button');
  assert.equal(selected?.attribute, 'text');
  assert.equal(
    selected?.control.attributes['resource-id'],
    'com.android.chrome:id/positive_button',
  );
  assert.ok(selected?.selector.includes("name()='android.widget.Button'"));
  assert.ok(selected?.selector.includes("@resource-id='com.android.chrome:id/positive_button'"));
  assert.ok(selected?.selector.includes("@class='android.widget.Button'"));
  assert.ok(selected?.selector.includes("@clickable='true'"));
  assert.equal(
    matchingNativeControl(
      nativeControls(
        '<android.widget.TextView text="Install and create shortcut" resource-id="com.android.chrome:id/menu_item_text"/>',
      ),
      installMenuLabel,
    )?.control.type,
    'android.widget.TextView',
  );
});

test('launcher pin confirmation selects only the exact label parent path and refuses ambiguous or blocked ancestors', () => {
  const controls = nativeControls(launcherPinConfirmationXML);
  const selected = matchingNativeConfirmation(controls);
  assert.equal(selected?.label, 'Add to home screen');
  assert.equal(selected?.control.type, 'android.view.View');
  assert.equal(
    selected?.control,
    controls.find((control) => control.attributes.text === 'Add to home screen')?.parent?.parent,
  );
  assert.notEqual(
    selected?.control.attributes['resource-id'],
    'com.android.launcher3.widgetpicker:id/widget_details',
  );
  assert.ok(selected?.selector.includes("@clickable='true'"));
  assert.ok(selected?.selector.includes("not(@heading='true')"));
  assert.ok(selected?.selector.includes("not(@role='heading')"));
  assert.ok(
    selected?.selector.includes(
      "@resource-id='com.android.launcher3.widgetpicker:id/pin_widgets_catalog'",
    ),
  );
  assert.ok(
    selected?.selector.includes(
      "@resource-id='com.google.android.apps.nexuslauncher:id/add_item_drag_layer'",
    ),
  );
  assert.ok(selected?.selector.includes('count(.//*'));
  const unavailable = [
    pinPanel(pinText),
    pinPanel(pinTarget.replace('clickable="true"', 'clickable="false"')),
    pinPanel(pinText).replace(
      'id/pin_widgets_catalog" clickable="false"',
      'id/pin_widgets_catalog" clickable="true"',
    ),
    pinPanel(
      pinTarget.replace('<android.view.View enabled="true"', '<android.view.View enabled="false"'),
    ),
    pinPanel(
      pinTarget.replace(
        '<android.view.View enabled="true"',
        '<android.view.View visible="false" enabled="true"',
      ),
    ),
    pinPanel(
      pinTarget.replace(
        '<android.view.View enabled="true"',
        '<android.view.View heading="true" enabled="true"',
      ),
    ),
    pinPanel(
      pinTarget.replace(
        '<android.view.View enabled="true"',
        '<android.view.View role="heading" enabled="true"',
      ),
    ),
    pinPanel(
      pinTarget.replace('clickable="true" enabled="true"', 'clickable="true" enabled="false"'),
    ),
    pinPanel(
      pinTarget.replace(
        'clickable="true" enabled="true" displayed="true"',
        'clickable="true" enabled="true"',
      ),
    ),
    launcherPinConfirmationXML.replace('id/add_item_drag_layer', 'id/wrong_layer'),
    launcherPinConfirmationXML.replace(
      'id/pin_widgets_catalog" clickable="false" enabled="true"',
      'id/pin_widgets_catalog" clickable="false" enabled="false"',
    ),
  ];
  for (const source of unavailable)
    assert.throws(
      () => matchingNativeConfirmation(nativeControls(source)),
      /capability-native-pin-confirmation-unavailable/,
      source,
    );
  for (const content of [
    pinTarget + pinTarget,
    pinTarget.replace(pinText, pinText + pinText),
    pinTarget.replace(pinText, pinText + '<android.widget.TextView text="Cancel"/>'),
    pinTarget.replace('clickable="true"', 'content-desc="Cancel" clickable="true"'),
  ])
    assert.throws(
      () => matchingNativeConfirmation(nativeControls(pinPanel(content))),
      /capability-native-confirmation-ambiguous/,
    );
  for (const source of [
    launcherPinConfirmationXML.replace('pin_widgets_catalog', 'unrelated_catalog'),
    launcherPinConfirmationXML.replace('Add to home screen', 'Create shortcut'),
    pinText,
  ])
    assert.equal(matchingNativeConfirmation(nativeControls(source)), null, source);
});

test('Safari confirmation selects AddToHomeScreenAddButton rather than the sheet navigation bar or static heading', () => {
  const selected = matchingNativeConfirmation(
    nativeControls(`<XCUIElementTypeOther name="AddToHomeScreenView">
    <XCUIElementTypeNavigationBar name="Add to Home Screen"/>
    <XCUIElementTypeStaticText label="Add to Home Screen" name="Add to Home Screen"/>
    <XCUIElementTypeButton label="Cancel" name="AddToHomeScreenCancelButton" enabled="true" visible="true"/>
    <XCUIElementTypeTextField label="Spinel" name="Add"/>
    <XCUIElementTypeButton label="Add" name="AddToHomeScreenAddButton" enabled="true" visible="true"/>
  </XCUIElementTypeOther>`),
  );
  assert.equal(selected?.label, 'Add');
  assert.equal(selected?.attribute, 'label');
  assert.equal(selected?.control.type, 'XCUIElementTypeButton');
  assert.equal(selected?.control.attributes.name, 'AddToHomeScreenAddButton');
  assert.ok(selected?.selector.includes("name()='XCUIElementTypeButton'"));
  assert.ok(selected?.selector.includes("@label='Add'"));
  assert.ok(selected?.selector.includes("@name='AddToHomeScreenAddButton'"));
  assert.equal(
    matchingNativeControl(
      nativeControls('<XCUIElementTypeCell label="Add to Home Screen"/>'),
      installMenuLabel,
    )?.control.type,
    'XCUIElementTypeCell',
  );
});

test('Safari Home Screen selection uses the exact visible cell and records candidates beyond the generic label cap', () => {
  const cell = '<XCUIElementTypeCell label="Add to Home Screen" enabled="true" visible="true"/>';
  // WDA does not require structural parent visibility to agree with the child.
  // This fixture reproduces that supported shape, not an asserted run-5 ancestry.
  const source = `<XCUIElementTypeApplication name="Safari" enabled="true" visible="true">
    ${'<XCUIElementTypeStaticText label="Background"/>'.repeat(120)}
    <XCUIElementTypeOther visible="false" enabled="true" private="do-not-log">
      <XCUIElementTypeOther name="ActivityListView" enabled="true" visible="true">
        <XCUIElementTypeOther name="ShareSheet.RemoteContainerView" enabled="true" visible="true">${cell}</XCUIElementTypeOther>
      </XCUIElementTypeOther>
    </XCUIElementTypeOther>
  </XCUIElementTypeApplication>`;
  const controls = nativeControls(source);
  const selected = matchingSafariHomeScreen(controls);
  assert.equal(selected?.control.type, 'XCUIElementTypeCell');
  assert.equal(selected?.label, 'Add to Home Screen');
  assert.ok((selected?.control.sourceIndex ?? 0) > 100);
  assert.ok(selected?.selector.includes("@enabled='true'"));
  assert.ok(selected?.selector.includes("@visible='true'"));
  assert.ok(
    selected?.selector.includes(
      "ancestor::*[name()='XCUIElementTypeOther' and @name='ActivityListView']",
    ),
  );
  assert.ok(!selected?.selector.includes('not(ancestor::'));
  assert.ok(
    matchingSafariHomeScreen(nativeControls(cell)),
    'Unobserved container names cannot become a new requirement.',
  );
  const diagnostic = installCandidateDiagnostics(controls);
  assert.equal(diagnostic.candidates[0].shareContainerQualification.observedCount, 2);
  assert.deepEqual(
    installCandidateDiagnostics(nativeControls(cell)).candidates[0].shareContainerQualification,
    {
      observedCount: 0,
      containers: [],
    },
  );
  assert.equal(diagnostic.candidateCount, 1);
  assert.equal(diagnostic.candidates[0].safariCellRejection, null);
  assert.equal(diagnostic.candidates[0].availabilityScope, 'own-element');
  assert.ok(diagnostic.candidates[0].ancestors.some((entry) => entry.state.visible === 'false'));
  assert.doesNotMatch(JSON.stringify(diagnostic), /do-not-log|private/);
  for (const bad of [
    cell.replace('visible="true"', 'visible="false"'),
    cell.replace('enabled="true"', 'enabled="false"'),
    cell.replace('label=', 'name='),
    cell.replace('XCUIElementTypeCell', 'XCUIElementTypeStaticText'),
  ])
    assert.equal(matchingSafariHomeScreen(nativeControls(bad)), null);
  assert.throws(
    () => matchingSafariHomeScreen(nativeControls(cell + cell)),
    /capability-native-control-ambiguous/,
  );
  assert.equal(installCandidateDiagnostics(nativeControls('<hierarchy/>')).status, 'missing-label');
  assert.equal(
    installCandidateDiagnostics(nativeControls(cell.replace('visible="true"', 'visible="false"')))
      .candidates[0].safariCellRejection,
    'own-state',
  );
  assert.equal(
    installCandidateDiagnostics(
      nativeControls(cell.replace('XCUIElementTypeCell', 'XCUIElementTypeStaticText')),
    ).candidates[0].safariCellRejection,
    'role',
  );
  assert.equal(
    matchingNativeConfirmation(
      nativeControls(
        '<android.view.View visible="false"><android.widget.Button text="Add" clickable="true" enabled="true" displayed="true"/></android.view.View>',
      ),
    ),
    null,
  );
});

test('item readiness waits only for explicit document preconditions and classifies ready-document failures safely', () => {
  const origin = 'https://bs-local.com:8176';
  let storageReads = 0;
  const document = {
    readyState: 'complete',
    body: { innerText: '' } as { innerText: string } | null,
    querySelector: () => ({ textContent: 'All changes saved.' }),
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ height: 600 }) }],
  };
  const context = createContext({
    document,
    location: { origin },
    localStorage: {
      getItem: () => {
        storageReads++;
        return 'actor';
      },
    },
  });
  const read = () =>
    JSON.parse(
      JSON.stringify(
        runInContext(`(function(){${itemReadinessScript}})(${JSON.stringify(origin)})`, context),
      ),
    ) as Record<string, unknown>;
  document.body = null;
  assert.equal(read().documentReady, false);
  assert.equal(storageReads, 0);
  document.body = { innerText: '' };
  document.readyState = 'loading';
  assert.equal(read().documentReady, false);
  context.location.origin = 'null';
  document.readyState = 'complete';
  assert.equal(read().originMatch, false);
  assert.equal(storageReads, 0);
  context.location.origin = origin;
  const ready = read();
  assert.equal(itemReadinessSatisfied(ready, false), true);
  assert.equal(itemReadinessSatisfied(ready, true), false);
  assert.equal(itemReadinessSatisfied({ ...ready, documentReady: false }, false), false);
  assert.equal(itemReadinessSatisfied({ ...ready, failure: 'storage-unavailable' }, false), false);
  assert.equal(itemReadinessSatisfied({ ...ready, canvasHeight: 100 }, false), false);
  assert.equal(itemReadinessSatisfied({ ...ready, status: 'Saved on this device' }, true), true);
  assert.equal(ready.account, 'actor');
  context.localStorage.getItem = () => {
    throw Object.assign(new Error('private bootstrap/token details'), { name: 'SecurityError' });
  };
  const denied = read();
  assert.equal(denied.failure, 'storage-unavailable');
  assert.equal(denied.phase, 'storage');
  assert.equal(denied.errorName, 'SecurityError');
  assert.equal(itemReadinessSatisfied(denied, false), false);
  document.querySelector = () => {
    throw new Error('private DOM details');
  };
  const broken = read();
  assert.equal(broken.failure, 'dom-observation-failed');
  assert.equal(broken.errorName, 'unknown');
  assert.doesNotMatch(JSON.stringify([denied, broken]), /private|token|stack|message/);
});

test('confirmation matching refuses headings, images, entry fields and name-only matches without actionable labels', () => {
  const rejected = [
    '<android.widget.TextView text="Create shortcut" clickable="true"/>',
    '<android.widget.ImageView content-desc="Add" clickable="true"/>',
    '<android.widget.EditText text="Add" clickable="true"/>',
    '<android.view.ViewGroup content-desc="Add"/>',
    '<android.widget.Button text="Add" clickable="false"/>',
    '<android.widget.Button text="Add" heading="true"/>',
    '<android.widget.Button text="Cancel" resource-id="Add"/>',
    '<XCUIElementTypeNavigationBar label="Add to Home Screen" clickable="true"/>',
    '<XCUIElementTypeStaticText label="Add" clickable="true"/>',
    '<XCUIElementTypeImage label="Install" clickable="true"/>',
    '<XCUIElementTypeTextField label="Add" clickable="true"/>',
    '<XCUIElementTypeCell label="Add to Home Screen"/>',
    '<XCUIElementTypeButton label="Cancel" name="Add"/>',
    '<XCUIElementTypeButton label="Add" enabled="false"/>',
    '<XCUIElementTypeButton label="Add" visible="false"/>',
  ];
  for (const source of rejected)
    assert.equal(matchingNativeConfirmation(nativeControls(source)), null, source);
  const clickable = matchingNativeConfirmation(
    nativeControls(
      '<node class="android.view.ViewGroup" content-desc="Add" clickable="true" enabled="true"/>',
    ),
  );
  assert.equal(clickable?.label, 'Add');
  assert.ok(clickable?.selector.includes("@class='android.view.ViewGroup'"));
  assert.ok(clickable?.selector.includes("@clickable='true'"));
});

test('Safari reaches Share only through a visible native direct control or observed page-menu control', async () => {
  for (const direct of [true, false]) {
    const pages = direct
      ? ['<Button label="Share"/>']
      : ['<Button label="Page Menu"/>', '<Button label="Share…"/>'];
    const clicks: string[] = [];
    await openNativeShare(async (pattern, required = true) => {
      const selected = matchingNativeControl(
        nativeControls(pages[clicks.length] ?? '<empty/>'),
        pattern,
      );
      if (!selected) {
        if (required) throw new Error('missing native control');
        return false;
      }
      clicks.push(selected.label);
      return true;
    });
    assert.deepEqual(clicks, direct ? ['Share'] : ['Page Menu', 'Share…']);
  }
  let taps = 0;
  await assert.rejects(
    openNativeShare(async (_pattern, required = true) => {
      if (required) throw new Error('missing native control');
      taps++;
      return false;
    }),
  );
  assert.equal(taps, 1);
});

function pageExecutor() {
  const context = createContext({});
  let commands = 0;
  const execute = async (script: string, args: unknown[], timeout: number) => {
    assert.ok(timeout > 0 && timeout <= 10_000);
    commands++;
    context.__commandArgs = args;
    const value = runInContext(`(function(){${script}}).apply(undefined,__commandArgs)`, context);
    await Promise.resolve();
    return structuredClone(value) as unknown;
  };
  const clean = () =>
    runInContext("globalThis[Symbol.for('spinel.capability.observations')] === undefined", context);
  return { context, execute, clean, commands: () => commands };
}

test('Safari sync observations start a one-use operation once, poll its real result and remove volatile state', async () => {
  const page = pageExecutor();
  let calls = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  page.context.fetch = async (url: string) => {
    calls++;
    assert.equal(url, 'private-one-use-url');
    await pending;
    return { actor: 'actor' };
  };
  const diagnostics: unknown[] = [];
  const observed = observeBrowserTask(
    page.execute,
    'return await fetch(arguments[0]);',
    ['private-one-use-url'],
    {
      operation: 'installed-authentication',
      deadline: Date.now() + 1000,
      diagnostic: async (value) => {
        diagnostics.push(value);
      },
    },
  );
  setTimeout(release, 10);
  assert.deepEqual(await observed, { actor: 'actor' });
  assert.equal(calls, 1);
  assert.ok(page.commands() >= 4);
  assert.equal(page.clean(), true);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-one-use-url/);
  assert.deepEqual(
    diagnostics.map((entry) => (entry as { phase: string }).phase),
    ['started', 'fulfilled'],
  );
});

test('Safari reports rejected, genuinely pending and lost observations separately without fabricating completion', async () => {
  for (const scenario of ['rejected', 'pending', 'lost']) {
    const page = pageExecutor();
    const phases: string[] = [];
    const execute = async (script: string, args: unknown[], timeout: number) => {
      if (scenario === 'lost' && page.commands() === 1)
        runInContext(
          "delete globalThis[Symbol.for('spinel.capability.observations')]",
          page.context,
        );
      return page.execute(script, args, timeout);
    };
    await assert.rejects(
      observeBrowserTask(
        execute,
        scenario === 'rejected'
          ? "throw new Error('private browser error');"
          : 'return new Promise(()=>{});',
        [],
        {
          operation: 'worker-registration',
          deadline: Date.now() + (scenario === 'pending' ? 100 : 1000),
          diagnostic: async (value) => {
            phases.push(value.phase);
          },
        },
      ),
      {
        message: `capability-browser-task-${scenario === 'pending' ? 'pending-timeout' : scenario === 'lost' ? 'state-lost' : 'rejected'}`,
      },
    );
    assert.ok(!phases.includes('fulfilled'));
    assert.ok(!phases.includes('command-failed'));
    assert.equal(page.clean(), true);
  }
});

test('an uncertain Safari start command is never replayed and remains a command failure', async () => {
  const page = pageExecutor();
  const phases: string[] = [];
  const execute = async (script: string, args: unknown[], timeout: number) => {
    const result = await page.execute(script, args, timeout);
    if (page.commands() === 1) throw new Error('http-408');
    return result;
  };
  await assert.rejects(
    observeBrowserTask(execute, 'globalThis.started=(globalThis.started||0)+1; return true;', [], {
      operation: 'socket-ticket',
      deadline: Date.now() + 1000,
      diagnostic: async (value) => {
        phases.push(value.phase);
      },
    }),
    { message: 'http-408' },
  );
  assert.equal(page.context.started, 1);
  assert.deepEqual(phases, ['command-failed']);
  assert.equal(page.clean(), true);
});

test('Safari cleanup failures cannot turn a completed observation into a pass or hide its original rejection', async () => {
  for (const rejected of [false, true]) {
    const page = pageExecutor();
    const phases: string[] = [];
    const execute = async (script: string, args: unknown[], timeout: number) => {
      const result = await page.execute(script, args, timeout);
      if (page.commands() === 3) throw new Error('http-500');
      return result;
    };
    await assert.rejects(
      observeBrowserTask(execute, rejected ? 'throw new Error();' : 'return true;', [], {
        operation: 'worker-registration',
        deadline: Date.now() + 1000,
        diagnostic: async (value) => {
          phases.push(value.phase);
        },
      }),
      {
        message: rejected
          ? 'capability-browser-task-rejected'
          : 'capability-browser-task-cleanup-failed',
      },
    );
    assert.deepEqual(phases, ['started', rejected ? 'rejected' : 'fulfilled', 'cleanup-failed']);
  }
});

test('prepare receipts certify only zero allocations and cannot reset an execution journal', () => {
  const { manifest, durable } = admission();
  const reservation = verifyCapabilityAdmission(manifest, durable, identity, now);
  const prepared = preparedCapabilityJournal(identity, reservation, now);
  assert.deepEqual(prepared.receipt, {
    ...identity,
    finishedAt: new Date(now).toISOString(),
    sessionIds: [],
    uncertainAllocation: false,
  });
  assert.deepEqual(readPreparedCapabilityJournal(prepared, identity, reservation, now), prepared);
  for (const change of [
    (value: typeof prepared) => {
      value.stage = 'device-execution';
    },
    (value: typeof prepared) => {
      value.receipt.sessionIds = [sessionId];
    },
    (value: typeof prepared) => {
      value.receipt.uncertainAllocation = true;
    },
    (value: typeof prepared) => {
      value.receipt.attempt = '2';
    },
  ]) {
    const value = structuredClone(prepared);
    change(value);
    assert.throws(() => readPreparedCapabilityJournal(value, identity, reservation, now));
  }
});

test('Chrome diagnostic scope binds prepare and run, allocates only Chrome and keeps all three lanes incomplete', async () => {
  assert.equal(readCapabilityScope(undefined), 'all');
  assert.equal(readCapabilityScope('all'), 'all');
  assert.equal(readCapabilityScope('chrome-navigation-diagnostic'), 'chrome-navigation-diagnostic');
  let invalidExecutions = 0;
  for (const invalid of ['', null, 'chrome', 'safari', {}, ['chrome']]) {
    assert.throws(() => readCapabilityScope(invalid), /capability-invalid-scope/);
    await assert.rejects(
      runCapabilityLane(
        target,
        async () => {
          invalidExecutions++;
          throw new Error('invalid scope must not execute');
        },
        invalid as unknown as Parameters<typeof runCapabilityLane>[2],
      ),
      /capability-invalid-scope/,
    );
  }
  assert.equal(invalidExecutions, 0);
  const { manifest, durable } = admission();
  const reservation = verifyCapabilityAdmission(manifest, durable, identity, now);
  const prepared = preparedCapabilityJournal(
    identity,
    reservation,
    now,
    'chrome-navigation-diagnostic',
  );
  assert.equal(prepared.allocationPlan, 'chrome-navigation-diagnostic');
  assert.deepEqual(
    readPreparedCapabilityJournal(
      prepared,
      identity,
      reservation,
      now,
      'chrome-navigation-diagnostic',
    ),
    prepared,
  );
  assert.throws(
    () => readPreparedCapabilityJournal(prepared, identity, reservation, now),
    /capability-journal-already-used/,
  );
  const regular = preparedCapabilityJournal(identity, reservation, now);
  assert.throws(
    () =>
      readPreparedCapabilityJournal(
        regular,
        identity,
        reservation,
        now,
        'chrome-navigation-diagnostic',
      ),
    /capability-journal-already-used/,
  );
  let executed = 0;
  const firefox = await runCapabilityLane(
    { ...target, browser: 'firefox' },
    async () => {
      throw new Error('Firefox fixture must not run');
    },
    'chrome-navigation-diagnostic',
  );
  const safari = await runCapabilityLane(
    { ...target, browser: 'safari' },
    async () => {
      throw new Error('Safari fixture must not run');
    },
    'chrome-navigation-diagnostic',
  );
  const chrome = await runCapabilityLane(
    target,
    async () => {
      executed++;
      return { ...safari, target, status: 'passed', sessionId, allocation: 'known' };
    },
    'chrome-navigation-diagnostic',
  );
  assert.equal(executed, 1);
  assert.equal(firefox.status, 'blocked');
  assert.equal(safari.status, 'not-run');
  assert.equal(safari.startedAt, null);
  assert.equal(safari.sessionId, undefined);
  assert.equal(safari.cleanup.fixture, 'not-created');
  assert.equal(capabilityOutcome([chrome, firefox, safari]), 'incomplete');
  assert.equal(capabilityOutcome([{ ...chrome, status: 'failed' }, firefox, safari]), 'incomplete');
  assert.deepEqual(
    [chrome, firefox, safari].flatMap((lane) => (lane.sessionId ? [lane.sessionId] : [])),
    [sessionId],
  );
});

test('Chrome item navigation assigns once in the verified window and observes exact URL continuity without selecting another tab', async (context) => {
  let clock = Date.now();
  context.mock.method(Date, 'now', () => clock);
  const origin = 'https://bs-local.com:8176';
  for (const mode of [
    'ready',
    'delayed',
    'next-item',
    'wrong-before-window',
    'wrong-after-window',
    'wrong-before-origin',
    'wrong-previous-item',
    'changed-script-precondition',
    'wrong-after-origin',
    'wrong-after-item',
    'assignment-http-error',
    'read-http-error',
    'pending-deadline',
  ]) {
    const began = clock;
    let href =
      mode === 'next-item' || mode === 'wrong-previous-item'
        ? `${origin}/?item=doc`
        : `${origin}/sign-in`;
    if (mode === 'wrong-before-origin')
      href = 'https://private.example/_desktop-login/private-bootstrap';
    let assignments = 0,
      scriptCommands = 0,
      afterReads = 0;
    const calls: string[] = [];
    const diagnostic: Record<string, unknown> = {};
    const itemId = mode === 'next-item' ? 'sheet' : 'doc';
    const destination = `${origin}/?item=${itemId}`;
    const page = createContext({
      location: {
        get href() {
          return href;
        },
        get origin() {
          return new URL(href).origin;
        },
        assign(value: string) {
          assignments++;
          assert.equal(value, destination);
          if (mode === 'wrong-after-origin') href = 'https://private.example/?token=private';
          else if (mode === 'wrong-after-item') href = `${origin}/?item=wrong`;
          else if (mode !== 'delayed' && mode !== 'pending-deadline') href = value;
        },
      },
    });
    const pending = navigateChromeItem(
      async (suffix, method, body, timeout) => {
        calls.push(`${method} ${suffix}`);
        assert.ok(timeout > 0 && timeout <= 15_000);
        if (suffix === 'window') {
          assert.equal(method, 'GET');
          return mode === 'wrong-before-window' || (mode === 'wrong-after-window' && scriptCommands)
            ? 'stale-tab'
            : 'actual-home-window';
        }
        if (suffix === 'url') {
          assert.equal(method, 'GET');
          if (scriptCommands) {
            afterReads++;
            if (mode === 'read-http-error') throw new Error('http-500');
            if (mode === 'delayed' && afterReads === 2) href = destination;
            if (mode === 'pending-deadline') clock = began + 15_000;
          }
          return href;
        }
        assert.equal(suffix, 'execute/sync');
        assert.equal(method, 'POST');
        scriptCommands++;
        const payload = body as { script: string; args: unknown[] };
        assert.equal(payload.script, chromeItemNavigationScript);
        if (mode === 'changed-script-precondition') href = `${origin}/?item=changed`;
        page.args = payload.args;
        const value = runInContext(`(function(){${payload.script}}).apply(null, args)`, page);
        if (mode === 'assignment-http-error') throw new Error('http-500');
        return value;
      },
      {
        origin,
        itemId,
        windowHandle: 'actual-home-window',
        previousURL:
          mode === 'next-item'
            ? `${origin}/?item=doc`
            : mode === 'wrong-previous-item'
              ? `${origin}/?item=sheet`
              : undefined,
        deadline: began + 180_000,
      },
      diagnostic,
    );
    if (['ready', 'delayed', 'next-item'].includes(mode)) {
      assert.equal(await pending, destination);
      assert.equal(diagnostic.phase, 'verified');
      assert.equal(diagnostic.itemURLMatch, true);
      assert.equal(assignments, 1);
    } else {
      const expected = mode.includes('window')
        ? 'capability-item-navigation-window-changed'
        : mode.includes('origin')
          ? 'capability-item-navigation-origin-changed'
          : mode === 'wrong-previous-item'
            ? 'capability-item-navigation-previous-item-changed'
            : mode === 'changed-script-precondition'
              ? 'capability-item-navigation-precondition-changed'
              : mode === 'wrong-after-item'
                ? 'capability-item-navigation-unexpected-url'
                : mode === 'pending-deadline'
                  ? 'capability-item-navigation-deadline'
                  : 'http-500';
      await assert.rejects(pending, { message: expected });
      assert.equal(diagnostic.failure, expected);
    }
    assert.ok(scriptCommands <= 1);
    assert.ok(assignments <= 1);
    assert.equal(calls.includes('POST url'), false);
    assert.equal(calls.includes('POST window'), false);
    if (mode.startsWith('wrong-before') || mode === 'wrong-previous-item')
      assert.equal(scriptCommands, 0);
    if (mode === 'changed-script-precondition') assert.equal(assignments, 0);
    if (mode.endsWith('http-error')) assert.equal(scriptCommands, 1);
    assert.doesNotMatch(
      JSON.stringify(diagnostic),
      /private|bs-local|\/\?item|stale-tab|actual-home-window/,
    );
  }
});

test('the maintained Firefox blocker creates no fixture or session and keeps a two-lane success incomplete', async () => {
  const firefox = { ...target, browser: 'firefox' } as const;
  let executions = 0;
  const blocked = await runCapabilityLane(firefox, async () => {
    executions++;
    throw new Error('fixture and provider must not execute');
  });
  assert.equal(executions, 0);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.startedAt, null);
  assert.equal(blocked.sessionId, undefined);
  assert.equal(blocked.allocation, 'not-started');
  assert.equal(blocked.uncertainAllocation, false);
  assert.equal(blocked.cleanup.fixture, 'not-created');
  const evidence = (blocked.observations[0].value as { evidence: { path: string; sha256: string } })
    .evidence;
  assert.equal(
    createHash('sha256')
      .update(readFileSync(new URL('../../' + evidence.path, import.meta.url)))
      .digest('hex'),
    evidence.sha256,
  );
  const chrome = {
    ...blocked,
    target,
    status: 'passed',
    sessionId: 'e'.repeat(40),
    allocation: 'known',
  } as const;
  const safari = {
    ...chrome,
    target: { browser: 'safari', device: 'iPhone 18 Pro Max', osVersion: '27' },
    sessionId: 'f'.repeat(40),
  } as const;
  assert.equal(capabilityOutcome([chrome, blocked, safari]), 'incomplete');
  assert.deepEqual(
    [chrome, blocked, safari].flatMap((lane) => (lane.sessionId ? [lane.sessionId] : [])),
    ['e'.repeat(40), 'f'.repeat(40)],
  );
});

test('a native launch cannot be credited to a stale ambiguous tab or another foreground browser', () => {
  assert.deepEqual(launchedWindow(['original', 'new-home-window'], ['original']), {
    handle: 'new-home-window',
    handles: ['original', 'new-home-window'],
    relation: 'new-after-native-launch',
  });
  assert.equal(launchedWindow(['original'], ['original']).relation, 'sole-browser-window');
  assert.throws(
    () => launchedWindow(['original', 'other-old-tab'], ['original', 'other-old-tab']),
    /capability-launched-window-ambiguous/,
  );
  const firefox = { ...target, browser: 'firefox' } as const;
  const environment = {
    origin: 'https://bs-local.com:8176',
    userAgent: 'Mozilla/5.0 (Android 16) Gecko/145.0 Firefox/145.0',
    standalone: false,
    navigatorStandalone: false,
  };
  assert.equal(
    verifyLaunchedBrowser(firefox, 'org.mozilla.firefox', environment).launchMode,
    'browser-shortcut',
  );
  assert.throws(
    () => verifyLaunchedBrowser(firefox, 'com.android.chrome', environment),
    /capability-launched-foreground-browser-mismatch/,
  );
  assert.throws(
    () =>
      verifyLaunchedBrowser(firefox, 'org.mozilla.firefox', {
        ...environment,
        userAgent: 'Mozilla/5.0 (Android 16) Chrome/145.0',
      }),
    /capability-launched-browser-mismatch/,
  );
  assert.throws(
    () => verifyLaunchedBrowser(firefox, 'org.mozilla.firefox', environment, 'com.android.chrome'),
    /capability-launched-context-foreground-mismatch/,
  );
  const safari = { browser: 'safari', device: 'iPhone 17', osVersion: '26' } as const;
  assert.throws(
    () =>
      verifyLaunchedBrowser(safari, 'com.apple.mobilesafari', {
        ...environment,
        userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15',
      }),
    /capability-ios-launch-not-standalone/,
  );
});

test('Safari Home Screen UIProcess association requires the exact host pair, new window and standalone runtime', () => {
  const safari = { browser: 'safari', device: 'iPhone 18 Pro Max', osVersion: '27' } as const;
  const environment = {
    origin: 'https://bs-local.com:8176',
    userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/23A344',
    standalone: true,
    navigatorStandalone: true,
  };
  const associated = verifyLaunchedBrowser(
    safari,
    'com.apple.webapp',
    environment,
    'com.apple.SafariViewService',
    'new-after-native-launch',
  );
  assert.equal(associated.contextAssociation, 'webkit-home-screen-ui-process');
  assert.equal(associated.launchMode, 'standalone');
  for (const [foreground, bundleId, relation] of [
    ['com.apple.webapp', 'com.apple.SafariViewService', undefined],
    ['com.apple.webapp', 'com.apple.SafariViewService', 'sole-browser-window'],
    ['com.apple.mobilesafari', 'com.apple.SafariViewService', 'new-after-native-launch'],
    ['com.apple.webapp.another', 'com.apple.SafariViewService', 'new-after-native-launch'],
    ['com.apple.webapp', 'com.apple.another-service', 'new-after-native-launch'],
  ] as const)
    assert.throws(
      () => verifyLaunchedBrowser(safari, foreground, environment, bundleId, relation),
      /capability-launched-context-foreground-mismatch/,
    );
  for (const [changed, expected] of [
    [{ origin: 'https://another-origin.example' }, /capability-launched-origin-mismatch/],
    [{ userAgent: environment.userAgent + ' FxiOS/145.0' }, /capability-launched-browser-mismatch/],
    [{ standalone: false, navigatorStandalone: false }, /capability-ios-launch-not-standalone/],
  ] as const)
    assert.throws(
      () =>
        verifyLaunchedBrowser(
          safari,
          'com.apple.webapp',
          { ...environment, ...changed },
          'com.apple.SafariViewService',
          'new-after-native-launch',
        ),
      expected,
    );
  assert.throws(
    () =>
      verifyLaunchedBrowser(
        target,
        'com.apple.webapp',
        { ...environment, userAgent: 'Mozilla/5.0 (Android 17) Chrome/152.0' },
        'com.apple.SafariViewService',
        'new-after-native-launch',
      ),
    /capability-launched-context-foreground-mismatch/,
  );
});

test('launch and screenshot diagnostics retain bounded observations without copying arbitrary provider fields', () => {
  const environment = launchEnvironmentDiagnostic({
    origin: 'https://bs-local.com:8176',
    path: '/_desktop-login/private-bootstrap',
    userAgent: 'x'.repeat(1000),
    controller: { token: 'private-controller' },
    secureContext: true,
    standalone: false,
    navigatorStandalone: false,
    arbitrary: 'private-field',
  });
  assert.equal(environment.origin, 'https://bs-local.com:8176');
  assert.equal(environment.path, '/_desktop-login/[redacted]');
  assert.equal(String(environment.userAgent).length, 500);
  assert.equal(environment.secureContext, true);
  assert.equal(environment.standalone, false);
  assert.equal(environment.controller, null);
  assert.equal(environment.online, null);
  assert.doesNotMatch(JSON.stringify(environment), /private-|arbitrary/);
  assert.deepEqual(screenshotResponseShape({ value: 'private-screenshot', token: 'private-key' }), {
    type: 'object',
    keyCount: 2,
  });
  assert.deepEqual(screenshotResponseShape(null), { type: 'null' });
  assert.deepEqual(screenshotResponseShape(['private-screenshot']), { type: 'array', length: 1 });
  const whitespace = screenshotResponseShape(tinyPng + '\n');
  assert.equal(whitespace.sampleHasWhitespace, true);
  assert.equal(whitespace.sampleBase64Alphabet, false);
  const large = screenshotResponseShape('A'.repeat(2000));
  assert.equal(large.length, 2000);
  assert.equal(large.sampledCharacters, 1024);
  assert.equal(large.sampleBase64Alphabet, true);
  assert.doesNotMatch(JSON.stringify(large), /AAAA/);
});

test('screenshots accept only bounded canonical PNG Base64 with optional CR/LF wrapping', () => {
  for (const wrapped of [tinyPng, tinyPng.replace(/(.{12})/g, '$1\r\n'), '\n' + tinyPng + '\r'])
    assert.equal(normalizedPngScreenshot(wrapped), tinyPng);
  const invalid = [
    null,
    {},
    '',
    '\r\n',
    tinyPng + ' ',
    tinyPng + '\t',
    tinyPng + '\u00a0',
    tinyPng + '\\n',
    'data:image/png;base64,' + tinyPng,
    '-' + tinyPng.slice(1),
    '_' + tinyPng.slice(1),
    tinyPng + '=',
    tinyPng.slice(0, -1),
    tinyPng.slice(0, -4),
    tinyPng.slice(0, -3) + 'h==',
    Buffer.alloc(70).toString('base64'),
    Buffer.from(tinyPng, 'base64').subarray(0, -1).toString('base64'),
    '\n'.repeat(screenshotLimits.rawCharacters + 1),
    Buffer.alloc(screenshotLimits.decodedBytes + 1).toString('base64'),
  ];
  for (const value of invalid)
    assert.throws(() => normalizedPngScreenshot(value), /capability-screenshot-invalid/);
});

test('network checks use transport failures and retain link state without equating it with reachability', () => {
  const probe = (online: boolean, api: boolean, app: boolean) => ({
    online,
    checks: [
      { path: '/api/auth/session', reachable: api },
      { path: '/capability-network-probe', reachable: app },
    ],
  });
  assert.doesNotThrow(() => verifyTransportProbe(probe(true, false, false), false));
  assert.doesNotThrow(() => verifyTransportProbe(probe(false, false, false), false));
  assert.doesNotThrow(() => verifyTransportProbe(probe(true, true, true), true));
  assert.throws(
    () => verifyTransportProbe(probe(false, true, false), false),
    /capability-device-still-online/,
  );
  assert.throws(
    () => verifyTransportProbe(probe(true, false, false), true),
    /capability-online-baseline-unreachable/,
  );
  assert.throws(
    () => verifyTransportProbe({ online: false, checks: [] }, false),
    /capability-network-probe-invalid/,
  );
});

function fixture(onClose: () => void) {
  return {
    origin: 'https://bs-local.com:8176',
    loginURL: 'https://bs-local.com:8176/_desktop-login/private-bootstrap',
    actor: { id: 'actor' },
    certificate: {
      hostname: 'bs-local.com',
      selfSigned: true,
      fingerprint256: 'public-fingerprint',
      validFrom: '2026-11-01T00:00:00.000Z',
      validTo: '2026-11-02T00:00:00.000Z',
    },
    items: [
      { id: 'doc', kind: 'doc', outcome: 'normal' },
      { id: 'sheet', kind: 'sheet', outcome: 'normal' },
    ],
    imageRows: () => [],
    close: async () => {
      onClose();
    },
  } as unknown as Parameters<typeof runCapability>[2];
}
test('native taps keep the selected XML identity and refuse unsafe, stale or ambiguous ancestor targets with cleanup', async () => {
  for (const [mode, count] of [
    ['menu', 0],
    ['menu', 1],
    ['menu', 2],
    ['pin', 0],
    ['pin', 1],
    ['pin', 2],
    ['pin-unsafe', 0],
  ] as const) {
    let lookups = 0,
      clicks = 0;
    const stopAt = mode === 'menu' ? 1 : mode === 'pin-unsafe' ? 3 : 4;
    const origin = 'https://bs-local.com:8176';
    const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
      const path = String(url).split('/wd/hub/')[1] ?? String(url).split('/automate/')[1];
      let value: unknown = null;
      if (path === 'session') value = { sessionId, capabilities: { browserName: 'chrome' } };
      else if (path.endsWith('/execute/sync'))
        value = {
          origin,
          secureContext: true,
          serviceWorkerAvailable: true,
          controller: `${origin}/service-worker.js`,
          anonymousReady: true,
          userAgent: 'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 Chrome/152.0 Mobile',
        };
      else if (path.endsWith('/execute/async'))
        value = {
          ok: true,
          value: { scope: `${origin}/`, active: `${origin}/service-worker.js`, state: 'activated' },
        };
      else if (path.endsWith('/window/handles')) value = ['original'];
      else if (path.endsWith('/contexts')) value = ['NATIVE_APP', 'WEBVIEW_chrome'];
      else if (path.endsWith('/source'))
        value = [
          '<hierarchy><node text="More options" visible="false"/><node text="More options" enabled="false"/><node text="More options" resource-id="chrome:menu" enabled="true"/><other text="More options"/></hierarchy>',
          '<android.widget.TextView text="Install and create shortcut"/>',
          mode === 'pin-unsafe'
            ? pinPanel(
                pinTarget.replace(
                  '<android.view.View enabled="true"',
                  '<android.view.View enabled="false"',
                ),
              )
            : chromeConfirmationXML,
          launcherPinConfirmationXML,
        ][clicks];
      else if (path.endsWith('/elements')) {
        lookups++;
        if (lookups === 1)
          assert.deepEqual(JSON.parse(String(init?.body)), {
            using: 'xpath',
            value:
              "//*[name()='node' and @text='More options' and not(@enabled='false') and not(@visible='false') and not(@displayed='false') and @resource-id='chrome:menu']",
          });
        if (lookups === 4) {
          const selector = String(JSON.parse(String(init?.body)).value);
          assert.ok(selector.includes("@text='Add to home screen'"));
          assert.ok(selector.includes(' and ./*['));
          assert.ok(selector.includes('ancestor::*['));
          assert.ok(!selector.includes('widget_details'));
        }
        value = Array.from({ length: lookups === stopAt ? count : 1 }, (_, index) => ({
          'element-6066-11e4-a52e-4f735466cecf': `native-${index}`,
        }));
      } else if (path.endsWith('/click')) {
        clicks++;
        assert.ok(path.endsWith('/element/native-0/click'));
        // End the positive control after the selected target's actual click request.
        if (clicks === stopAt) return new Response('', { status: 500 });
      } else if (path.endsWith('/screenshot')) value = tinyPng;
      return Response.json({ value });
    });
    const result = await runCapability(
      client,
      target,
      fixture(() => {}),
      {
        localIdentifier: 'local-id',
        buildName: 'test',
        journal: async () => {},
        screenshot: async (name) => name,
      },
    );
    assert.equal(lookups, mode === 'pin-unsafe' ? 2 : stopAt);
    assert.equal(clicks, stopAt - 1 + Number(count === 1));
    assert.equal(
      result.failure,
      mode === 'pin-unsafe'
        ? 'capability-native-pin-confirmation-unavailable'
        : count === 0
          ? 'capability-native-control-stale'
          : count === 2
            ? 'capability-native-control-ambiguous'
            : 'http-500',
    );
    assert.equal(result.cleanup.session, 'deleted');
    assert.equal(result.cleanup.network, 'restored-4g-lte-good');
    assert.equal(result.cleanup.fixture, 'closed');
  }
});
test('confirmation readiness requires the first action and observes the final transition without replay', async (context) => {
  let clock = Date.now();
  context.mock.method(Date, 'now', () => clock);
  for (const transition of [
    'initial-delayed',
    'initial-missing',
    'final-first-followup-unavailable',
    'first-disappeared',
    'first-unchanged',
    'final-disappeared',
    'final-changed',
    'final-unchanged',
    'final-unavailable-transition',
    'final-hidden-persistent',
    'final-disabled-persistent',
  ]) {
    const initialMissing = transition === 'initial-missing';
    const secondAction = transition.startsWith('final-');
    const timeout =
      initialMissing || transition.endsWith('-unchanged') || transition.endsWith('-persistent');
    const clicked: string[] = [];
    let lookups = 0,
      initialReads = 0,
      afterFirstReads = 0,
      afterFinalReads = 0,
      homeRequests = 0,
      authRequests = 0;
    let finalTransitionObserved = false;
    const began = clock;
    const origin = 'https://bs-local.com:8176';
    const testFixture = fixture(() => {});
    const secondConfirmation = launcherPinConfirmationXML;
    const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
      const path = String(url).split('/wd/hub/')[1] ?? String(url).split('/automate/')[1];
      let value: unknown = null;
      if (path === 'session') value = { sessionId, capabilities: { browserName: 'chrome' } };
      else if (path.endsWith('/execute/sync'))
        value = {
          origin,
          secureContext: true,
          serviceWorkerAvailable: true,
          controller: `${origin}/service-worker.js`,
          anonymousReady: true,
          standalone: false,
          navigatorStandalone: false,
          userAgent: 'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 Chrome/152.0 Mobile',
        };
      else if (path.endsWith('/execute/async')) {
        if (JSON.parse(String(init?.body)).args[0] === testFixture.loginURL) {
          authRequests++;
          // A deliberate identity mismatch ends the positive native-transition
          // cases at the next real guard, after a successful Home/icon path.
          value = { ok: true, value: { actor: 'another-actor' } };
        } else
          value = {
            ok: true,
            value: {
              scope: `${origin}/`,
              active: `${origin}/service-worker.js`,
              state: 'activated',
            },
          };
      } else if (path.endsWith('/window/handles')) value = ['original'];
      else if (path.endsWith('/contexts')) value = ['NATIVE_APP', 'WEBVIEW_chrome'];
      else if (path.endsWith('/appium/device/current_package')) value = 'com.android.chrome';
      else if (path.endsWith('/source')) {
        if (homeRequests)
          value = '<android.widget.TextView text="Spinel" resource-id="launcher:id/spinel_icon"/>';
        else if (clicked.length === 0)
          value =
            '<android.widget.ImageButton content-desc="More options" resource-id="com.android.chrome:id/menu_button"/>';
        else if (clicked.length === 1)
          value =
            '<android.widget.TextView text="Install and create shortcut" resource-id="com.android.chrome:id/menu_item_text"/>';
        else {
          value = chromeConfirmationXML;
          if (clicked.length === 2) {
            initialReads++;
            if (transition.startsWith('initial-') && (initialMissing || initialReads < 3)) {
              // The seventh phone receipt returned this status without an
              // actionable confirmation. Its disabled/undisplayed toast is not
              // proof of either completed installation or eventual readiness.
              value =
                '<android.widget.Toast text="Just a moment…" enabled="false" displayed="false"/>';
              if (initialMissing && initialReads === 2) clock += 15_000;
            }
          } else if (clicked.length === 3) {
            afterFirstReads++;
            if (transition === 'final-first-followup-unavailable' && afterFirstReads < 3)
              value = pinPanel(
                pinTarget.replace(
                  '<android.view.View enabled="true"',
                  afterFirstReads === 1
                    ? '<android.view.View enabled="false"'
                    : '<android.view.View visible="false" enabled="true"',
                ),
              );
            if (transition === 'first-unchanged' && afterFirstReads === 2) clock += 15_000;
            else if (transition !== 'first-unchanged' && afterFirstReads >= 3) {
              value = secondAction ? secondConfirmation : '<hierarchy/>';
              if (!secondAction) finalTransitionObserved = true;
            }
          } else if (clicked.length === 4 && secondAction) {
            afterFinalReads++;
            value = secondConfirmation;
            if (
              transition === 'final-unavailable-transition' ||
              transition.endsWith('-persistent')
            ) {
              const hidden =
                transition === 'final-hidden-persistent' ||
                (transition === 'final-unavailable-transition' && afterFinalReads === 1);
              value = pinPanel(
                pinTarget.replace(
                  '<android.view.View enabled="true"',
                  hidden
                    ? '<android.view.View visible="false" enabled="true"'
                    : '<android.view.View enabled="false"',
                ),
              );
            }
            if (timeout && afterFinalReads === 2) clock += 15_000;
            else if (!timeout && afterFinalReads >= 3) {
              value =
                transition === 'final-changed'
                  ? '<android.widget.Button text="Add" resource-id="launcher:id/third_action" clickable="true"/>'
                  : '<hierarchy/>';
              finalTransitionObserved = true;
            }
          }
        }
      } else if (path.endsWith('/elements')) {
        lookups++;
        const selector = String(JSON.parse(String(init?.body)).value);
        if (lookups === 3) {
          assert.ok(selector.includes("name()='android.widget.Button'"));
          assert.ok(selector.includes("@resource-id='com.android.chrome:id/positive_button'"));
          assert.doesNotMatch(selector, /TextView|shortcut_name|\/title/);
        }
        if (lookups === 4 && secondAction) {
          assert.ok(selector.includes("name()='android.view.View'"));
          assert.ok(selector.includes("@clickable='true'"));
          assert.ok(
            selector.includes(
              "@resource-id='com.android.launcher3.widgetpicker:id/pin_widgets_catalog'",
            ),
          );
        }
        assert.ok(!selector.includes("@resource-id='launcher:id/third_action'"));
        value = [{ 'element-6066-11e4-a52e-4f735466cecf': `native-${lookups}` }];
      } else if (path.endsWith('/click')) clicked.push(path);
      else if (path.endsWith('/appium/device/press_keycode')) {
        homeRequests++;
        assert.equal(
          finalTransitionObserved,
          true,
          'Home must wait for the last clicked confirmation to transition',
        );
      } else if (path.endsWith('/screenshot')) value = tinyPng;
      return Response.json({ value });
    });
    const result = await runCapability(client, target, testFixture, {
      localIdentifier: 'local-id',
      buildName: 'test',
      journal: async () => {},
      screenshot: async (name) => name,
    });
    const expectedClicks = initialMissing ? 2 : 3 + Number(secondAction) + Number(!timeout);
    assert.equal(lookups, expectedClicks);
    assert.equal(clicked.length, expectedClicks);
    assert.equal(
      result.nativeActions.filter((action) => action.label === 'Add').length,
      initialMissing ? 0 : 1,
    );
    assert.equal(
      result.nativeActions.filter((action) => action.label === 'Add to home screen').length,
      secondAction ? 1 : 0,
    );
    if (secondAction) {
      const observations = result.observations.flatMap(
        (observation) =>
          (observation.value as { labels?: { value: string; state: unknown }[] }).labels ?? [],
      );
      assert.deepEqual(observations.find((label) => label.value === 'Add to home screen')?.state, {
        clickable: 'false',
        enabled: 'true',
        visible: null,
        displayed: 'true',
        heading: null,
      });
      const selected = result.nativeActions.find((action) => action.label === 'Add to home screen');
      assert.equal(selected?.target?.type, 'android.view.View');
      assert.equal(selected?.target?.state.clickable, 'true');
      assert.equal(selected?.target?.identity['resource-id'], undefined);
      assert.match(selected?.selectorSha256 ?? '', /^[a-f0-9]{64}$/);
      const candidates = result.observations.flatMap(
        (observation) =>
          (observation.value as { pinCandidates?: { ancestors: { sourceIndex: number }[] }[] })
            .pinCandidates ?? [],
      );
      assert.equal(candidates[0]?.ancestors[1]?.sourceIndex, selected?.target?.sourceIndex);
      assert.ok(!JSON.stringify(candidates[0]?.ancestors).includes('widget_details'));
    }
    const candidate = result.observations.find(
      (observation) => observation.stage === 'home-launch:context-candidate',
    )?.value as
      { environment: { origin: string; standalone: boolean }; windowRelation: string } | undefined;
    assert.equal(candidate?.environment.origin, timeout ? undefined : origin);
    assert.equal(candidate?.environment.standalone, timeout ? undefined : false);
    assert.equal(homeRequests, timeout ? 0 : 1);
    assert.equal(authRequests, timeout ? 0 : 1);
    assert.equal(initialReads, initialMissing ? 2 : transition === 'initial-delayed' ? 3 : 1);
    assert.equal(
      afterFirstReads,
      initialMissing ? 0 : transition === 'first-unchanged' ? 2 : secondAction ? 3 : 4,
    );
    assert.equal(afterFinalReads, !secondAction ? 0 : timeout ? 2 : 3);
    assert.equal(result.stage, timeout ? 'native-install' : 'installed-authentication');
    assert.equal(
      result.failure,
      initialMissing
        ? 'capability-native-first-confirmation-unavailable'
        : timeout
          ? 'capability-native-confirmation-unchanged'
          : 'capability-installed-authentication-failed',
    );
    assert.equal(clock - began, timeout ? 15_000 : 0);
    assert.equal(result.cleanup.session, 'deleted');
    assert.equal(result.cleanup.network, 'restored-4g-lte-good');
    assert.equal(result.cleanup.fixture, 'closed');
  }
});
test('Chrome item navigation and readiness preserve operational failures, buffer observations and never replay failed commands', async () => {
  for (const mode of ['navigation-http-error', 'http-error', 'storage-error-after-loading']) {
    const testFixture = fixture(() => {});
    const origin = testFixture.origin;
    let clicks = 0,
      homeRequests = 0,
      reads = 0,
      diagnosticWrites = 0,
      navigationCommands = 0;
    let currentURL = `${origin}/sign-in`;
    const urlWrites: string[] = [];
    const journals: CapabilityResult[] = [];
    const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
      const path = String(url).split('/wd/hub/')[1] ?? String(url).split('/automate/')[1];
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      let value: unknown = null;
      if (path === 'session') value = { sessionId, capabilities: { browserName: 'chrome' } };
      else if (path.endsWith('/execute/sync')) {
        if (payload.script === chromeItemNavigationScript) {
          navigationCommands++;
          assert.deepEqual(payload.args, [origin, currentURL, `${origin}/?item=doc`]);
          if (mode === 'navigation-http-error')
            return Response.json(
              { value: { error: 'unknown error', message: 'private navigation details' } },
              { status: 500 },
            );
          currentURL = payload.args[2];
          value = true;
        } else if (payload.script === itemReadinessScript) {
          reads++;
          assert.deepEqual(payload.args, [origin]);
          if (mode === 'http-error')
            return Response.json(
              { value: { error: 'javascript error', message: 'private script details' } },
              { status: 500 },
            );
          value =
            reads === 1
              ? {
                  phase: 'document',
                  readyState: 'loading',
                  bodyPresent: false,
                  originMatch: true,
                  documentReady: false,
                }
              : {
                  phase: 'storage',
                  readyState: 'complete',
                  bodyPresent: true,
                  originMatch: true,
                  documentReady: true,
                  failure: 'storage-unavailable',
                  errorName: 'SecurityError',
                };
        } else
          value = {
            origin,
            secureContext: true,
            serviceWorkerAvailable: true,
            controller: `${origin}/service-worker.js`,
            anonymousReady: true,
            standalone: false,
            navigatorStandalone: false,
            userAgent: 'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 Chrome/152.0 Mobile',
          };
      } else if (path.endsWith('/execute/async'))
        value = {
          ok: true,
          value:
            payload.args[0] === testFixture.loginURL
              ? { actor: testFixture.actor.id }
              : { scope: `${origin}/`, active: `${origin}/service-worker.js`, state: 'activated' },
        };
      else if (path.endsWith('/window/handles')) value = ['original'];
      else if (path.endsWith('/window') && init?.method === 'GET') value = 'original';
      else if (path.endsWith('/url')) {
        if (init?.method === 'POST') {
          urlWrites.push(payload.url);
          currentURL = payload.url;
        } else value = currentURL;
      } else if (path.endsWith('/contexts')) value = ['NATIVE_APP', 'WEBVIEW_chrome'];
      else if (path.endsWith('/appium/device/current_package')) value = 'com.android.chrome';
      else if (path.endsWith('/source'))
        value = homeRequests
          ? '<android.widget.TextView text="Spinel" resource-id="launcher:id/spinel_icon"/>'
          : [
              '<android.widget.ImageButton content-desc="More options"/>',
              '<android.widget.TextView text="Install and create shortcut"/>',
              chromeConfirmationXML,
              '<hierarchy/>',
            ][clicks];
      else if (path.endsWith('/elements'))
        value = [{ 'element-6066-11e4-a52e-4f735466cecf': 'native-control' }];
      else if (path.endsWith('/click')) clicks++;
      else if (path.endsWith('/appium/device/press_keycode')) homeRequests++;
      else if (path.endsWith('/screenshot')) value = tinyPng;
      return Response.json({ value });
    });
    const result = await runCapability(client, target, testFixture, {
      localIdentifier: 'local-id',
      buildName: 'test',
      journal: async (value) => {
        if (
          value.observations.at(-1)?.stage.endsWith(':item-readiness-failure') &&
          !value.finishedAt
        ) {
          diagnosticWrites++;
          throw new Error('diagnostic-journal-unavailable');
        }
        journals.push(structuredClone(value));
      },
      screenshot: async (name) => name,
    });
    assert.equal(result.stage, 'production-downloads');
    assert.equal(result.nativeActions.filter((action) => action.label === 'Add').length, 1);
    assert.equal(
      result.failure,
      mode === 'storage-error-after-loading'
        ? 'capability-production-storage-unavailable'
        : 'http-500',
    );
    assert.equal(result.command, 'POST session/{sessionId}/execute/sync');
    assert.equal(reads, mode === 'navigation-http-error' ? 0 : mode === 'http-error' ? 1 : 2);
    assert.equal(navigationCommands, 1);
    assert.deepEqual(urlWrites, [origin]);
    assert.equal(diagnosticWrites, 0);
    const observations = journals
      .at(-1)!
      .observations.filter((entry) => entry.stage.endsWith(':item-readiness-failure'));
    assert.equal(observations.length, mode === 'navigation-http-error' ? 0 : 1);
    if (mode !== 'navigation-http-error')
      assert.deepEqual(observations[0].value, {
        operation: 'item-readiness',
        offline: false,
        reads,
        last:
          mode === 'http-error'
            ? null
            : {
                phase: 'storage',
                readyState: 'complete',
                bodyPresent: true,
                originMatch: true,
                documentReady: true,
                failure: 'storage-unavailable',
                errorName: 'SecurityError',
              },
      });
    const navigation = result.observations.find((entry) =>
      entry.stage.endsWith(':item-navigation'),
    )!.value as Record<string, unknown>;
    assert.equal(navigation.assignmentAttempted, true);
    assert.equal(navigation.assignmentAcknowledged, mode !== 'navigation-http-error');
    assert.equal(navigation.phase, mode === 'navigation-http-error' ? 'assign' : 'verified');
    assert.equal(
      result.timing?.commands.find((entry) => entry.outcome === 'failed')?.webdriverErrorCode,
      mode === 'navigation-http-error'
        ? 'unknown error'
        : mode === 'http-error'
          ? 'javascript error'
          : undefined,
    );
    assert.equal(result.cleanup.session, 'deleted');
    assert.equal(result.cleanup.network, 'restored-4g-lte-good');
    assert.equal(result.cleanup.fixture, 'closed');
    assert.doesNotMatch(JSON.stringify(result), /private script|private-bootstrap|fixture-key/);
  }
});

test('known allocations retain original failures and bounded cleanup while validating failure screenshots', async () => {
  for (const screenshotResponse of ['http-error', 'invalid-object', 'invalid-png', 'wrapped-png']) {
    const deletionFails = screenshotResponse === 'http-error';
    const events: string[] = [],
      journals: CapabilityResult[] = [];
    const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
      const path = String(url).split('/wd/hub/')[1] ?? String(url).split('/automate/')[1];
      events.push(`${init?.method} ${path}`);
      assert.ok(init?.signal);
      if (path === 'session') {
        assert.equal(journals.at(-1)?.allocation, 'uncertain');
        assert.equal(journals.at(-1)?.uncertainAllocation, true);
        return Response.json({ value: { sessionId, capabilities: { browserName: 'chrome' } } });
      }
      if (path.endsWith('/url')) {
        assert.equal(journals.at(-1)?.sessionId, sessionId);
        return Response.json(
          {
            value: {
              error: 'javascript error',
              message: 'fixture-key /_desktop-login/private-bootstrap',
              stacktrace: 'private provider stack',
            },
          },
          { status: 500 },
        );
      }
      if (path.endsWith('update_network.json')) {
        assert.equal(init?.method, 'PUT');
        assert.deepEqual(JSON.parse(String(init?.body)), { networkProfile: '4g-lte-good' });
        return Response.json({ success: true });
      }
      if (init?.method === 'DELETE' && deletionFails)
        return new Response('private provider error', { status: 500 });
      if (path.endsWith('/screenshot')) {
        if (screenshotResponse === 'http-error')
          return new Response('private screenshot error', { status: 408 });
        return Response.json({
          value:
            screenshotResponse === 'invalid-object'
              ? { value: 'private screenshot data', token: 'private screenshot token' }
              : screenshotResponse === 'wrapped-png'
                ? tinyPng.replace(/(.{12})/g, '$1\r\n')
                : tinyPng + ' ',
        });
      }
      return Response.json({ value: null });
    });
    const result = await runCapability(
      client,
      target,
      fixture(() => events.push('fixture-close')),
      {
        localIdentifier: 'local-id',
        buildName: 'test',
        journal: async (value) => {
          journals.push(structuredClone(value));
        },
        screenshot: async (name, data) => {
          assert.equal(screenshotResponse, 'wrapped-png');
          assert.equal(data, tinyPng);
          return name;
        },
      },
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.stage, 'anonymous-https');
    assert.equal(result.command, 'POST session/{sessionId}/url');
    assert.equal(result.failure, 'http-500');
    assert.equal(
      result.timing?.commands.find((entry) => entry.command === 'POST session/{sessionId}/url')
        ?.webdriverErrorCode,
      'javascript error',
    );
    assert.equal(events.filter((event) => event === `POST session/${sessionId}/url`).length, 1);
    assert.deepEqual(
      result.observations.find(
        (observation) =>
          (observation.value as { screenshot?: string })?.screenshot === 'unavailable',
      ),
      screenshotResponse === 'wrapped-png'
        ? undefined
        : {
            stage: 'anonymous-https',
            value: {
              screenshot: 'unavailable',
              failure:
                screenshotResponse === 'http-error' ? 'http-408' : 'capability-screenshot-invalid',
              ...(screenshotResponse === 'http-error'
                ? {}
                : {
                    responseShape:
                      screenshotResponse === 'invalid-object'
                        ? { type: 'object', keyCount: 2 }
                        : {
                            type: 'string',
                            length: tinyPng.length + 1,
                            sampledCharacters: tinyPng.length + 1,
                            sampleBase64Alphabet: false,
                            sampleHasWhitespace: true,
                            dataURLPrefix: false,
                          },
                  }),
            },
          },
    );
    assert.deepEqual(
      result.screenshots,
      screenshotResponse === 'wrapped-png' ? ['chrome-failure'] : [],
    );
    assert.equal(result.cleanup.network, 'restored-4g-lte-good');
    assert.equal(result.cleanup.session, deletionFails ? 'delete-failed' : 'deleted');
    assert.equal(result.cleanup.fixture, 'closed');
    assert.equal(result.uncertainAllocation, deletionFails);
    assert.deepEqual(events.slice(-3), [
      `PUT sessions/${sessionId}/update_network.json`,
      `DELETE session/${sessionId}`,
      'fixture-close',
    ]);
    assert.doesNotMatch(
      JSON.stringify(result),
      /fixture-key|private-bootstrap|private provider error|private screenshot|iVBORw0KGgo/,
    );
  }
});

test('buffered command timing records allotted budget and observed deadline flags without replaying or logging bodies', async (context) => {
  let clock = Date.now();
  context.mock.method(Date, 'now', () => clock);
  const calls: string[] = [];
  const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
    const path = String(url).split('/wd/hub/')[1] ?? String(url).split('/automate/')[1];
    calls.push(`${init?.method} ${path}`);
    if (path === 'session') {
      clock += 25;
      return Response.json({ value: { sessionId, capabilities: { browserName: 'chrome' } } });
    }
    if (path.endsWith('/url')) {
      clock += 179_976;
      return new Response('private provider detail /_desktop-login/private-bootstrap', {
        status: 408,
      });
    }
    return Response.json({ value: null });
  });
  const result = await runCapability(
    client,
    target,
    fixture(() => {}),
    {
      localIdentifier: 'local-id',
      buildName: 'test',
      journal: async () => {},
      screenshot: async () => {
        throw new Error('A depleted lane cannot attempt a capture.');
      },
    },
  );
  assert.equal(result.failure, 'http-408');
  assert.equal(result.timing?.commands.length, 2);
  assert.equal(result.timing?.commands[0].timeoutMilliseconds, 45_000);
  assert.deepEqual(result.timing?.commands[1], {
    stage: 'anonymous-https',
    command: 'POST session/{sessionId}/url',
    startedElapsedMilliseconds: 25,
    durationMilliseconds: 179_976,
    timeoutMilliseconds: 15_000,
    remainingAtStartMilliseconds: 179_975,
    outcome: 'failed',
    failure: 'http-408',
    laneAborted: false,
    commandAborted: false,
    deadlineReached: true,
    remainingAtEndMilliseconds: 0,
  });
  assert.deepEqual(result.timing?.failure, {
    elapsedMilliseconds: 180_001,
    remainingMilliseconds: 0,
    laneAborted: false,
    deadlineReached: true,
  });
  assert.equal(result.timing?.totalElapsedMilliseconds, 180_001);
  assert.equal(result.timing?.cleanupElapsedMilliseconds, 0);
  assert.equal(calls.filter((call) => call.endsWith('/url')).length, 1);
  assert.equal(calls.filter((call) => call.endsWith('/screenshot')).length, 0);
  assert.equal(result.cleanup.session, 'deleted');
  assert.equal(result.cleanup.network, 'restored-4g-lte-good');
  assert.equal(result.cleanup.fixture, 'closed');
  assert.doesNotMatch(JSON.stringify(result.timing), /private|fixture-key|bs-local|capabilities/);
  assert.ok(!JSON.stringify(result.timing).includes(sessionId));
});

test('uncertain creation remains held and never fabricates a session deletion', async () => {
  const calls: string[] = [];
  const client = clientFor('fixture-user', 'fixture-key', async (_url, init) => {
    calls.push(String(init?.method));
    throw new Error('fixture-key remote details');
  });
  let closed = false;
  const result = await runCapability(
    client,
    target,
    fixture(() => {
      closed = true;
    }),
    {
      localIdentifier: 'local-id',
      buildName: 'test',
      journal: async () => {},
      screenshot: async (name) => name,
    },
  );
  assert.equal(result.sessionId, undefined);
  assert.equal(result.allocation, 'uncertain');
  assert.equal(result.uncertainAllocation, true);
  assert.equal(result.failure, 'request-failed');
  assert.deepEqual(calls, ['POST']);
  assert.equal(closed, true);
});

test('a failed preallocation journal prevents the allocation request and still closes the fixture', async () => {
  let providerCalls = 0,
    closed = false;
  const client = clientFor('fixture-user', 'fixture-key', async () => {
    providerCalls++;
    return Response.json({ value: null });
  });
  await assert.rejects(
    runCapability(
      client,
      target,
      fixture(() => {
        closed = true;
      }),
      {
        localIdentifier: 'local-id',
        buildName: 'test',
        journal: async () => {
          throw new Error('disk unavailable');
        },
        screenshot: async (name) => name,
      },
    ),
  );
  assert.equal(providerCalls, 0);
  assert.equal(closed, true);
});
