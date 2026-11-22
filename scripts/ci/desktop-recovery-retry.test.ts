import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  desktopRecoveryRetry,
  desktopRecoveryPublication,
  desktopRecoveryRemaining,
} from './desktop-recovery-retry.ts';
import type { DesktopTransferEvidence } from './desktop-transfer-observation.ts';

// Exact timing/status shape of the retained 52572987 Safari refusal; no content.
function evidence(): DesktopTransferEvidence {
  return {
    total: 15,
    dropped: 0,
    unreadable: 0,
    admittedOrdinals: [],
    requests: [
      {
        ordinal: 14,
        route: 'offline-bundle',
        startedMs: 215721.156511,
        admittedAtStart: [],
        status: 200,
        finishedMs: 215782.386677,
        closedMs: 215783.080609,
        admittedAtClose: false,
      },
      {
        ordinal: 15,
        route: 'offline-recovery',
        startedMs: 215721.571862,
        admittedAtStart: [],
        status: 429,
        finishedMs: 215782.78235,
        closedMs: 215783.119386,
        admittedAtClose: false,
      },
    ],
  };
}

test('only the diagnosed recovery admission refusal becomes ready after the bundle releases', () => {
  const value = evidence();
  assert.deepEqual(desktopRecoveryRetry(value, 13), {
    refusalOrdinal: 15,
    bundleOrdinal: 14,
    ready: true,
  });
  value.admittedOrdinals = [14];
  assert.equal(desktopRecoveryRetry(value, 13)?.ready, false);
  value.admittedOrdinals = [];
  delete value.requests[0].closedMs;
  assert.equal(desktopRecoveryRetry(value, 13)?.ready, false);
});

test('unrelated, incomplete, repeated or successful publication is never retry permission', () => {
  for (const status of [200, 201, 400, 401, 403, 409, 500, 503]) {
    const value = evidence();
    value.requests[1].status = status;
    assert.equal(desktopRecoveryRetry(value, 13), undefined);
  }
  const mutations: ((value: DesktopTransferEvidence) => void)[] = [
    (value) => {
      value.dropped = 1;
    },
    (value) => {
      value.unreadable = 1;
    },
    (value) => {
      value.requests[0].closedMs = value.requests[1].startedMs - 1;
    },
    (value) => {
      value.requests[0].status = 429;
    },
    (value) => {
      value.requests.shift();
    },
    (value) => {
      value.requests.push({ ...value.requests[1], ordinal: 16 });
    },
    (value) => {
      value.requests.push({ ...value.requests[0], ordinal: 16 });
    },
    (value) => {
      delete value.requests[1].finishedMs;
    },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assert.equal(desktopRecoveryRetry(value, 13), undefined);
  }
  assert.equal(desktopRecoveryRetry(evidence(), 15), undefined);
});

test('ready and creating are not failures; only the rendered recovery message distinguishes refusal', () => {
  assert.deepEqual(desktopRecoveryPublication({ href: '', retry: true, message: '' }), {
    href: '',
    failed: false,
    reason: 'other-recovery-error',
  });
  assert.equal(desktopRecoveryPublication({ href: '', retry: false, message: '' }).failed, false);
  assert.deepEqual(desktopRecoveryPublication({ href: '/?item=copy', retry: false, message: '' }), {
    href: '/?item=copy',
    failed: false,
    reason: 'other-recovery-error',
  });
  assert.deepEqual(
    desktopRecoveryPublication({
      href: '',
      retry: true,
      message: 'Another file transfer is running. Try again shortly.',
    }),
    { href: '', failed: true, reason: 'transfer-busy' },
  );
  assert.deepEqual(
    desktopRecoveryPublication({
      href: '',
      retry: true,
      message: 'The copy could not be created.',
    }),
    { href: '', failed: true, reason: 'other-recovery-error' },
  );
});

test('a delayed read cannot renew or cross the one publication deadline', () => {
  const deadline = 45000;
  assert.equal(desktopRecoveryRemaining(deadline, 0), 45000);
  assert.equal(desktopRecoveryRemaining(deadline, 44999), 1);
  // A target/href may arrive, but neither click nor acceptance may follow late.
  assert.throws(() => desktopRecoveryRemaining(deadline, 45000), /original deadline/);
  assert.throws(() => desktopRecoveryRemaining(deadline, 45001), /original deadline/);
});
