// Temporary evidence helper only; not proposed for the application or main CI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = '91c0efbed06ae8805a998467527d4446a19044df';
const tree = 'b80eb8706361027b89b14dcb927ee6f4e22de313';
const candidate = process.cwd();
const proof = resolve(candidate, '../proof');
const { ubuntuMirrorEvidence } = await import(
  pathToFileURL(join(candidate, 'scripts/ci/ubuntu-mirror-evidence.ts')).href
);
const file = '/etc/apt/apt-mirrors.txt';
const backup = join(process.env.RUNNER_TEMP!, 'spn-131-original-mirrors.private');
const output = join(candidate, 'artifacts/ubuntu-mirror-replay');
const fixture =
  'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\n' +
  'https://archive.ubuntu.com/ubuntu/\tpriority:2\n' +
  'https://security.ubuntu.com/ubuntu/\tpriority:3\n';
const expected =
  'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:2\n' +
  'https://archive.ubuntu.com/ubuntu/\tpriority:1\n' +
  'https://security.ubuntu.com/ubuntu/\tpriority:3\n';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const verifySource = () => {
  const actualSource = git(candidate, 'rev-parse', 'HEAD');
  const actualTree = git(candidate, 'rev-parse', 'HEAD^{tree}');
  assert.equal(actualSource, source);
  assert.equal(actualTree, tree);
  git(candidate, 'diff', '--quiet', 'HEAD', '--');
  return { source: actualSource, tree: actualTree, trackedFilesUnchanged: true };
};
const save = (name: string, data: unknown) =>
  writeFileSync(join(output, name + '.json'), JSON.stringify(data, null, 2) + '\n');
const writeMirror = (input: string | Buffer) =>
  execFileSync('sudo', ['-n', 'tee', '--', file], { input, stdio: ['pipe', 'ignore', 'inherit'] });
mkdirSync(output, { recursive: true });

if (process.argv[2] === 'prepare') {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const os = readFileSync('/etc/os-release', 'utf8');
  assert.match(os, /^ID=ubuntu$/m);
  assert.match(os, /^VERSION_ID="24\.04"$/m);
  verifySource();
  assert.equal(git(proof, 'rev-parse', 'HEAD'), process.env.GITHUB_SHA);
  const sources = [
    '/etc/apt/sources.list',
    ...readdirSync('/etc/apt/sources.list.d')
      .filter((name) => /\.(list|sources)$/.test(name))
      .map((name) => join('/etc/apt/sources.list.d', name)),
  ].filter(existsSync);
  const routes = sources.flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    const active = path.endsWith('.sources')
      ? text
          .split(/\n\s*\n/)
          .filter(
            (block) =>
              !/^Enabled:\s*no\s*$/im.test(block) &&
              /^Types:.*\bdeb\b/m.test(block) &&
              /^URIs:.*\bmirror\+file:\/etc\/apt\/apt-mirrors\.txt(?:\s|$)/m.test(block),
          )
      : text
          .split('\n')
          .filter((line) =>
            /^deb\s+(?:\[[^\]]*\]\s+)?mirror\+file:\/etc\/apt\/apt-mirrors\.txt(?:\s|$)/.test(line),
          );
    return active.map(() => ({ path, route: 'mirror+file:/etc/apt/apt-mirrors.txt' }));
  });
  assert.ok(routes.length, 'APT must consume the mirror file being exercised');
  const original = readFileSync(file);
  assert.ok(!existsSync(backup), 'do not overwrite an existing original backup');
  writeFileSync(backup, original, { mode: 0o600, flag: 'wx' });
  save('identity', {
    source,
    tree,
    workflow: process.env.GITHUB_SHA,
    run: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    imageOS: process.env.ImageOS,
    imageVersion: process.env.ImageVersion,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
    platform: process.platform,
    arch: process.arch,
    os,
    routes,
    originalSha256: hash(original),
    injectedFixture: true,
  });
  save('original-host-input', ubuntuMirrorEvidence(original.toString('utf8')));
  assert.equal(Buffer.byteLength(fixture), 152);
  assert.equal(hash(fixture), 'af9816b59bc904eaf28838ae673ac2b625b6628bebfc67a7cbeae78ba06e226a');
  writeMirror(fixture);
  assert.equal(readFileSync(file, 'utf8'), fixture);
  save('injected-input', ubuntuMirrorEvidence(fixture));
} else if (process.argv[2] === 'verify-transform') {
  assert.equal(readFileSync(file, 'utf8'), expected);
  save('transformed-input', ubuntuMirrorEvidence(expected));
} else if (process.argv[2] === 'restore') {
  if (existsSync(backup)) {
    const original = readFileSync(backup);
    writeMirror(original);
    assert.deepEqual(readFileSync(file), original);
    save('restoration', { restored: true, sha256: hash(original) });
    unlinkSync(backup);
  } else {
    save('restoration', { restored: false, reason: 'prepare did not create a backup' });
    throw new Error('No original backup; proof cannot be complete');
  }
} else if (process.argv[2] === 'verify-results') {
  const finalIdentity = verifySource();
  const report = JSON.parse(readFileSync(join(output, 'playwright.json'), 'utf8'));
  const projects = report.config.projects.filter(
    (project: { name: string }) => project.name === 'offline-upgrade',
  );
  assert.equal(projects.length, 1);
  assert.equal(projects[0].retries, 0);
  assert.equal(report.stats.expected, 2);
  assert.equal(report.stats.unexpected, 0);
  assert.equal(report.stats.flaky, 0);
  assert.equal(report.stats.skipped, 0);
  const restored = JSON.parse(readFileSync(join(output, 'restoration.json'), 'utf8'));
  assert.equal(restored.restored, true);
  assert.equal(
    restored.sha256,
    JSON.parse(readFileSync(join(output, 'identity.json'), 'utf8')).originalSha256,
  );
  assert.equal(existsSync(backup), false);
  save('result', {
    success: true,
    ...finalIdentity,
    injectedFixture: true,
    tests: report.stats,
    cleanup:
      'Playwright-reported test cleanup completed; original mirror file restored and verified.',
  });
} else {
  throw new Error('Expected prepare, verify-transform, restore or verify-results');
}
