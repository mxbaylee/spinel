import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
const base = '/tmp/spn098-current-hosted', root = '/tmp/spn098-current-outcome';
const prefix = 'docs/review-assets/spn-098-current-outcome-94c6968e';
const source = '94c6968e29b57351c548dd5065cb0a61adfad896';
const tested = 'bc2e8c812c5c67252ddf6889b34d8b0838af1073';
const read = (name: string) => JSON.parse(readFileSync(base + '/' + name, 'utf8'));
const digest = (path: string) => { const fd = openSync(path, 'r'), hash = createHash('sha256'), b = Buffer.alloc(1024 ** 2); try { for (;;) { const n = readSync(fd, b); if (!n) break; hash.update(b.subarray(0, n)); } } finally { closeSync(fd); } return hash.digest('hex'); };
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), source);
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
for (const owner of ['ci', 'story', 'native']) {
  const run = read(owner + '-run.json');
  assert.equal(run.head_sha, source); assert.equal(run.run_attempt, 1); assert.equal(run.conclusion, owner === 'ci' ? 'failure' : 'success');
  assert.ok(read(owner + '-jobs.json').jobs.every((j: any) => j.status === 'completed'));
}
const jobs = read('ci-jobs.json').jobs;
for (const name of ['Backlog', 'Pull request', 'Lint', 'Typecheck', 'Unit tests', 'Lib tests']) assert.equal(jobs.find((j: any) => j.name === name)?.conclusion, 'success');
assert.equal(jobs.length, 33);
assert.deepEqual(jobs.filter((j: any) => j.conclusion === 'failure').map((j: any) => j.name).sort(), ['Doc responsiveness (mobile)', 'Playwright smoke'].sort());
assert.equal(jobs.filter((j: any) => j.conclusion === 'success').length, 31);
assert.equal(read('story-source.json').checkedOutSha, tested); assert.equal(read('story-source.json').sha, source);
for (const browser of ['chrome', 'firefox', 'safari']) {
  const data = read('native-' + browser + '.json'); assert.equal(data.sourceSha, source); assert.equal(data.testedSha, tested); assert.equal(data.status, 'passed'); assert.equal(data.stages.length, browser === 'safari' ? 39 : 37);
}
assert.equal(read('desktop-comparison.json').passed, true);
assert.equal(read('mobile-failed-metrics.json').sample, 'plain-3');
assert.equal(read('mobile-failed-metrics.json').attempt, 0);
assert.equal(read('mobile-failed-metrics.json').budgetResults.flushMaximum, false);
for (const env of read('browser-acceptance.json').summary) {
  assert.equal(env.cases.length, 4); assert.ok(env.cases.every((c: any) => c.status === 'passed' && c.retry === 0));
  assert.equal(env.pair.initialPreparations, 1); assert.equal(env.pair.pairedMembershipVerified, true);
  assert.equal(env.pair.user.manifest.snapshotId, env.pair.system.manifest.snapshotId);
  assert.deepEqual(env.pair.user.manifest.window, env.pair.system.manifest.window);
  assert.equal(env.pair.user.rows.length, 2); assert.equal(env.pair.system.rows.length, 3);
}
const artifacts = ['ci-artifacts.json', 'native-artifacts.json', 'story-artifacts.json'].flatMap(n => read(n).artifacts);
const zipNames: Record<string, string> = {
  'story-build.zip': 'storybook-review', 'native-chrome.zip': 'desktop-offline-chrome-macos-26-42023278122-1',
  'native-firefox.zip': 'desktop-offline-firefox-macos-26-42023278122-1', 'native-safari.zip': 'desktop-offline-safari-macos-15-intel-42023278122-1',
  'desktop.zip': 'doc-responsiveness-desktop', 'mobile.zip': 'doc-responsiveness-mobile',
  'ci-plan.zip': 'ci-plan', 'ci-results-unit.zip': 'ci-results-unit', 'ci-results-lib.zip': 'ci-results-lib', 'ci-results-browser.zip': 'ci-results-browser',
};
for (const [path, name] of Object.entries(zipNames)) { const a = artifacts.find((a: any) => a.name === name); assert.ok(a, name); assert.equal(statSync(base + '/' + path).size, a.size_in_bytes); assert.equal('sha256:' + digest(base + '/' + path), a.digest); }
const images = read('visual-review-a-images.json'); assert.equal(images.source, source); assert.equal(images.imagesActuallyOpened.length, 24);
for (const i of images.imagesActuallyOpened) { assert.equal(digest(base + '/' + i.path), i.sha256); assert.equal(statSync(base + '/' + i.path).size, i.bytes); }
assert.ok(readFileSync(base + '/acceptance-review-b.md', 'utf8').includes(source));
assert.ok(readFileSync(base + '/acceptance-review-b.md', 'utf8').includes('131.2'));
mkdirSync(root, { recursive: true });
const files = ['ci-run.json', 'ci-jobs.json', 'ci-artifacts.json', 'story-run.json', 'story-jobs.json', 'story-artifacts.json', 'story-source.json', 'native-run.json', 'native-jobs.json', 'native-artifacts.json', 'native-chrome.json', 'native-firefox.json', 'native-safari.json', 'browser-acceptance.json', 'development-feedback-pair.json', 'production-feedback-pair.json', 'desktop-comparison.json', 'mobile-failed-metrics.json', 'inspect-browser.ts', 'inspect-browser-watchdog.json', 'visual-review-a.md', 'visual-review-a-images.json', 'acceptance-review-b.md', 'archive-acceptance.ts', ...Object.keys(zipNames), ...images.imagesActuallyOpened.map((i: any) => i.path), ...['desktop-light', 'desktop-dark', 'mobile-light'].map(v => 'visual/' + v + '/manifest.json')];
for (const path of files) { const dest = root + '/' + path; mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true }); copyFileSync(base + '/' + path, dest); }
copyFileSync(base + '/mobile-failure-review-b.json', root + '/mobile-failure-review-b.json'); files.push('mobile-failure-review-b.json');
const compressed = ['unit-remaining-job.log', 'mobile-job.log', ...['development', 'production'].flatMap(e => [1, 2].map(s => e + '-' + s + '-report.json'))].map(path => {
  const b = readFileSync(base + '/' + path), target = path + '.gz'; writeFileSync(root + '/' + target, gzipSync(b)); files.push(target); return { path, bytes: b.length, sha256: digest(base + '/' + path), archived: target };
});
copyFileSync(base + '/outcome-README.md', root + '/README.md'); files.push('README.md');
const payloads = files.map(path => ({ path, bytes: statSync(root + '/' + path).size, sha256: digest(root + '/' + path) }));
writeFileSync(root + '/manifest.json', JSON.stringify({ source, tested, prefix, compressed, payloads }, null, 2) + '\n');
const env = { ...process.env, GIT_INDEX_FILE: '/tmp/spn098-final-acceptance.index' };
const git = (...args: string[]) => execFileSync('git', args, { env, encoding: 'utf8' }).trim();
git('read-tree', '--empty');
for (const path of [...files, 'manifest.json']) git('update-index', '--add', '--cacheinfo', '100644', git('hash-object', '-w', root + '/' + path), prefix + '/' + path);
const commit = git('commit-tree', git('write-tree'), '-m', 'Preserve SPN-098 current mobile failure and verified feedback outcomes');
writeFileSync('/tmp/spn098-current-outcome-commit.txt', commit + '\n');
console.log(JSON.stringify({ commit, payloads: payloads.length, bytes: payloads.reduce((n, p) => n + p.bytes, 0) }));
