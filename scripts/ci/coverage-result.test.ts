import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { coveragePlan, suiteIds } from './plan.ts';

const head = 'b'.repeat(40);
function run(
  overrides: Record<string, string> = {},
  group = 'browser',
  paths = ['src/server/auth/session.ts'],
) {
  const plan = coveragePlan(
    'pull_request',
    {
      action: 'synchronize',
      pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: head }, labels: [] },
    },
    paths,
    head,
  );
  const raw = JSON.stringify(plan);
  const cwd = mkdtempSync(join(tmpdir(), 'spinel-ci-result-'));
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./coverage-result.ts', import.meta.url)), group],
      {
        cwd,
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          CLASSIFICATION: 'success',
          COVERAGE_PLAN: raw,
          COVERAGE_PLAN_SHA256: createHash('sha256').update(raw).digest('hex'),
          GITHUB_SHA: head,
          COVERAGE_RESULTS: JSON.stringify(
            Object.fromEntries(
              suiteIds.map((id) => [id, plan.suites[id].selected ? 'success' : 'skipped']),
            ),
          ),
          COVERAGE_GATE_RESULTS: JSON.stringify({
            typecheck: 'success',
            'unit-tests': 'success',
            'lib-tests': 'success',
          }),
          GITHUB_STEP_SUMMARY: join(cwd, 'summary.md'),
          ...overrides,
        },
      },
    );
    assert.equal(result.error, undefined);
    return {
      code: result.status,
      report: JSON.parse(readFileSync(join(cwd, `ci-results-${group}.json`), 'utf8')),
      summary: readFileSync(join(cwd, 'summary.md'), 'utf8'),
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
test('CLI binds same-run immutable plan digest/source and publishes all selected results', () => {
  const result = run();
  assert.equal(result.code, 0);
  assert.equal(result.report.passed, true);
  assert.equal(result.report.evidence.plan.tested, head);
  assert.equal(result.report.evidence.results.length, 10);
  assert.match(result.summary, /doc-responsiveness/);
});
test('CLI failure records survive wrong identity, cancelled gate and missing selected evidence', () => {
  const failures: Record<string, string>[] = [
    { COVERAGE_PLAN_SHA256: '0'.repeat(64) },
    { GITHUB_SHA: 'c'.repeat(40) },
    { CLASSIFICATION: 'cancelled' },
    { COVERAGE_RESULTS: '{}' },
    {
      COVERAGE_GATE_RESULTS:
        '{"typecheck":"success","unit-tests":"cancelled","lib-tests":"success"}',
    },
  ];
  for (const overrides of failures) {
    const result = run(overrides);
    assert.equal(result.code, 1);
    assert.equal(result.report.passed, false);
    assert.ok(result.report.evidence.error);
    assert.match(result.summary, /"passed": false/);
  }
});

test('unit aggregate requires every selected partition to succeed, retaining failed evidence', () => {
  const passed = run({ COVERAGE_RESULTS: '{"unit-tests":"success"}' }, 'unit');
  assert.equal(passed.code, 0);
  assert.equal(passed.report.evidence.results.length, 1);
  assert.equal(passed.report.evidence.results[0].suite, 'unit-tests');
  // Actions combines the matrix result; one failed/cancelled partition cannot
  // become a green required check just because the other partitions passed.
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    const failed = run({ COVERAGE_RESULTS: JSON.stringify({ 'unit-tests': result }) }, 'unit');
    assert.equal(failed.code, 1, result);
    assert.equal(failed.report.passed, false, result);
    assert.match(failed.report.evidence.error, /Incomplete coverage unit-tests/);
  }
  assert.equal(run({ COVERAGE_RESULTS: '{}' }, 'unit').code, 1);
});

test('unit partitions may skip only with proven documentation inapplicability', () => {
  const overrides = { COVERAGE_RESULTS: '{"unit-tests":"skipped"}' };
  const docs = run(overrides, 'unit', ['docs/testing.md']);
  assert.equal(docs.code, 0);
  assert.equal(docs.report.evidence.results[0].selected, false);
  assert.match(docs.report.evidence.results[0].reason, /inapplicability/);
  assert.equal(run(overrides, 'unit', ['src/server/maintenance/supervisor.ts']).code, 1);
  assert.equal(
    run({ ...overrides, CLASSIFICATION: 'cancelled' }, 'unit', ['docs/testing.md']).code,
    1,
  );
});
