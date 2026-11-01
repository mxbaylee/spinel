// The fixed SPN-120 historical sample. Run once per selected immutable revision;
// it is separate from ordinary CI and never retries a failed scenario.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const project = process.env.SPINEL_E2E_PROJECT;
const source = process.env.AUDIT_SOURCE;
if (!['production', 'development', 'sync-production'].includes(project ?? ''))
  throw new Error('The fixture audit needs one of its three declared projects.');
if (source !== 'baseline' && source !== 'candidate')
  throw new Error('The fixture audit needs an explicit baseline or candidate source.');
const root = process.cwd();
mkdirSync('fixture-audit', { recursive: true });
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const identity = {
  source,
  project,
  sourceSha: git('rev-parse', 'HEAD'),
  sourceTree: git('rev-parse', 'HEAD^{tree}'),
  driverSha256: sha256(readFileSync(process.argv[1])),
  lockSha256: sha256(readFileSync('package-lock.json')),
  node: process.version,
  repetitions: 2,
  retries: 0,
  setupRecoveryAllowed: false,
  startedAt: new Date().toISOString(),
};
if (process.version !== `v${readFileSync('.nvmrc', 'utf8').trim()}`)
  throw new Error('Fixture audit runtime differs from the selected source pin.');
// The old observation retry must not conceal a first reset in the baseline.
// Retain this exact diagnostic-only delta, distinct from the candidate repair.
let baselineDelta = '';
if (source === 'baseline') {
  const path = 'e2e/sync-client.spec.ts';
  const before = readFileSync(path, 'utf8');
  const matches = before.match(/\{ maxRetries: 1 \}/g) ?? [];
  if (matches.length > 1) throw new Error('Unexpected baseline retry sites; audit manually.');
  if (matches.length === 1) {
    writeFileSync(path, before.replace('{ maxRetries: 1 }', '{ maxRetries: 0 }'));
    baselineDelta = git('diff', '--', path);
    writeFileSync('fixture-audit/baseline-no-retry.patch', baselineDelta + '\n');
  }
}
writeFileSync(
  'fixture-audit/source.json',
  JSON.stringify({ ...identity, baselineDeltaSha256: sha256(baselineDelta) }, null, 2) + '\n',
);
const { chromium } = await import(pathToFileURL(resolve(root, 'node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch();
const browserVersion = browser.version();
await browser.close();
const phone = 'phone Doc (light|dark) native pan, zoom and (editor|guest-viewer) behavior preserve the document';
const selectors =
  project === 'sync-production'
    ? [
        'an unfinished native Sheet draft remains copyable before recovery freezes the queued edits',
        'native Docs preserve concurrent text and undo across reconnect, render profile presence, and capture actual image UI edits',
      ]
    : project === 'development'
      ? [phone]
      : [
          phone,
          'ordinary passkeys work without Web Locks and an old logout response cannot clear the new cookie',
          'profile signs out another browser, then verifies and removes its passkey without losing the current account',
        ];
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/@playwright/test/cli.js'),
    'test',
    `--project=${project}`,
    '--grep',
    selectors.join('|'),
    '--repeat-each=2',
    '--retries=0',
    '--workers=1',
    '--max-failures=0',
    '--trace=retain-on-failure',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', SPINEL_FIXTURE_NO_RECOVERY: '1' },
  },
);
type Suite = { suites?: Suite[]; specs?: { title: string; file: string; tests: Test[] }[] };
type Test = {
  projectName: string;
  expectedStatus: string;
  status: string;
  results: { retry: number; status: string; duration: number; error?: { name?: string } }[];
};
const attempts: object[] = [];
let complete = true;
try {
  const report = JSON.parse(readFileSync(`playwright-report/${project}.json`, 'utf8'));
  const walk = (suite: Suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        if (test.results.length !== 1 || test.status !== 'expected') complete = false;
        for (const attempt of test.results) {
          if (attempt.retry !== 0 || attempt.status !== 'passed') complete = false;
          attempts.push({
            file: spec.file,
            title: spec.title,
            project: test.projectName,
            retry: attempt.retry,
            status: attempt.status,
            durationMs: attempt.duration,
          });
        }
      }
    for (const nested of suite.suites ?? []) walk(nested);
  };
  walk(report);
} catch {
  complete = false;
}
const expected = project === 'production' ? 12 : project === 'development' ? 8 : 4;
complete &&= attempts.length === expected && result.status === 0;
writeFileSync(
  'fixture-audit/results.json',
  JSON.stringify(
    {
      ...identity,
      browserVersion,
      baselineDeltaSha256: sha256(baselineDelta),
      finishedAt: new Date().toISOString(),
      expectedAttempts: expected,
      attempts,
      exitCode: result.status,
      signal: result.signal,
      complete,
    },
    null,
    2,
  ) + '\n',
);
if (!complete) process.exitCode = 1;
