import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readAdmissionPolicy, type ReservationIdentity } from './browserstack-admission.ts';
import {
  launchedWindow,
  nativeControls,
  preparedCapabilityJournal,
  readPreparedCapabilityJournal,
  runCapability,
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
