import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyCrashReceipts } from './restore-crash-evidence.ts';
import {
  crashSnapshot,
  captureCrashCut,
  finishCrashReceipt,
  restoreCrashCases,
  writeCrashReceipt,
} from '../../src/server/maintenance/restore-crash-evidence.ts';
import type { RestoreCrashReceipt } from '../../src/server/maintenance/restore-crash-evidence.ts';
import type { RestoreJobRecord } from '../../src/server/maintenance/restore-jobs.ts';
import type { RecoveryJournalState } from '../../src/server/maintenance/journal.ts';
const id = '11111111-1111-4111-8111-111111111111',
  next = '22222222-2222-4222-8222-222222222222';
const source = {
  head: 'a'.repeat(40),
  tested: 'b'.repeat(40),
  tree: 'c'.repeat(40),
  run: '123',
  attempt: '1',
};
const original = 'a'.repeat(64),
  prepared = 'b'.repeat(64),
  later = 'c'.repeat(64);
const phases = [
  'accepted',
  'originals-retained',
  'frozen',
  'activation-planned',
  'candidate-staged',
  'candidate-replacing',
  'trial-opening',
  'candidate-committed',
  'candidate-committed',
  'original-replacing',
  'original-committed',
  'original-capture-planned',
  'original-prepared',
  'original-replacing',
  'original-trial-planned',
  'original-trial-opening',
  'original-committed',
] as const;
function complete(): RestoreCrashReceipt[] {
  return restoreCrashCases.map((name, index) => {
    const cold = name.startsWith('cold-'),
      recovers = cold || [5, 6, 9, 10].includes(index);
    const snapshot = (
      stage: 'cut' | 'cold-cut' | 'recovered' | 'completed',
      phase: RestoreCrashReceipt['snapshots'][number]['phase'],
    ): RestoreCrashReceipt['snapshots'][number] => ({
      stage,
      phase,
      operationId: id,
      intentHash: 'd'.repeat(64),
      generation: { original: id, current: next, selected: next },
      fingerprints: {
        stopped: index === 0 ? null : original,
        frozen: index < 2 ? null : original,
        frozenBoundary: index < 2 ? 'not-created-at-this-journal-phase' : 'created',
        preparedOriginal: recovers ? prepared : null,
        outcome: recovers ? prepared : null,
        live: stage === 'recovered' ? prepared : stage === 'completed' ? later : null,
        liveBoundary: ['recovered', 'completed'].includes(stage)
          ? 'closed-read-only-probe'
          : 'not-opened-at-this-boundary',
      },
      authority: {
        confirmedAt: 1,
        originalExpiresAt: 1800001,
        currentOperationMatches: true,
        currentAuthority: cold ? 'private-host' : 'original-session',
        currentExpiresAt: 1800001,
        cold: cold
          ? [
              {
                grantedAt: 1800002,
                deadline: 1890002,
                priorGeneration: id,
                generation: next,
                bootEpoch: id,
                phase: 'original-committed',
              },
            ]
          : [],
      },
      child: null,
      plannedChild:
        name === 'cold-trial-planned' || name === 'postcommit'
          ? { pid: 12, boot: id, start: '42' }
          : null,
    });
    return {
      version: 1,
      case: name,
      source: { ...source },
      result: 'passed',
      snapshots: [
        snapshot('cut', cold ? 'original-replacing' : phases[index]),
        ...(cold ? [snapshot('cold-cut', phases[index])] : []),
        ...(recovers ? [snapshot('recovered', 'original-committed')] : []),
        snapshot(
          'completed',
          recovers
            ? 'original-committed'
            : [7, 8].includes(index)
              ? 'candidate-committed'
              : 'failed',
        ),
      ],
      observedFrozen: recovers ? original : null,
      resources:
        name === 'cold-trial-planned'
          ? [
              { pid: 12, boundary: 'cold-restart', released: false },
              { pid: 12, boundary: 'cold-recovered', released: true },
            ]
          : [],
      controllers: [
        { pid: 10, initial: true, cold: false, cleanup: false, exitCode: null, signal: 'SIGKILL' },
        {
          pid: 11,
          initial: false,
          cold,
          cleanup: false,
          exitCode: null,
          signal: cold ? 'SIGKILL' : 'SIGTERM',
        },
      ],
      cuts: [
        { name: cold ? 'original-activation' : name, pid: 10, bytesWritten: null },
        ...(cold ? [{ name, pid: 11, bytesWritten: null }] : []),
      ],
      terminations: [
        { pid: 10, action: 'sigkill' as const, signal: 'SIGKILL', released: true },
        ...(cold
          ? [{ pid: 11, action: 'sigkill' as const, signal: 'SIGKILL', released: true }]
          : []),
        ...(name === 'postcommit'
          ? [{ pid: 12, action: 'sigkill' as const, signal: 'SIGKILL', released: true }]
          : []),
      ],
      primaryFailure: null,
      secondaryFailures: [],
      cleanup: { closure: 'passed', temporaryData: 'removed' },
    };
  });
}
test('complete distinct cuts bind head, tested checkout and actual recovered versus later live content', () => {
  assert.equal(verifyCrashReceipts(complete(), source).cases.length, 17);
});
test('missing, duplicate, failed and stale receipts cannot satisfy recovery coverage', () => {
  for (const mutate of [
    (r: RestoreCrashReceipt[]) => {
      r.pop();
    },
    (r: RestoreCrashReceipt[]) => {
      r[1] = r[0];
    },
    (r: RestoreCrashReceipt[]) => {
      r[2].result = 'failed';
    },
    (r: RestoreCrashReceipt[]) => {
      r[2].source.head = 'd'.repeat(40);
    },
    (r: RestoreCrashReceipt[]) => {
      r[2].source.tested = 'd'.repeat(40);
    },
    (r: RestoreCrashReceipt[]) => {
      r[2].source.attempt = '2';
    },
  ]) {
    const r = complete();
    mutate(r);
    assert.throws(() => verifyCrashReceipts(r, source));
  }
});
test('unproved terminations, cleanup, fingerprints, phases and cold authority cannot pass', () => {
  for (const mutate of [
    (r: RestoreCrashReceipt[]) => {
      r[14].resources[0].released = true;
    },
    (r: RestoreCrashReceipt[]) => {
      r[5].terminations[0].signal = 'SIGTERM';
    },
    (r: RestoreCrashReceipt[]) => {
      r[5].terminations[0].pid = 99;
    },
    (r: RestoreCrashReceipt[]) => {
      r[5].controllers[0].signal = null;
    },
    (r: RestoreCrashReceipt[]) => {
      r[5].cleanup.closure = 'failed';
    },
    (r: RestoreCrashReceipt[]) => {
      r[5].cleanup.temporaryData = 'retained';
    },
    (r: RestoreCrashReceipt[]) => {
      r[5].observedFrozen = null;
    },
    (r: RestoreCrashReceipt[]) => {
      r[5].snapshots[1].fingerprints.live = later;
    },
    (r: RestoreCrashReceipt[]) => {
      r[2].snapshots[0].fingerprints.frozen = null;
    },
    (r: RestoreCrashReceipt[]) => {
      r[11].snapshots.splice(1, 1);
    },
    (r: RestoreCrashReceipt[]) => {
      r[11].snapshots[1].authority.cold[0].grantedAt = 1800000;
    },
  ]) {
    const r = complete();
    mutate(r);
    assert.throws(() => verifyCrashReceipts(r, source));
  }
});
test('unknown private fields are rejected at nested source/authority/process boundaries', () => {
  for (const target of ['root', 'source', 'authority', 'child']) {
    const r = complete();
    const secret = { token: 'never-publish-private-material' };
    if (target === 'root') Object.assign(r[0], secret);
    if (target === 'source') Object.assign(r[0].source, secret);
    if (target === 'authority') Object.assign(r[0].snapshots[0].authority, secret);
    if (target === 'child') Object.assign(r[0].controllers[0], secret);
    assert.throws(() => verifyCrashReceipts(r, source));
  }
});
test('projection omits raw authority, permit and path material', () => {
  const record = {
    intent: {
      id,
      target: { generationId: id, databasePath: '/private-secret' },
      confirmedAt: 1,
      authority: { expiresAt: 2, sessionHash: 'secret-session' },
      continuationHash: 'secret-continuation',
    },
    intentHash: 'a'.repeat(64),
    phase: 'accepted',
  } as unknown as RestoreJobRecord;
  const main = {
    generationId: next,
    operation: { id, actorId: 'cold-host', tokenHash: 'secret-token', expiresAt: 3 },
    child: { pid: 10, boot: id, start: '42', token: 'secret-process' },
  } as unknown as RecoveryJournalState;
  const value = JSON.stringify(crashSnapshot('cut', record, main));
  assert.doesNotMatch(value, /secret|databasePath|sessionHash|tokenHash|continuationHash/);
  assert.match(value, /private-host/);
});
test('receipt write is bounded and keeps only explicit JSON files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-crash-receipt-'));
  try {
    await writeCrashReceipt(directory, complete()[0]);
    assert.deepEqual(await readdir(directory), ['admission.json']);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'admission.json'), 'utf8')),
      complete()[0],
    );
    const r = complete()[0];
    r.controllers = Array(10000).fill(r.controllers[0]);
    await assert.rejects(writeCrashReceipt(directory, r), /bound/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('original failure survives recorder and cleanup failure; private data is not removed', async () => {
  const r = complete()[0];
  r.cleanup = { closure: 'not-reached', temporaryData: 'retained' };
  const originalError = new Error('original-secret'),
    cleanup = new Error('cleanup-secret'),
    capture = new Error('capture-secret');
  let removed = false;
  await assert.rejects(
    finishCrashReceipt(
      r,
      async () => {
        throw cleanup;
      },
      async () => {
        removed = true;
      },
      async () => {
        throw capture;
      },
      { error: originalError },
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, originalError);
      assert.deepEqual(error.errors, [originalError, cleanup, capture]);
      return true;
    },
  );
  assert.equal(removed, false);
  assert.equal(r.result, 'failed');
  assert.doesNotMatch(JSON.stringify(r), /secret/);
});
test('successful receipt precedes private deletion and final cleanup state; deletion failure stays failed', async () => {
  const r = complete()[0];
  r.cleanup = { closure: 'not-reached', temporaryData: 'retained' };
  const events: string[] = [];
  await finishCrashReceipt(
    r,
    async () => {
      events.push('closed');
    },
    async () => {
      events.push('removed');
    },
    async () => {
      events.push(r.cleanup.temporaryData);
    },
  );
  assert.deepEqual(events, ['closed', 'retained', 'removed', 'removed']);
  const failed = complete()[0];
  failed.cleanup = { closure: 'not-reached', temporaryData: 'retained' };
  const saved: RestoreCrashReceipt[] = [];
  await assert.rejects(
    finishCrashReceipt(
      failed,
      async () => {},
      async () => {
        throw new Error('remove failed');
      },
      async () => {
        saved.push(structuredClone(failed));
      },
    ),
  );
  assert.equal(saved.at(-1)!.result, 'failed');
  assert.equal(saved.at(-1)!.cleanup.temporaryData, 'retained');
});

