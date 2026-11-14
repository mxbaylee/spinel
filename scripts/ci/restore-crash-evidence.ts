/** Recovery partition receipt owner. Missing, stale or failed crash evidence cannot pass. */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  crashSource,
  restoreCrashCases,
} from '../../src/server/maintenance/restore-crash-evidence.ts';
import type {
  CrashSource,
  RestoreCrashReceipt,
} from '../../src/server/maintenance/restore-crash-evidence.ts';
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const fingerprint = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown) =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const number = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function keys(value: unknown, expected: string): asserts value is Record<string, unknown> {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    'Expected receipt object.',
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    expected.split(' ').sort(),
    'Unknown or missing receipt field.',
  );
}
const phases: Record<string, string> = {
  admission: 'accepted',
  custody: 'originals-retained',
  freeze: 'frozen',
  'activation-plan': 'activation-planned',
  staging: 'candidate-staged',
  activation: 'candidate-replacing',
  'private-open': 'trial-opening',
  commit: 'candidate-committed',
  postcommit: 'candidate-committed',
  'original-activation': 'original-replacing',
  'original-commit': 'original-committed',
  'cold-admission': 'original-capture-planned',
  'cold-prepared': 'original-prepared',
  'cold-activation': 'original-replacing',
  'cold-trial-planned': 'original-trial-planned',
  'cold-private-open': 'original-trial-opening',
  'cold-commit': 'original-committed',
};
export function verifyCrashReceipts(values: unknown[], source: CrashSource) {
  keys(source, 'head tested tree run attempt');
  assert.ok([source.head, source.tested, source.tree].every(sha));
  assert.ok([source.run, source.attempt].every((v) => v === null || /^\d+$/.test(v)));
  assert.equal(values.length, restoreCrashCases.length, 'Every distinct crash cut is required.');
  const seen = new Set<string>();
  for (const value of values) {
    keys(
      value,
      'version case source result snapshots observedFrozen controllers resources cuts terminations primaryFailure secondaryFailures cleanup',
    );
    const r = value as unknown as RestoreCrashReceipt;
    assert.ok(
      restoreCrashCases.includes(r.case) && !seen.has(r.case),
      'Unknown or duplicate crash case.',
    );
    seen.add(r.case);
    assert.equal(r.version, 1);
    assert.deepEqual(r.source, source, 'Source/tested identity mismatch.');
    assert.equal(r.result, 'passed', 'Original crash test failed.');
    assert.equal(r.primaryFailure, null);
    assert.deepEqual(r.secondaryFailures, []);
    keys(r.cleanup, 'closure temporaryData');
    assert.deepEqual(r.cleanup, { closure: 'passed', temporaryData: 'removed' });
    assert.ok(
      Array.isArray(r.controllers) && r.controllers.length > 1 && r.controllers.length <= 64,
    );
    for (const c of r.controllers) {
      keys(c, 'pid initial cold cleanup exitCode signal');
      assert.ok(number(c.pid) && Number(c.pid) > 0);
      assert.ok([c.initial, c.cold, c.cleanup].every((x) => typeof x === 'boolean'));
      assert.ok(c.exitCode === null || number(c.exitCode));
      assert.ok(c.signal === null || ['SIGKILL', 'SIGTERM'].includes(c.signal));
      assert.ok(c.exitCode !== null || c.signal !== null, 'Controller closure unproved.');
    }
    const cold = r.case.startsWith('cold-');
    const originalCut = cold ? 'original-activation' : r.case;
    assert.ok(Array.isArray(r.cuts));
    assert.deepEqual(
      r.cuts.map((c) => c.name),
      cold ? [originalCut, r.case] : [originalCut],
    );
    for (const c of r.cuts) {
      keys(c, 'name pid bytesWritten');
      assert.ok(number(c.pid) && c.pid > 0);
      assert.ok(c.bytesWritten === null || number(c.bytesWritten));
    }
    assert.ok(
      Array.isArray(r.terminations) &&
        r.terminations.length === (cold || r.case === 'postcommit' ? 2 : 1),
    );
    for (const k of r.terminations) {
      keys(k, 'pid action signal released');
      assert.ok(number(k.pid) && k.pid > 0);
      assert.equal(k.released, true);
      if (k.action === 'sigkill') assert.equal(k.signal, 'SIGKILL');
      else {
        assert.equal(k.action, 'already-exited');
        assert.equal(k.signal, null);
        assert.ok(
          r.controllers.some((c) => c.pid === k.pid && (c.exitCode !== null || c.signal !== null)),
          'No-op termination requires an observed terminal controller.',
        );
      }
    }
    assert.ok(
      r.terminations.some((k) => k.action === 'sigkill'),
      'Actual SIGKILL cut missing.',
    );
    if (r.case === 'postcommit')
      assert.ok(
        r.snapshots[0].plannedChild &&
          r.terminations.some(
            (k) => k.pid === r.snapshots[0].plannedChild!.pid && k.action === 'sigkill',
          ),
        'Postcommit must SIGKILL its exact application writer.',
      );
    const initial = r.controllers.find((c) => c.initial);
    assert.ok(
      initial && r.terminations.some((k) => k.pid === initial.pid),
      'Initial controller kill unproved.',
    );
    if (cold)
      assert.ok(
        r.controllers.some((c) => c.cold && r.terminations.some((k) => k.pid === c.pid)),
        'Cold controller kill unproved.',
      );
    const recovers =
      cold ||
      ['activation', 'private-open', 'original-activation', 'original-commit'].includes(r.case);
    const expectedStages = [
      'cut',
      ...(cold ? ['cold-cut'] : []),
      ...(recovers ? ['recovered'] : []),
      'completed',
    ];
    assert.deepEqual(
      r.snapshots.map((s) => s.stage),
      expectedStages,
    );
    for (const s of r.snapshots) {
      keys(
        s,
        'stage phase operationId intentHash generation fingerprints authority child plannedChild',
      );
      assert.ok(uuid(s.operationId) && fingerprint(s.intentHash));
      assert.equal(s.operationId, r.snapshots[0].operationId);
      assert.equal(s.intentHash, r.snapshots[0].intentHash);
      keys(s.generation, 'original current selected');
      assert.ok(uuid(s.generation.original) && uuid(s.generation.current));
      assert.ok(s.generation.selected === null || uuid(s.generation.selected));
      keys(
        s.fingerprints,
        'stopped frozen frozenBoundary preparedOriginal outcome live liveBoundary',
      );
      for (const f of [
        s.fingerprints.stopped,
        s.fingerprints.frozen,
        s.fingerprints.preparedOriginal,
        s.fingerprints.outcome,
        s.fingerprints.live,
      ])
        assert.ok(f === null || fingerprint(f));
      assert.equal(
        s.fingerprints.frozenBoundary,
        s.fingerprints.frozen ? 'created' : 'not-created-at-this-journal-phase',
      );
      assert.equal(
        s.fingerprints.liveBoundary,
        s.fingerprints.live ? 'closed-read-only-probe' : 'not-opened-at-this-boundary',
      );
      if (s.fingerprints.frozen) assert.equal(s.fingerprints.frozen, s.fingerprints.stopped);
      keys(
        s.authority,
        'confirmedAt originalExpiresAt currentOperationMatches currentAuthority currentExpiresAt cold',
      );
      assert.ok(
        number(s.authority.confirmedAt) &&
          number(s.authority.originalExpiresAt) &&
          s.authority.originalExpiresAt > s.authority.confirmedAt,
      );
      assert.equal(s.authority.originalExpiresAt, r.snapshots[0].authority.originalExpiresAt);
      assert.ok(typeof s.authority.currentOperationMatches === 'boolean');
      assert.ok(
        ['none', 'original-session', 'private-host'].includes(s.authority.currentAuthority),
      );
      assert.ok(s.authority.currentExpiresAt === null || number(s.authority.currentExpiresAt));
      assert.ok(Array.isArray(s.authority.cold) && s.authority.cold.length <= 8);
      for (const a of s.authority.cold) {
        keys(a, 'grantedAt deadline priorGeneration generation bootEpoch phase');
        assert.ok(number(a.grantedAt) && number(a.deadline) && a.deadline > a.grantedAt);
        assert.ok(a.grantedAt > s.authority.originalExpiresAt);
        assert.ok([a.priorGeneration, a.generation, a.bootEpoch].every(uuid));
        assert.ok(/^original-[a-z-]+$/.test(a.phase));
      }
      for (const process of [s.child, s.plannedChild])
        if (process) {
          keys(process, 'pid boot start');
          assert.ok(number(process.pid) && uuid(process.boot) && /^\d+$/.test(process.start));
        }
    }
    assert.equal(r.snapshots[0].phase, phases[originalCut]);
    assert.ok(Array.isArray(r.resources));
    for (const resource of r.resources) keys(resource, 'pid boundary released');
    if (r.case === 'cold-trial-planned') {
      const pid = r.snapshots[1].plannedChild?.pid;
      assert.ok(pid);
      assert.deepEqual(r.resources, [
        { pid, boundary: 'cold-restart', released: false },
        { pid, boundary: 'cold-recovered', released: true },
      ]);
    } else assert.deepEqual(r.resources, []);
    if (originalCut !== 'admission') assert.ok(fingerprint(r.snapshots[0].fingerprints.stopped));
    if (!['admission', 'custody'].includes(originalCut))
      assert.ok(r.snapshots[0].fingerprints.frozen);
    if (cold) {
      const s = r.snapshots[1];
      assert.equal(s.phase, phases[r.case]);
      assert.ok(s.authority.cold.length);
    }
    if (recovers) {
      assert.ok(fingerprint(r.observedFrozen));
      assert.equal(r.observedFrozen, r.snapshots[0].fingerprints.frozen);
      const recovered = r.snapshots.find((s) => s.stage === 'recovered')!;
      assert.ok(fingerprint(recovered.fingerprints.preparedOriginal));
      assert.equal(recovered.fingerprints.live, recovered.fingerprints.preparedOriginal);
      assert.equal(recovered.fingerprints.outcome, recovered.fingerprints.preparedOriginal);
      assert.equal(recovered.phase, 'original-committed');
      assert.equal(recovered.generation.current, recovered.generation.selected);
      assert.notEqual(recovered.generation.current, recovered.generation.original);
    } else assert.equal(r.observedFrozen, null);
    const final = r.snapshots.at(-1)!;
    assert.ok(fingerprint(final.fingerprints.live));
    assert.equal(
      final.phase,
      recovers
        ? 'original-committed'
        : ['commit', 'postcommit'].includes(r.case)
          ? 'candidate-committed'
          : 'failed',
    );
  }
  return { cases: [...seen], source, passed: true };
}
if (import.meta.main) {
  const directory = process.env.SPINEL_CRASH_EVIDENCE_DIR ?? 'test-results/restore-crash';
  const source = crashSource();
  if (process.argv[2] === 'begin') {
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory); // Refuse stale output; never erase an earlier attempt.
    await writeFile(join(directory, 'source.json'), JSON.stringify(source) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } else if (process.argv[2] === 'verify') {
    const names = await readdir(directory);
    assert.deepEqual(
      names.sort(),
      ['source.json', ...restoreCrashCases.map((c) => c + '.json')].sort(),
    );
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'source.json'), 'utf8')), source);
    const values = await Promise.all(
      restoreCrashCases.map(async (c) =>
        JSON.parse(await readFile(join(directory, c + '.json'), 'utf8')),
      ),
    );
    console.log(JSON.stringify(verifyCrashReceipts(values, source)));
  } else throw Error('Expected begin or verify.');
}
