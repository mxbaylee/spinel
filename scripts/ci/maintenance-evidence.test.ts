import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  maintenanceErrorCode,
  maintenanceJournalEvidence,
  maintenanceLogEvidence,
  maintenanceMemoryEvents,
  maintenanceStatusEvidence,
  readMaintenanceEvidence,
} from '../../e2e/maintenance-evidence.ts';

test('optional process evidence failure is reported once without failing fixture setup', async () => {
  let calls = 0;
  const failure = new Error('EACCES /proc/private-path private-token');
  const evidence = await readMaintenanceEvidence(() => {
    calls++;
    throw failure;
  });
  assert.equal(calls, 1);
  assert.deepEqual(evidence, { ok: false, code: 'EACCES' });
  assert.doesNotMatch(JSON.stringify(evidence), /private/);
  assert.deepEqual(
    await readMaintenanceEvidence(async () => {
      throw failure;
    }),
    evidence,
  );
  assert.deepEqual(await readMaintenanceEvidence(() => null), { ok: true, value: null });
});

test('fixture log evidence retains fixed failure signals without cookies or content', () => {
  const secret = 'private-cookie-and-document-text';
  const text = `Authorization: ${secret}\nError: ECONNRESET ${secret}\nAllocation failed ${secret}\n`;
  const evidence = maintenanceLogEvidence(Buffer.from(text), Buffer.byteLength(text));
  assert.deepEqual(evidence.codes, ['ECONNRESET']);
  assert.deepEqual(evidence.headlines, ['Allocation failed']);
  assert.equal(evidence.rawOutputRetained, false);
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(secret));
  assert.equal(maintenanceErrorCode(new Error(text)), 'ECONNRESET');
  assert.equal(maintenanceErrorCode(new Error(secret)), 'unclassified');
  assert.equal(maintenanceErrorCode(new DOMException(secret, 'TimeoutError')), 'TimeoutError');
});

test('log tails and memory counters have fixed bounds and content-free fields', () => {
  const text = Buffer.from('ECONNRESET\n' + 'x'.repeat(20_000) + '\nEPIPE');
  const evidence = maintenanceLogEvidence(text, text.length);
  assert.deepEqual(evidence.codes, ['EPIPE']);
  assert.equal(evidence.retainedBytes, 16_384);
  assert.equal(evidence.truncated, true);
  assert.deepEqual(maintenanceMemoryEvents('oom 2\noom_kill 1\nsecret token\nmax not-a-count\n'), {
    oom: '2',
    oom_kill: '1',
  });
  assert.deepEqual(maintenanceMemoryEvents('x'.repeat(4096) + '\noom_kill 12'), {});
});

test('journal evidence excludes authority and treats process identity as historical selection', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const evidence = maintenanceJournalEvidence({
    phase: 'stopped',
    epoch: id,
    generationId: id,
    updatedAt: 1234,
    restoreJob: { jobId: id, secret: 'private-content' },
    child: { pid: 13, start: '456', boot: id, token: 'private-content' },
    operation: { sessionHash: 'private-content', tokenHash: 'private-content' },
    lastFailure: 'private-content',
  });
  assert.deepEqual(evidence.child, { pid: 13, start: '456', boot: id });
  assert.equal(evidence.childLiveness, 'not-inferred-from-journal');
  assert.equal(evidence.restorePending, true);
  assert.doesNotMatch(JSON.stringify(evidence), /private-content|token|sessionHash/);
  const malformed = maintenanceJournalEvidence({
    phase: 'private-content',
    child: { pid: 'private-content' },
  });
  assert.equal(malformed.phase, null);
  assert.equal(malformed.child?.pid, null);
});

test('status observation retains only the HTTP status and recognized phase', async () => {
  assert.deepEqual(
    await maintenanceStatusEvidence(
      new Response(
        JSON.stringify({
          phase: 'running',
          secret: 'private-content',
          notice: { content: 'private-content' },
        }),
      ),
    ),
    { status: 200, phase: 'running' },
  );
  await assert.rejects(
    maintenanceStatusEvidence(new Response('x'.repeat(16_385))),
    /evidence bound/,
  );
  await assert.rejects(maintenanceStatusEvidence(new Response('invalid json')));
  assert.deepEqual(await maintenanceStatusEvidence(new Response('{"phase":"private-content"}')), {
    status: 200,
    phase: null,
  });
});
