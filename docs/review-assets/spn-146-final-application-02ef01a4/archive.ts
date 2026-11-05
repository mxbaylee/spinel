import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const base = '/tmp/spn146-qualification-hosted';
const root = '/tmp/spn146-final-application';
const prefix = 'docs/review-assets/spn-146-final-application-02ef01a4';
const source = '02ef01a40fe8369b79477909673c76de6d2a4edf';
const read = (name: string) => JSON.parse(readFileSync(base + '/' + name, 'utf8'));
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
assert.equal(read('ci-run-final.json').head_sha, source);
assert.equal(read('ci-run-final.json').conclusion, 'failure');
assert.equal(read('ci-run-final.json').run_attempt, 1);
assert.ok(read('ci-jobs-final.json').jobs.every((j: any) => j.status === 'completed'));
assert.equal(read('cancelled-outcome-metadata-run.json').conclusion, 'cancelled');
assert.ok(read('cancelled-outcome-metadata-jobs.json').jobs.every((j: any) => j.status === 'completed'));
mkdirSync(root);
const files = ['ci-run-final.json', 'ci-jobs-final.json', 'ci-artifacts-final.json', 'storybook-run.json', 'storybook-jobs.json', 'development-1-job.log', 'cancelled-outcome-metadata-run.json', 'cancelled-outcome-metadata-jobs.json', 'blocked-pr-body.md'];
for (const [name, id] of [['mobile', 13410667968], ['desktop', 13408454305], ['development', 13408922978]] as const) {
  const path = `${name}-${id}.zip`, bytes = readFileSync(base + '/' + path);
  const artifact = read('ci-artifacts-final.json').artifacts.find((a: any) => a.id === id);
  assert.equal(bytes.length, artifact.size_in_bytes);
  assert.equal('sha256:' + hash(bytes), artifact.digest);
  files.push(path);
}
for (const name of files) copyFileSync(base + '/' + name, root + '/' + name);
for (const side of ['a', 'b']) {
  const name = 'retained-checkpoint-' + side + '.md';
  copyFileSync('/tmp/spn146-retained-checkpoint-' + side + '.md', root + '/' + name);
  files.push(name);
}
copyFileSync(import.meta.filename, root + '/archive.ts'); files.push('archive.ts');
writeFileSync(root + '/README.md', `# ⚠️ SPN-146 final application outcome\n\nSource ${source}; base 2f442317dd2e1c188ae4a810ac094fd1162a4a2a. Tested pull-request merge 6fdb243eb5728b91f935a4bea258fa3882458ccb has the same tree as source: 95df0cb77e8d509f3150ea7a1a48342cbb4c37e1.\n\nCI 42013542535 attempt 1 completed: 31 successful jobs, development 1/2 and the Playwright aggregate failed. Development job 127198645126 measured both-peer observations at 1,005 ms on the first attempt and 1,071 ms on built-in retry 1 against the unchanged strict <1,000 ms budget. Built-in retry 2 passed; fail-on-flaky correctly failed the job. No workflow rerun occurred. Its complete original 35,545,524-byte artifact is retained; the trace is retry 1, not the first failure.\n\nMobile job 127198645024 passed. Plain 1/2/3 capacity-flush p95: 19.9/21.1/24.8 ms; maxima 34.3/29.8/29.9 ms; idle maxima 5.1/3.3/2.3 ms. Plain 1 retains all 66 undo/redo groups. Desktop plain maxima 28.0/9.9/7.5 ms. Full original desktop/mobile artifacts retain all baseline/candidate metrics, profiles, boundaries and comparison records. These application checks neither establish a component speedup nor reconstruct historical maximum failures.\n\nStorybook 42013542559 attempt 1 passed (8 successful jobs, 2 inapplicable Pages skips). Component 42013542610 and native 42013542571 failures remain unresolved in archive 6977e3a1b9a488772efd1ad1f019b99316fae248. No third component experiment or native action replay follows. The two independent checkpoint reviews predate final application completion and are retained with their original scope, not promoted to final acceptance.\n\nMetadata-only CI 42019359838 was deliberately cancelled, with every job terminal. It supplies no acceptance. The archived prior PR body is a dated checkpoint with mobile pending; this README supersedes that status only. Other successful-job raw traces/screenshots remain supplementary Actions artifacts, with identities/digests/expiry in ci-artifacts-final.json; this archive does not claim to retain every CI artifact. Current PR remains draft, unmerged.\n`); files.push('README.md');
const payloads = files.map(path => { const b = readFileSync(root + '/' + path); assert.ok(b.length < 100 * 1024 ** 2); return { path, bytes: b.length, sha256: hash(b) }; });
writeFileSync(root + '/manifest.json', JSON.stringify({ source, prefix, payloads }, null, 2) + '\n');
const env = { ...process.env, GIT_INDEX_FILE: '/tmp/spn146-final-application.index' };
const git = (...args: string[]) => execFileSync('git', args, { env, encoding: 'utf8' }).trim();
git('read-tree', '--empty');
for (const path of [...files, 'manifest.json']) git('update-index', '--add', '--cacheinfo', '100644', git('hash-object', '-w', root + '/' + path), prefix + '/' + path);
const commit = git('commit-tree', git('write-tree'), '-m', 'Preserve SPN-146 final application results and unresolved first failures');
writeFileSync('/tmp/spn146-final-application-commit.txt', commit + '\n');
console.log(JSON.stringify({ commit, payloads: payloads.length, bytes: payloads.reduce((n, p) => n + p.bytes, 0) }));
