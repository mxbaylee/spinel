import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyCoverage } from './plan.ts';
import type { SuiteId } from './plan.ts';

const groups: Record<string, readonly SuiteId[]> = {
  lib: ['lib-test-run'],
  browser: [
    'backlog',
    'pull-request',
    'lint',
    'typecheck',
    'unit-tests',
    'lib-test-run',
    'playwright-run',
    'container-smoke',
    'sync-transition',
    'doc-responsiveness',
    'doc-callback-lifetimes',
  ],
};
if (import.meta.main) {
  const group = process.argv[2];
  if (!group || !groups[group]) throw new Error('Expected lib or browser aggregate.');
  const raw = process.env.COVERAGE_PLAN ?? '';
  let report: unknown;
  let passed = false;
  try {
    if (createHash('sha256').update(raw).digest('hex') !== process.env.COVERAGE_PLAN_SHA256)
      throw new Error('Coverage plan digest changed or missing.');
    const plan = JSON.parse(raw);
    if (!plan.tested || plan.tested !== process.env.GITHUB_SHA)
      throw new Error('Coverage plan does not identify this tested commit.');
    const results = JSON.parse(process.env.COVERAGE_RESULTS ?? '{}') as Record<string, string>;
    const gates = JSON.parse(process.env.COVERAGE_GATE_RESULTS ?? '{}') as Record<string, string>;
    if (
      group === 'browser' &&
      ['typecheck', 'unit-tests', 'lib-tests'].some((id) => gates[id] !== 'success')
    )
      throw new Error(
        'A required validation job failed or is missing despite its test-step result.',
      );
    const evidence = verifyCoverage(plan, process.env.CLASSIFICATION ?? '', results, groups[group]);
    report = {
      planSha256: process.env.COVERAGE_PLAN_SHA256,
      plan,
      gateResults: gates,
      results: evidence,
    };
    passed = true;
  } catch (error) {
    report = {
      planSha256: process.env.COVERAGE_PLAN_SHA256,
      error: String(error),
      results: process.env.COVERAGE_RESULTS ?? null,
    };
  }
  const json = JSON.stringify({ passed, evidence: report }, null, 2);
  writeFileSync(`ci-results-${group}.json`, json + '\n');
  console.log(json);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## ${group} coverage results\n\n` + '```json\n' + json + '\n```\n',
    );
  if (!passed) process.exitCode = 1;
}
