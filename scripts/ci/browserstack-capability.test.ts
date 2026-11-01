import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { readAdmissionPolicy, type ReservationIdentity } from './browserstack-admission.ts';
import {
  capabilityOutcome,
  installConfirmationLabels,
  installMenuLabel,
  launchedWindow,
  matchingNativeControl,
  nativeControls,
  observeBrowserTask,
  openNativeShare,
  preparedCapabilityJournal,
  readPreparedCapabilityJournal,
  runCapability,
  runCapabilityLane,
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

test('native controls are derived from visible device XML with decoded exact labels', () => {
  const controls = nativeControls(
    '<hierarchy><node text="Install &amp; open" content-desc="Add to Home screen" enabled="true"/><node text="Spinel" visible="false"/><XCUIElementTypeButton label="Add" enabled="true"/></hierarchy>',
  );
  assert.equal(controls.length, 2);
  assert.equal(controls[0].attributes.text, 'Install & open');
  assert.equal(controls[0].attributes['content-desc'], 'Add to Home screen');
  assert.equal(controls[1].type, 'XCUIElementTypeButton');
  assert.throws(() => nativeControls({ source: 'not XML' }), /capability-native-source-invalid/);
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
    matchingNativeControl(
      nativeControls('<node text="Do not install this app"/>'),
      installMenuLabel,
    ),
    null,
  );
  assert.equal(
    matchingNativeControl(
      nativeControls('<Button text="Create shortcut"/><Button text="Install"/>'),
      installConfirmationLabels,
    )?.label,
    'Install',
  );
  assert.equal(
    matchingNativeControl(
      nativeControls('<Button text="Install" enabled="false"/><Button text="Create shortcut"/>'),
      installConfirmationLabels,
    )?.label,
    'Create shortcut',
  );
  assert.equal(
    matchingNativeControl(
      nativeControls('<Button text="Cancel"/><Button text="Add"/>'),
      installConfirmationLabels,
    )?.label,
    'Add',
  );
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
test('known allocations journal their ID before failure and restore then delete within bounded cleanup', async () => {
  for (const deletionFails of [false, true]) {
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
        return new Response('fixture-key /_desktop-login/private-bootstrap', { status: 500 });
      }
      if (path.endsWith('update_network.json')) {
        assert.equal(init?.method, 'PUT');
        assert.deepEqual(JSON.parse(String(init?.body)), { networkProfile: '4g-lte-good' });
        return Response.json({ success: true });
      }
      if (init?.method === 'DELETE' && deletionFails)
        return new Response('private provider error', { status: 500 });
      return Response.json({ value: path.endsWith('/screenshot') ? 'aGVsbG8=' : null });
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
        screenshot: async (name) => name,
      },
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.stage, 'anonymous-https');
    assert.equal(result.command, 'POST session/{sessionId}/url');
    assert.equal(result.failure, 'http-500');
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
      /fixture-key|private-bootstrap|private provider error/,
    );
  }
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
