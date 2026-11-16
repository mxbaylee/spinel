import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('hosted ordinary and opt-in startup owners receive the exact build evidence flag', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const flag = "VITE_SYNC_EVIDENCE: ${{ startsWith(matrix.project, 'sync-') && '1' || '0' }}";
  for (const step of ['Build', 'Playwright smoke']) {
    const block = workflow.match(
      new RegExp(`      - name: ${step}\\n([\\s\\S]*?)(?=      - name:)`),
    )?.[1];
    assert.ok(
      block?.includes(flag),
      `${step} must bind ordinary mobile absence and sync presence to the same build flag`,
    );
  }
});
import {
  createBootstrapJournal,
  sanitizeBootstrapSnapshot,
} from '../../src/shared/bootstrapEvidence.ts';

test('initial bootstrap evidence distinguishes pending work and failure without mutable or later-operation contamination', () => {
  let clock = 100;
  const journal = createBootstrapJournal(() => clock);
  journal.mark('bootstrap-ready');
  clock += 10;
  journal.mark('application-import-start');
  const pending = journal.read();
  assert.deepEqual(pending.events, [
    { phase: 'bootstrap-ready', at: 0 },
    { phase: 'application-import-start', at: 10 },
  ]);
  assert.equal(pending.sealed, false);
  pending.events.length = 0;
  clock += 5;
  journal.mark('boot-rejected');
  journal.seal();
  journal.mark('application-start-returned');
  assert.equal(journal.read().failed, true);
  assert.equal(journal.read().sealed, true);
  assert.equal(journal.read().events.length, 3);
  assert.equal(journal.read().events.at(-1)?.phase, 'boot-rejected');
});

test('bounded evidence keeps overflow/failure explicit and rejects invalid clocks or private payloads', () => {
  let clock = 10;
  const journal = createBootstrapJournal(() => clock);
  for (let index = 0; index < 40; index++) {
    clock++;
    journal.mark('application-import-start');
  }
  journal.mark('boot-rejected');
  assert.equal(journal.read().events.length, 32);
  assert.equal(journal.read().dropped, 9);
  assert.equal(journal.read().failed, true);
  clock = 0;
  journal.mark('styles-start');
  assert.equal(journal.read().invalidClock, true);
  const observed = {
    ...journal.read(),
    privateURL: 'secret',
    events: [{ phase: 'styles-start', at: 1, account: 'secret' }],
  };
  const sanitized = sanitizeBootstrapSnapshot(observed);
  assert.ok(sanitized);
  assert.doesNotMatch(JSON.stringify(sanitized), /secret|privateURL|account/);
  for (const value of [
    null,
    {},
    { ...observed, events: [{ phase: 'secret', at: 1 }] },
    { ...observed, events: [{ phase: 'styles-start', at: NaN }] },
    {
      ...observed,
      events: [
        { phase: 'styles-start', at: 2 },
        { phase: 'styles-end', at: 1 },
      ],
    },
    { ...observed, events: Array(33).fill({ phase: 'styles-start', at: 0 }) },
  ])
    assert.equal(sanitizeBootstrapSnapshot(value), null);
});
