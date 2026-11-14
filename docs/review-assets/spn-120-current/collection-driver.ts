import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditCases } from '/Users/mxbaylee/projects/spinel-spn-120-production/scripts/ci/fixture-audit.ts';

const results: object[] = [];
for (const project of ['production', 'development', 'sync-production'] as const) {
  const cases = auditCases(project);
  const selector = cases.map(({ title }) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const args = [
    resolve('node_modules/@playwright/test/cli.js'), 'test', `--project=${project}`,
    '--grep', selector, '--repeat-each=2', '--retries=0', '--workers=1', '--list', '--reporter=json',
  ];
  const execution = spawnSync(process.execPath, args, {
    encoding: 'utf8', env: { ...process.env, SPINEL_E2E_PROJECT: project, SPINEL_FIXTURE_NO_RECOVERY: '1' },
  });
  const prefix = `/tmp/spinel-dependabot-2026-11-11/spn120-exact-collection-${project}`;
  writeFileSync(`${prefix}.stdout`, execution.stdout);
  writeFileSync(`${prefix}.stderr`, execution.stderr);
  assert.equal(execution.status, 0, execution.stderr);
  const report = JSON.parse(execution.stdout.slice(execution.stdout.indexOf('{\n  "config"')));
  const records: { file: string; title: string; project: string; id: string }[] = [];
  const walk = (suite: any) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests)
      records.push({ file: spec.file, title: spec.title, project: test.projectName, id: spec.id });
    for (const child of suite.suites ?? []) walk(child);
  };
  walk(report);
  assert.deepEqual(report.errors, []);
  assert.equal(report.config.workers, 1);
  const config = report.config.projects.find((entry: any) => entry.name === project);
  assert.equal(config.repeatEach, 2);
  assert.equal(config.retries, 0);
  assert.equal(records.length, cases.length * 2);
  for (const item of cases) {
    const found = records.filter((row) => row.file === item.file && row.title === item.title && row.project === project);
    assert.equal(found.length, 2);
    assert.equal(new Set(found.map((row) => row.id)).size, 2);
  }
  results.push({ project, args, records, result: 'collection passed; no browser execution' });
}
writeFileSync('/tmp/spinel-dependabot-2026-11-11/spn120-exact-collection-summary.json', JSON.stringify(results, null, 2) + '\n');
console.log('Collected exactly 24 planned attempts: production 12, development 8, sync-production 4. No browser scenario executed.');
