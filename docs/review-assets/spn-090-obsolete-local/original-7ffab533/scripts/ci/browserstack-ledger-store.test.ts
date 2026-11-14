import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  attestOwnerBaseline,
  emptyLedger,
  ingestQuota,
  ledgerBytes,
  ownerBaselineReportId,
  readLedger,
} from './browserstack-ledger.ts';
import { ledgerLocation, ledgerStore } from './browserstack-ledger-store.ts';

const evidence = readFileSync(
  new URL('../../docs/implementation/SPN-090-browserstack-history.json', import.meta.url),
);
const seed = () =>
  attestOwnerBaseline(ingestQuota(emptyLedger([]), evidence), ownerBaselineReportId);
const sha = (bytes: Buffer) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const inputIdentity = {
  run: 'https://github.com/mxbaylee/spinel/actions/runs/41000000000',
  attempt: 1,
  sourceSha: 'a'.repeat(40),
  testedSha: 'b'.repeat(40),
  reservedSeconds: 180,
  createdAt: '2026-10-30T04:00:00.000Z',
};
const freshQuota = () => ({
  ...JSON.parse(evidence.toString()),
  date: inputIdentity.createdAt,
  run: inputIdentity.run,
  sourceSha: inputIdentity.sourceSha,
  testedSha: inputIdentity.testedSha,
});
const input = { ...inputIdentity, quotaEvidence: Buffer.from(JSON.stringify(freshQuota())) };
function fixture() {
  let bytes: Buffer = ledgerBytes(seed());
  let mode = 'normal';
  let clock = Date.parse(inputIdentity.createdAt);
  const calls: { method: string; url: string; body: Record<string, unknown> | undefined }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const body =
      typeof options?.body === 'string'
        ? (JSON.parse(options.body) as Record<string, unknown>)
        : undefined;
    calls.push({ method: options?.method ?? 'GET', url: String(url), body });
    if (mode === 'missing')
      return Response.json({ message: 'private diagnostic' }, { status: 404 });
    if (mode === 'clock') clock += 8001;
    if (options?.method === 'PUT') {
      assert.equal(body?.branch, ledgerLocation.branch);
      if (body?.sha !== sha(bytes) || mode === 'conflict')
        return Response.json({ message: 'private conflict' }, { status: 409 });
      bytes = Buffer.from(body.content as string, 'base64');
      if (mode === 'lost-ack') throw new Error('private transport token');
      return Response.json({ content: { sha: sha(bytes) } });
    }
    return Response.json({
      type: 'file',
      path: ledgerLocation.path,
      encoding: 'base64',
      content: bytes.toString('base64'),
      sha: mode === 'wrong-sha' ? '0'.repeat(40) : sha(bytes),
      size: bytes.length,
      download_url: 'private-ignored',
    });
  };
  const controller = new AbortController();
  const store = ledgerStore({
    token: 'private-token',
    signal: controller.signal,
    now: () => clock,
    fetcher,
  });
  return {
    store,
    calls,
    controller,
    mode(value: string) {
      mode = value;
    },
    read: () => readLedger(bytes),
    replace(value: Buffer) {
      bytes = value;
    },
  };
}

test('reservation uses fixed branch/path CAS, authenticates readback and persists exact source identity', async () => {
  const f = fixture();
  const identity = await f.store.reserve(input);
  assert.deepEqual(
    f.calls.map(({ method }) => method),
    ['GET', 'PUT', 'GET'],
  );
  assert(
    f.calls.every(({ url }) =>
      url.startsWith(
        `https://api.github.com/repos/${ledgerLocation.repository}/contents/${ledgerLocation.path}`,
      ),
    ),
  );
  assert(
    f.calls
      .filter(({ method }) => method === 'GET')
      .every(({ url }) => new URL(url).searchParams.get('ref') === ledgerLocation.branch),
  );
  assert.deepEqual(f.read().reservations, [
    {
      ...inputIdentity,
      ...identity,
      state: 'reserved',
      sessionIds: [],
      quotaReportId: createHash('sha256').update(input.quotaEvidence).digest('hex'),
      assumedPriorChargedSeconds: 900,
      admissionPolicy: 'owner-attested-one-probe-minute-ceiling-v1',
    },
  ]);
  await assert.rejects(f.store.reserve(input), /ledger-reservation-refused/);
  assert.equal(f.calls.filter(({ method }) => method === 'PUT').length, 1);
});

