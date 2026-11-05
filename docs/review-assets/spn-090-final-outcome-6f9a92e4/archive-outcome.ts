import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const base = '/tmp/spn090-current-hosted';
const root = '/tmp/spn090-final-outcome';
const prefix = 'docs/review-assets/spn-090-final-outcome-6f9a92e4';
const source = '6f9a92e41996f8fca7b8e90ede61bbbb3242ce4b';
const investigation = '5bb97d17484ca7df151114ad2f6e28a03b4630c2';
const read = (name: string) => JSON.parse(readFileSync(base + '/' + name, 'utf8'));
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
for (const owner of ['ci', 'story', 'native']) {
  assert.equal(read(owner + '-run.json').head_sha, source);
  assert.equal(read(owner + '-run.json').conclusion, 'success');
  assert.equal(read(owner + '-run.json').run_attempt, 1);
  assert.ok(read(owner + '-jobs.json').jobs.every((j: any) => j.status === 'completed'));
}
assert.equal(read('safari-run.json').conclusion, 'failure');
assert.equal(read('network-diagnostics.json').execution.sourceSha, investigation);
assert.equal(read('network-diagnostics.json').providerSessionsAllocated, 0);
assert.equal(read('network-diagnostics.json').retrievals.length, 1);
assert.equal(read('network-diagnostics.json').capabilityAcceptance, 'not-assessed');
assert.ok(readFileSync(base + '/network-outcome-review-b.md', 'utf8').includes(investigation));
const artifacts = ['ci-artifacts.json', 'native-artifacts.json', 'story-artifacts-final.json', 'safari-artifacts.json'].flatMap(n => read(n).artifacts);
const files = readdirSync(base).filter(n => statSync(base + '/' + n).isFile() && /\.(json|md|ts|log|zip)$/.test(n) && !/^story-mobile|^story-artifacts-interim/.test(n));
for (const path of files.filter(n => n.endsWith('.zip'))) {
  const bytes = readFileSync(base + '/' + path), artifact = artifacts.find((a: any) => path.includes(String(a.id)));
  if (artifact) { assert.equal(bytes.length, artifact.size_in_bytes); assert.equal('sha256:' + hash(bytes), artifact.digest); }
  else if (path === 'safari-diagnostics-13410843308.zip') assert.equal(hash(bytes), '275beb12f2ac3099da423cabf18f2f7b476ac535a0a43e464589b2577daa2fbf');
  else if (path === 'network-diagnostics-13412918937.zip') assert.equal(hash(bytes), 'af90e57b622a7a65510f96ccefba66052b86cea3e0ffdfdb35da6b0fc676e7bc');
  else throw new Error('Unbound artifact ' + path);
}
mkdirSync(root, { recursive: true });
for (const name of readdirSync(base + '/visual/pending-result')) files.push('visual/pending-result/' + name);
for (const path of files) { const dest = root + '/' + path; mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true }); copyFileSync(base + '/' + path, dest); }
writeFileSync(root + '/README.md', `# 🧪 SPN-090 application acceptance and phone blocker\n\nPR224 source ${source}; integrated main2f442317dd2e1c188ae4a810ac094fd1162a4a2a. Tested merge cec5d9174335371d0dfe3166b85e8c8545d7c0d4 has the same tree6f2fecf20471b5dc76ca8417433c10e4e7d995aa. CI42019954732 (33 successful jobs, all seven gates), Story42020272024 (8 successes,2 inapplicable skips), Native42019954711 all passed attempt1. Native Chrome/Firefox/Safari completed37/37/39 stages. Mobile plain1/2/3 p95=19.6/18.7/16.8ms, max=28.1/28.4/24.1ms, idle=2.0/2.7/0.4ms; plain1 all66 history groups. Desktop maxima13.3/20/34.3ms. Full selected original artifacts retained; other callback traces are supplementary expiring Actions artifacts, not fully archived here.\n\nIndependent visual reviewer A approved the actual changed pending-storage result on this source in light/dark1280×900 and phone390×900: agent review only. The captures use the verified hosted build and synthetic production-component Storybook data; Escape closes guidance and focus returns before capture. Complete build ZIP, capture script/receipt/watchdog and three PNGs retained. Not physical-phone evidence.\n\nPhysical Safari42020011460 attempt1 failed. Session a4da71c1d9135174dc4dc74b9d2f0eff0d10c7f3 acknowledged eager navigation; initial URL finished14416ms within15000. Anonymous readiness failed with a blank sign-in, despite secureContext true and activated controlling service worker. Combined failure code does not prove worker absence. No authored acceptance/native actions reached. Networking restored, session deleted, fixture closed. This consumed the single paid allowance; no rerun/Chrome/Firefox allocation follows.\n\nDriver-log read42020461513 was available/unclassified, no allocation. Separate reviewed investigation source ${investigation}, A99/B97, adds bounded network metadata parsing only; not the PR head or application acceptance source. Run42025414770 attempt1 made one completed-session GET, zero allocation,37 complete HAR entries with no malformed/omitted entries. Fixture HTTP responses are200/302/304. CopyFile/theme script requests lasted12078/17257ms, mapped by offline path hashes against the same job's Vite build log. Startup dependency delay is plausible but not established; absolute timing, boot-state and import settlement are absent. In particular, the10-second source bound is styles loading after the awaited import, not an import timeout. No raw provider URLs/headers/bodies retained or published. Full sanitized original ZIP retained. See independent network-outcome review for limits and next investigation.\n\nThe PR remains draft. Earlier Chrome relaunch loses the storage boundary; Firefox offline control remains the maintained provider limitation. All phone obligations persist. Superseded Story42019954664 and deliberately cancelled metadata CI42020272330 are not acceptance. No third-party branch was taken over before its verified two-hour age.\n`);
files.push('README.md');
const payloads = files.map(path => { const b = readFileSync(root + '/' + path); assert.ok(b.length < 100 * 1024 ** 2); return { path, bytes: b.length, sha256: hash(b) }; });
writeFileSync(root + '/manifest.json', JSON.stringify({ source, investigation, prefix, payloads }, null, 2) + '\n');
const env = { ...process.env, GIT_INDEX_FILE: '/tmp/spn090-final-outcome.index' };
const git = (...args: string[]) => execFileSync('git', args, { env, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), investigation);
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
git('read-tree', '--empty');
for (const path of [...files, 'manifest.json']) git('update-index', '--add', '--cacheinfo', '100644', git('hash-object', '-w', root + '/' + path), prefix + '/' + path);
const commit = git('commit-tree', git('write-tree'), '-m', 'Preserve SPN-090 application acceptance and unresolved phone evidence');
writeFileSync('/tmp/spn090-final-outcome-commit.txt', commit + '\n');
console.log(JSON.stringify({ commit, payloads: payloads.length, bytes: payloads.reduce((n, p) => n + p.bytes, 0) }));
