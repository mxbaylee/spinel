import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = '/tmp/spn133-review/current-ci-ba89b83';
const expected = 'f3e7e99600d09aea8f66eca775894cf1cfc39b06';
const output: unknown[] = [];
for (const preset of process.argv.slice(2)) {
  const directory = path.join(root, `callbacks-${preset}`);
  const comparison = JSON.parse(fs.readFileSync(path.join(directory, `test-results/spn113-comparison-${preset}.json`), 'utf8'));
  assert.equal(comparison.accepted, true);
  assert.deepEqual(comparison.failures, []);
  assert.equal(comparison.candidate.source, expected);
  assert.equal(comparison.candidate.bounded, true);
  for (const file of fs.readdirSync(directory, { recursive: true }).map(String).filter((file) => file.endsWith('spn113-evidence.json'))) {
    const bytes = fs.readFileSync(path.join(directory, file));
    const data = JSON.parse(bytes.toString());
    const baseline = file.startsWith('baseline-');
    const analysis = data.analysis;
    assert.equal(data.attempt, 0);
    assert.equal(data.complete, true);
    assert.equal(data.behaviorPassed, true);
    assert.deepEqual(data.errors, []);
    assert.equal(data.source, baseline ? comparison.baseline.source : expected);
    if (!baseline) {
      assert.equal(data.passed, true);
      assert.equal(analysis.bounded, true);
      assert.equal(analysis.accepted, true);
      assert.deepEqual(analysis.candidateViolations, []);
    }
    output.push({ preset, baseline, source: data.source, attempt: data.attempt,
      complete: data.complete, passed: data.passed, behaviorPassed: data.behaviorPassed,
      bounded: analysis.bounded, accepted: analysis.accepted,
      candidateViolations: analysis.candidateViolations, collectionError: data.collectionError ?? null,
      errors: data.errors, sha256: createHash('sha256').update(bytes).digest('hex'),
      families: analysis.families,
    });
  }
}
fs.writeFileSync(path.join(root, `callback-${process.argv.slice(2).join('-')}-acceptance-summary.json`), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output.map(({ families, ...rest }: any) => rest), null, 2));
