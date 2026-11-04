import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const root = '/tmp/spn141-handoff';
const source = 'c4e64fa110a57d70fb682649d7f4d45ca3d20951';
const tested = '4be35332dda5e805c7fd8c45d69099b535c3000f';
const summaries = [];
for (const browser of ['safari', 'chrome', 'firefox']) {
  const report = JSON.parse(readFileSync(`${root}/${browser}/${browser}/acceptance.json`, 'utf8'));
  assert.equal(report.sourceSha, source);
  assert.equal(report.testedSha, tested);
  assert.equal(report.status, 'passed');
  assert.equal(report.error, undefined);
  assert.equal(report.teardownError, undefined);
  const stages = report.stages as Array<Record<string, any>>;
  const named = (name: string) => stages.filter(stage => stage.name === name);
  const one = (name: string) => { const found = named(name); assert.equal(found.length, 1, name); return found[0]; };
  for (const name of ['all-four-downloads-complete', 'offline-catalog-and-original-records-retained', 'native-offline-edits-committed', 'complete']) one(name);
  assert.equal(named('pending-restart-retained').length, 4);
  assert.equal(new Set(named('pending-restart-retained').map(stage => stage.itemId)).size, 4);
  assert.equal(named('normal-reconnect-exact-content-once').length, 2);
  assert.ok(named('normal-reconnect-exact-content-once').every(stage => stage.revision === 2));
  assert.equal(named('conflict-copy-preserves-original').length, 2);
  const launches = report.launches;
  assert.equal(launches.length, 4);
  assert.equal(new Set(launches.map((entry: any) => entry.browserPid)).size, 4);
  for (const launch of launches) { assert.deepEqual(launch.profile, launches[0].profile); assert.equal(launch.version, report.release.installed); }
  const exits = stages.filter(stage => stage.name.startsWith('browser-stop'));
  assert.equal(exits.length, 4);
  for (const launch of launches) assert.ok(exits.some(exit => exit.browserPid === launch.browserPid && exit.browserExited === true && exit.driverExited === true));
  for (const name of ['storage-loss-tabs-prepared', 'storage-loss-tabs-handed-off', 'storage-loss-tabs-restarted']) {
    const inventory = one(name);
    const expected = 'https://localhost:8176/_desktop-storage-loss' + (name === 'storage-loss-tabs-prepared' ? '' : '?phase=uncontrolled');
    assert.ok(inventory.after.length > 0);
    assert.ok(inventory.after.every((url: string) => new URL(url).origin !== 'https://localhost:8176' || url === expected));
    if (name === 'storage-loss-tabs-handed-off') {
      assert.equal(inventory.documents.length, inventory.after.filter((url: string) => url === expected).length);
      assert.ok(inventory.documents.length > 0);
      for (const state of inventory.documents) assert.deepEqual(state, {url: expected, fresh: true, ready: 'complete', marker: 'inert', scripts: 0, controller: null});
    }
  }
  const preparation = one('storage-loss-unregistration').preparation;
  const quiescence = one('storage-loss-quiescence-before-stop').quiescence;
  const deletion = one('storage-deletion').deletion;
  for (const value of [preparation, quiescence, deletion]) {
    assert.equal(value.status, 'passed');
    assert.equal(value.timeoutMs, 28000);
    assert.ok(value.operations.every((operation: any) => operation.status === 'passed'));
  }
  assert.equal(quiescence.phase, 'verify');
  assert.deepEqual(quiescence.operations.map((op: any) => op.name), ['verify-preparation-document', 'serviceWorker.getRegistrations', 'verify-uncontrolled']);
  assert.deepEqual(quiescence.operations.at(-1).value, {workers: [], controller: null});
  const order = ['storage-loss-unregistration', 'storage-loss-tabs-handed-off', 'storage-loss-quiescence-before-stop', 'browser-stop-before-storage-loss', 'storage-loss-tabs-restarted', 'storage-deletion'];
  for (let i = 1; i < order.length; i++) assert.ok(stages.indexOf(one(order[i-1])) < stages.indexOf(one(order[i])));
  const uncontrolled = deletion.operations.find((operation: any) => operation.name === 'verify-uncontrolled').value;
  assert.deepEqual(uncontrolled, { workers: [], controller: null });
  const empty = deletion.operations.find((operation: any) => operation.name === 'verify-storage-empty').value;
  assert.deepEqual(empty.workers, []); assert.deepEqual(empty.cacheNames, []);
  assert.equal(empty.localStorageEntries, 0);
  assert.equal(deletion.database, `spinel-offline-${report.actor.id}`);
  assert.ok(!empty.databases.includes(deletion.database));
  assert.deepEqual(one('cleared-storage-is-not-advertised').lost, { account: null, available: 0 });
  const unavailable = one('missing-data-cannot-open-offline').message;
  assert.match(unavailable, /You're offline/); assert.match(unavailable, /Connect to the internet/);
  assert.ok(!unavailable.includes('Saved on this device'));
  assert.equal(report.transport.activeBrowserSockets, 0);
  summaries.push({ browser, source, tested, attempt: report.attempt, version: report.release.installed, profile: launches[0].profile, launchPids: launches.map((entry: any) => entry.browserPid), stages: stages.length, preparation, quiescence, deletion, postLoss: unavailable, status: 'passed' });
}
const probe = JSON.parse(readFileSync(`${root}/safari/safari-profile-probe.json`, 'utf8'));
assert.equal(probe.sourceSha, source); assert.equal(probe.testedSha, tested); assert.equal(probe.status, 'passed');
assert.equal(probe.teardownError, undefined); assert.equal(probe.safariTargets.length, 2);
assert.ok(probe.safariTargets.every((target: any) => target.phase === 'identity-established' && target.elapsedMs < 8000));
assert.equal(probe.retained.localStorage, probe.retained.indexedDB); assert.equal(probe.retained.localStorage, probe.retained.cache); assert.equal(probe.retained.worker, true);
for (const name of ['online', 'offline']) {
  const baseline = probe.paintBaselines[name];
  assert.equal(baseline.state.title, 'Spinel desktop profile probe');
  assert.ok(baseline.state.bounds.width > 0 && baseline.state.bounds.height > 0);
}
writeFileSync(`${root}/native-validation.json`, JSON.stringify({ scope: 'Retained record/source identity and lifecycle checks; full snapshot assertions belong to the exact executed harness', source, tested, owners: summaries, safariCapability: 'passed' }, null, 2) + '\n');
console.log('All three retained native records match the source, lifecycle and strict storage contracts.');
