import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { policyRunNameV2 } from '/Users/mxbaylee/projects/spinel-spn-129/scripts/ci/pr-history.ts';
const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const run = read('provider-run.json');
const merge = read('tested-merge.json');
const source = read('workflow-source.json');
const suite = read('provider-suite.json');
const record = {
  repository: 'mxbaylee/spinel', workflowId: 403983940,
  path: '.github/workflows/pr-policy.yml', runId: 41510513950, sequence: 14,
  createdAt: '2026-11-02T19:30:10Z',
  base: '18a8759c498574a1d9cc24a969a558cd97a798ed',
  head: '4903b96968a988812555010f1bbfb0214709006b',
  tested: '1bcfcf16e1699c8f9e7f23c21959b8013e206761',
};
assert.equal(run.repository.full_name, record.repository);
assert.equal(run.workflow_id, record.workflowId);
assert.equal(run.path, record.path);
assert.equal(run.id, record.runId);
assert.equal(run.run_number, record.sequence);
assert.equal(run.created_at, record.createdAt);
assert.equal(run.head_sha, record.head);
assert.equal(run.event, 'pull_request');
assert.deepEqual(run.pull_requests, [{ number: 231 }]);
assert.equal(run.display_title, `PR policy v2 pr=231 action=synchronize base=${record.base} head=${record.head} tested=${record.tested}`);
assert.equal(merge.sha, record.tested);
assert.deepEqual(merge.parents, [{ sha: record.base }, { sha: record.head }]);
assert.equal(suite.id, run.check_suite_id);
assert.equal(suite.app.id, 15368);
assert.equal(suite.head_sha, record.head);
assert.equal(suite.repository.full_name, record.repository);
assert.equal(source.type, 'file');
assert.equal(source.path, record.path);
assert.equal(source.encoding, 'base64');
const decoded = Buffer.from(source.content, 'base64');
assert.equal(decoded.length, source.size);
assert.deepEqual(decoded.toString('utf8').split('\n').filter((line) => /^\s*run-name:/.test(line)), [policyRunNameV2]);
const result = {
  status: 'provider identity and executed workflow verified; adoption protocol is not implemented or accepted',
  record, workflowSourceSha256: createHash('sha256').update(decoded).digest('hex'),
  scope: 'Chosen legacy-history cutoff only; no production activation, historic event completeness, code pass or merge approval is asserted.',
};
writeFileSync(new URL('verified-cutoff.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
