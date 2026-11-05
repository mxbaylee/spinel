import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = '/tmp/spn098-current-hosted';
const hash = (path: string) => { const fd = openSync(path, 'r'), h = createHash('sha256'), b = Buffer.alloc(1024 * 1024); try { for (;;) { const n = readSync(fd, b); if (!n) break; h.update(b.subarray(0, n)); } } finally { closeSync(fd); } return h.digest('hex'); };
const metadata = JSON.parse(readFileSync(base + '/ci-artifacts.json', 'utf8'));
const summary: unknown[] = [];
for (const environment of ['development', 'production']) {
  const cases: unknown[] = [];
  for (const shard of [1, 2]) {
    const zip = base + '/' + environment + '-' + shard + '.zip';
    const artifact = metadata.artifacts.find((a: any) => a.name === 'theme-screenshots-' + environment + '-' + shard);
    assert.equal(statSync(zip).size, artifact.size_in_bytes); assert.equal('sha256:' + hash(zip), artifact.digest);
    const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(names.every(n => !n.startsWith('/') && !n.split('/').includes('..')));
    const reportName = 'playwright-report/' + environment + '-' + shard + '-of-2.json';
    assert.ok(names.includes(reportName));
    const raw = execFileSync('unzip', ['-p', zip, reportName], { maxBuffer: 20 * 1024 ** 2 });
    writeFileSync(base + '/' + environment + '-' + shard + '-report.json', raw);
    const report = JSON.parse(raw.toString());
    function visit(s: any) {
      if (s.file === 'diagnostics.spec.ts') for (const spec of s.specs ?? []) for (const test of spec.tests) {
        assert.equal(spec.ok, true); assert.equal(test.status, 'expected'); assert.equal(test.results.length, 1);
        assert.equal(test.results[0].retry, 0); assert.equal(test.results[0].status, 'passed');
        cases.push({ title: spec.title, project: test.projectName, shard, durationMs: test.results[0].duration, status: test.results[0].status, retry: test.results[0].retry });
      }
      for (const child of s.suites ?? []) visit(child);
    }
    visit(report);
    const pair = names.find(n => n.endsWith('/spn098-feedback-pair.json'));
    if (pair) {
      const b = execFileSync('unzip', ['-p', zip, pair]); writeFileSync(base + '/' + environment + '-feedback-pair.json', b);
    }
  }
  assert.equal(cases.length, 4);
  summary.push({ environment, cases, pair: JSON.parse(readFileSync(base + '/' + environment + '-feedback-pair.json', 'utf8')) });
}
writeFileSync(base + '/browser-acceptance.json', JSON.stringify({ source: '94c6968e29b57351c548dd5065cb0a61adfad896', tested: 'bc2e8c812c5c67252ddf6889b34d8b0838af1073', run: 42023278283, attempt: 1, summary }, null, 2) + '\n');
console.log(JSON.stringify(summary));