test('probe admission refuses known exhaustion, insufficient estimates and unknown usage without a PUT', async () => {
  for (const condition of [
    'exhausted',
    'insufficient',
    'unknown',
    'partial',
    'busy',
    'stale',
    'wrong-source',
  ]) {
    const f = fixture();
    const quota = freshQuota();
    if (condition === 'exhausted' || condition === 'insufficient') {
      const added = structuredClone(quota.history.sessions[0]);
      added.sessionId = 'f'.repeat(40);
      added.observations[0].evidence.data.durationSeconds = condition === 'exhausted' ? 3600 : 2580;
      quota.history.sessions.push(added);
    }
    if (condition === 'unknown')
      quota.history.sessions[0].observations[0].evidence.data.durationSeconds = null;
    if (condition === 'partial') quota.history.deadlineExceeded = true;
    if (condition === 'busy') quota.plan.data.runningSessions = 1;
    if (condition === 'stale') quota.date = '2026-10-30T03:54:59.000Z';
    if (condition === 'wrong-source') quota.sourceSha = 'c'.repeat(40);
    await assert.rejects(
      f.store.reserve({ ...input, quotaEvidence: Buffer.from(JSON.stringify(quota)) }),
      /ledger-probe-admission-refused/,
      condition,
    );
    assert.equal(f.calls.filter(({ method }) => method === 'PUT').length, 0, condition);
    assert.equal(f.read().reservations.length, 0);
  }
});

test('lost publication acknowledgment recovers only the same proposal, without another PUT', async () => {
  const f = fixture();
  f.mode('lost-ack');
  const identity = await f.store.reserve(input);
  assert.equal(f.read().reservations[0].reservationId, identity.reservationId);
  assert.equal(f.calls.filter(({ method }) => method === 'PUT').length, 1);
  assert.equal(f.calls.length, 3);
});

test('a CAS conflict never becomes allocation authority, including concurrent callers', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.store.reserve(input), f.store.reserve(input)]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected?.status, 'rejected');
  if (rejected?.status === 'rejected') assert.match(String(rejected.reason), /ledger-conflict/);
  assert.equal(f.read().reservations.length, 1);
});

test('provider identity is retained without renewing the reservation or freeing ambiguous usage', async () => {
  const f = fixture();
  const identity = await f.store.reserve(input);
  await f.store.retainUncertainty(identity, 'c'.repeat(40));
  const retained = ledgerBytes(f.read());
  const puts = f.calls.filter(({ method }) => method === 'PUT').length;
  await f.store.retainUncertainty(identity, 'c'.repeat(40));
  assert.deepEqual(ledgerBytes(f.read()), retained);
  assert.equal(f.calls.filter(({ method }) => method === 'PUT').length, puts);
  assert.equal(f.read().reservations[0].createdAt, input.createdAt);
  assert.equal(f.read().reservations[0].state, 'uncertain');
  await assert.rejects(
    f.store.retainUncertainty(identity, 'd'.repeat(40)),
    /ledger-reservation-conflict/,
  );
  await assert.rejects(f.store.reserve({ ...input, attempt: 2 }), /ledger-reservation-refused/);
});

test('missing, corrupt or unauthenticated state refuses without initialization or raw errors', async () => {
  for (const mode of ['missing', 'wrong-sha', 'corrupt']) {
    const f = fixture();
    f.mode(mode);
    if (mode === 'corrupt') f.replace(Buffer.from('{"private":"token"}'));
    await assert.rejects(f.store.reserve(input), (error: unknown) => {
      assert.match(String(error), /ledger-state-(missing|invalid)/);
      assert(!String(error).includes('private'));
      return true;
    });
    assert.equal(f.calls.filter(({ method }) => method === 'PUT').length, 0);
  }
});

test('per-request elapsed bound and caller cancellation prevent publication', async () => {
  const slow = fixture();
  slow.mode('clock');
  await assert.rejects(slow.store.reserve(input), /control-deadline/);
  assert.equal(slow.calls.length, 1);
  const aborted = fixture();
  aborted.controller.abort();
  await assert.rejects(aborted.store.reserve(input), /control-deadline/);
  assert.equal(aborted.calls.length, 0);
});
