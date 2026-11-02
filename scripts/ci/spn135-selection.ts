import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnosticSamples } from './spn135-unsampled.ts';

export function verifySelection(report: any) {
  assert.deepEqual(report.errors, []);
  const selected: { title: string; project: string }[] = [];
  function walk(suite: any) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        selected.push({ title: spec.title, project: test.projectName });
    for (const child of suite.suites ?? []) walk(child);
  }
  for (const suite of report.suites) walk(suite);
  assert.deepEqual(
    selected,
    diagnosticSamples.map((sample) => ({
      title: `desktop sustained native typing ${sample}`,
      project: 'doc-responsiveness',
    })),
  );
  assert.equal(report.config.workers, 1);
  assert.equal(report.config.maxFailures, 1);
  const project = report.config.projects.find((value: any) => value.name === 'doc-responsiveness');
  assert.equal(project?.retries, 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySelection(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  console.log('Exactly plain-1 then plain-2; one worker, zero retries, stop on first failure.');
}
