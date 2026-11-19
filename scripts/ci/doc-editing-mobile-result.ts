import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

const project = 'doc-editing-mobile';

function cases(report: JSONReport) {
  assert.deepEqual(report.errors, [], 'Mobile report contains runner errors.');
  const tests = new Map<string, JSONReportSuite['specs'][number]['tests'][number]>();
  const visit = (suites: JSONReportSuite[]) => {
    for (const suite of suites) {
      for (const spec of suite.specs) {
        assert.ok(
          // Playwright 1.64 JSON removes the tag syntax's leading @.
          spec.tags.includes('doc-editing-mobile'),
          'Mobile report contains an unrequested test.',
        );
        assert.ok(
          spec.id && spec.tests.length === 1,
          'Mobile test identity is missing or ambiguous.',
        );
        const test = spec.tests[0];
        assert.equal(test.projectName, project, 'Mobile test belongs to a different owner.');
        assert.ok(!tests.has(spec.id), 'Mobile report repeats a test identity.');
        tests.set(spec.id, test);
      }
      visit(suite.suites ?? []);
    }
  };
  visit(report.suites);
  assert.ok(tests.size > 0, 'Requested mobile collection is empty.');
  return tests;
}

/** A green Playwright process can contain only skips. Require the complete
 * requested collection and one passing first attempt per test, separately from
 * the required aggregate's worker-result check. */
export function verifyDocEditingMobile(
  collection: JSONReport,
  report: JSONReport,
  requested: string,
  actual: string,
) {
  assert.match(requested, /^[a-f0-9]{40}$/);
  assert.notEqual(requested, '0'.repeat(40));
  assert.equal(actual, requested, 'Mobile execution does not match its requested revision.');
  const expected = cases(collection);
  const observed = cases(report);
  assert.deepEqual(
    [...observed.keys()].sort(),
    [...expected.keys()].sort(),
    'Mobile collection changed during execution.',
  );
  for (const [id, test] of observed) {
    assert.equal(
      expected.get(id)?.expectedStatus,
      'passed',
      `${id}: collection must require a pass.`,
    );
    assert.equal(
      test.expectedStatus,
      'passed',
      `${id}: a skip or expected failure is not acceptance.`,
    );
    assert.equal(test.status, 'expected', `${id}: unexpected, flaky or skipped result.`);
    assert.equal(test.results.length, 1, `${id}: require exactly one first attempt.`);
    assert.equal(test.results[0].retry, 0, `${id}: retries cannot replace first failures.`);
    assert.equal(test.results[0].status, 'passed', `${id}: first attempt did not pass.`);
    assert.deepEqual(test.results[0].errors, [], `${id}: first attempt contains errors.`);
  }
  assert.equal(report.stats.expected, expected.size);
  for (const field of ['unexpected', 'flaky', 'skipped'] as const)
    assert.equal(report.stats[field], 0, `Mobile report ${field} count is not zero.`);
  return { requested, actual, project, testIds: [...expected.keys()].sort(), tests: expected.size };
}

if (import.meta.main) {
  let result: unknown;
  try {
    assert.equal(process.env.SPINEL_DOC_EDITING_MOBILE, '1', 'Explicit runtime flag is required.');
    const [collectionPath, reportPath] = process.argv.slice(2);
    const collection = readFileSync(collectionPath, 'utf8');
    const report = readFileSync(reportPath, 'utf8');
    const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    result = {
      passed: true,
      ...verifyDocEditingMobile(
        JSON.parse(collection),
        JSON.parse(report),
        process.env.REQUESTED_SHA ?? '',
        source,
      ),
      collectionSha256: createHash('sha256').update(collection).digest('hex'),
      reportSha256: createHash('sha256').update(report).digest('hex'),
      evidence:
        'Chromium phone emulation and browser/synthetic input; no physical software keyboard.',
    };
  } catch (error) {
    result = { passed: false, requested: process.env.REQUESTED_SHA ?? null, error: String(error) };
    process.exitCode = 1;
  }
  const json = JSON.stringify(result, null, 2);
  writeFileSync('doc-editing-mobile-result.json', json + '\n');
  console.log(json);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      '## Mobile Doc editing evidence\n\n```json\n' + json + '\n```\n',
    );
}