test('postcommit retains actual writer SIGKILL while an already-exited controller is an explicit no-op', () => {
  const r = complete(),
    post = r.find((x) => x.case === 'postcommit')!;
  post.controllers[0].exitCode = 0;
  post.controllers[0].signal = null;
  post.terminations[0] = { pid: 10, action: 'already-exited', signal: null, released: true };
  assert.equal(verifyCrashReceipts(r, source).passed, true);
  post.terminations[1].action = 'already-exited';
  post.terminations[1].signal = null;
  assert.throws(() => verifyCrashReceipts(r, source));
});

test('each initial and cold crash controller needs its own actual SIGKILL witness', () => {
  for (const name of restoreCrashCases.filter((c) => c.startsWith('cold-'))) {
    for (const role of ['initial', 'cold'] as const) {
      const receipts = complete();
      const receipt = receipts.find((r) => r.case === name)!;
      const controller = receipt.controllers.find((c) => c[role])!;
      controller.exitCode = 0;
      controller.signal = null;
      const termination = receipt.terminations.find((k) => k.pid === controller.pid)!;
      termination.action = 'already-exited';
      termination.signal = null;
      assert.throws(() => verifyCrashReceipts(receipts, source), /Only the postcommit/);
    }
  }
});

test('available initial and cold observations survive an assertion failure without raw marker material', async () => {
  for (const stage of ['cut', 'cold-cut', 'recovered'] as const) {
    const receipt = complete().find((r) => r.case === 'cold-prepared')!;
    receipt.snapshots = [];
    receipt.cuts = [];
    receipt.cleanup = { closure: 'not-reached', temporaryData: 'retained' };
    const record = {
      intent: {
        id,
        target: { generationId: id },
        confirmedAt: 1,
        authority: { expiresAt: 2, secret: 'private' },
      },
      intentHash: 'd'.repeat(64),
      phase: 'original-replacing',
      execution: { stop: { fingerprint: original }, frozen: { fingerprint: original } },
      recovery: {
        attempts: [
          {
            phase: 'original-prepared',
            grantedAt: 3,
            deadline: 90003,
            priorGenerationId: id,
            attempt: { generationId: next },
            bootEpoch: id,
            image: { fingerprint: prepared },
          },
        ],
      },
    } as unknown as RestoreJobRecord;
    const main = {
      generationId: next,
      operation: { id, actorId: 'cold-host', expiresAt: 90003, secret: 'private' },
    } as unknown as RecoveryJournalState;
    const originalError = new assert.AssertionError({
      message: 'injected private assertion detail',
    });
    let observed: unknown;
    try {
      if (stage === 'recovered') {
        receipt.snapshots.push(crashSnapshot(stage, record, main));
        throw originalError;
      }
      captureCrashCut(
        receipt,
        stage,
        { cut: 'cold-prepared', pid: 42, bytesWritten: 17 },
        record,
        main,
        () => {
          throw originalError;
        },
      );
    } catch (error) {
      observed = error;
    }
    assert.equal(observed, originalError);
    let closed = false,
      removed = false;
    const directory = await mkdtemp(join(tmpdir(), 'spinel-failed-cut-'));
    try {
      await finishCrashReceipt(
        receipt,
        async () => {
          closed = true;
        },
        async () => {
          removed = true;
        },
        () => writeCrashReceipt(directory, receipt),
        { error: observed },
      );
      const saved = JSON.parse(await readFile(join(directory, 'cold-prepared.json'), 'utf8'));
      assert.equal(closed, true);
      assert.equal(removed, false);
      assert.equal(saved.result, 'failed');
      assert.equal(saved.primaryFailure.name, 'AssertionError');
      assert.deepEqual(
        saved.cuts,
        stage === 'recovered' ? [] : [{ name: 'cold-prepared', pid: 42, bytesWritten: 17 }],
      );
      assert.equal(saved.snapshots[0].fingerprints.live, null);
      assert.equal(saved.snapshots[0].fingerprints.liveBoundary, 'not-opened-at-this-boundary');
      assert.equal(saved.snapshots[0].stage, stage);
      assert.deepEqual(saved.snapshots[0].generation, {
        original: id,
        current: next,
        selected: next,
      });
      assert.equal(saved.snapshots[0].fingerprints.frozen, original);
      assert.equal(saved.snapshots[0].fingerprints.preparedOriginal, prepared);
      assert.equal(saved.snapshots[0].authority.cold[0].grantedAt, 3);
      assert.doesNotMatch(JSON.stringify(saved), /"secret"|"private"|injected private assertion detail/);
      assert.equal(saved.cleanup.temporaryData, 'retained');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    captureCrashCut(
      receipt,
      'cut',
      { cut: 'private-arbitrary-text', pid: 'secret', bytesWritten: -1 },
      record,
      main,
      () => {},
    );
    assert.deepEqual(receipt.cuts.at(-1), {
      name: 'unrecognized-cut',
      pid: null,
      bytesWritten: null,
    });
  }
});
