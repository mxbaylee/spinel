// The fixed SPN-120 historical sample. Run once per selected immutable revision;
// it is separate from ordinary CI and never retries a failed scenario.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type AuditProject = 'production' | 'development' | 'sync-production';
export const auditCases = (project: AuditProject) => {
  const phone = ['light', 'dark'].flatMap((theme) =>
    ['editor', 'guest-viewer'].map((role) => ({
      file: 'doc-phone-navigation.spec.ts',
      title: `phone Doc ${theme} native pan, zoom and ${role} behavior preserve the document`,
    })),
  );
  if (project === 'development') return phone;
  if (project === 'production')
    return [
      ...phone,
      {
        file: 'offline-sign-out.spec.ts',
        title:
          'ordinary passkeys work without Web Locks and an old logout response cannot clear the new cookie',
      },
      {
        file: 'passkey-management.spec.ts',
        title:
          'profile signs out another browser, then verifies and removes its passkey without losing the current account',
      },
    ];
  return [
    {
      file: 'offline-recovery.spec.ts',
      title:
        'an unfinished native Sheet draft remains copyable before recovery freezes the queued edits',
    },
    {
      file: 'sync-client.spec.ts',
      title:
        'native Docs preserve concurrent text and undo across reconnect, render profile presence, and capture actual image UI edits',
    },
  ];
};
type Result = {
  retry: number;
  status: string;
  duration: number;
  startTime: string;
  workerIndex: number;
};
type Test = { projectName: string; expectedStatus: string; status: string; results: Result[] };
type Suite = {
  suites?: Suite[];
  specs?: { id: string; title: string; file: string; tests: Test[] }[];
};
type Report = Suite & {
  config: { workers: number; projects: { name: string; repeatEach: number; retries: number }[] };
  errors?: unknown[];
};
export type AuditIdentity = {
  testId: string;
  file: string;
  title: string;
  project: string;
  repeatEachIndex: number;
  retry: number;
  status: string;
  expectedStatus: string;
  startTime: string;
  workerIndex: number;
  durationMs: number;
};

/** The first baseline predates the identity reporter; its raw report is still
 * checked against the exact manifest/count, configuration and distinct starts.
 * Every new audit additionally requires genuine repeatEachIndex 0 and 1. */
export function validateAuditReport(
  report: Report,
  project: AuditProject,
  identities?: AuditIdentity[],
) {
  const reasons: string[] = [];
  const expected = new Map(auditCases(project).map((item) => [`${item.file}:${item.title}`, 0]));
  const attempts: (Omit<AuditIdentity, 'repeatEachIndex' | 'expectedStatus'> & {
    specId: string;
    sampleOrdinal: number;
    repeatEachIndex: number | null;
  })[] = [];
  const starts = new Set<string>();
  const selected = report.config?.projects?.find((entry) => entry.name === project);
  if (selected?.repeatEach !== 2 || selected?.retries !== 0 || report.config?.workers !== 1)
    reasons.push('The recorded repetition/retry/worker configuration differs from the plan.');
  if (report.errors?.length) reasons.push('The report contains a runner error.');
  const walk = (suite: Suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        const file = basename(spec.file);
        const key = `${file}:${spec.title}`;
        if (!expected.has(key) || test.projectName !== project)
          reasons.push('Unexpected scenario or project.');
        if (
          test.expectedStatus !== 'passed' ||
          test.status !== 'expected' ||
          test.results.length !== 1
        )
          reasons.push('A scenario is skipped, failed, expected-failing or retried.');
        for (const result of test.results) {
          const ordinal = expected.get(key) ?? 0;
          expected.set(key, ordinal + 1);
          const startKey = `${test.projectName}:${key}:${result.startTime}:${result.workerIndex}:${result.retry}`;
          if (starts.has(startKey) || !Number.isFinite(Date.parse(result.startTime)))
            reasons.push('Missing or duplicate attempt start identity.');
          starts.add(startKey);
          if (result.retry !== 0 || result.status !== 'passed')
            reasons.push('A first attempt did not pass.');
          const identity = identities?.filter(
            (item) =>
              item.project === test.projectName &&
              item.file === file &&
              item.title === spec.title &&
              item.startTime === result.startTime &&
              item.workerIndex === result.workerIndex &&
              item.retry === result.retry,
          );
          if (
            identities &&
            (identity?.length !== 1 ||
              ![0, 1].includes(identity[0].repeatEachIndex) ||
              identity[0].status !== result.status ||
              identity[0].expectedStatus !== test.expectedStatus ||
              identity[0].durationMs !== result.duration ||
              !identity[0].testId)
          )
            reasons.push('Per-attempt identity does not match the report.');
          attempts.push({
            specId: spec.id,
            testId: identity?.[0]?.testId ?? spec.id,
            file,
            title: spec.title,
            project: test.projectName,
            sampleOrdinal: ordinal,
            repeatEachIndex: identity?.[0]?.repeatEachIndex ?? null,
            retry: result.retry,
            status: result.status,
            durationMs: result.duration,
            startTime: result.startTime,
            workerIndex: result.workerIndex,
          });
        }
      }
    for (const nested of suite.suites ?? []) walk(nested);
  };
  walk(report);
  if (
    [...expected.values()].some((count) => count !== 2) ||
    expected.size !== auditCases(project).length
  )
    reasons.push('Every named scenario must have exactly two executions.');
  if (identities) {
    if (identities.length !== attempts.length)
      reasons.push('Unexpected or missing identity records.');
    for (const item of auditCases(project)) {
      const observed = attempts.filter(
        (attempt) => attempt.file === item.file && attempt.title === item.title,
      );
      if (
        observed.length !== 2 ||
        observed
          .map((attempt) => attempt.repeatEachIndex)
          .sort()
          .join(',') !== '0,1' ||
        new Set(observed.map((attempt) => attempt.testId)).size !== 2
      )
        reasons.push('The named scenario lacks distinct repetitions zero and one.');
    }
  }
  return { complete: reasons.length === 0, reasons: [...new Set(reasons)], attempts };
}

async function main() {
  const project = process.env.SPINEL_E2E_PROJECT as AuditProject;
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
    driverCommit: process.env.AUDIT_HEAD ?? null,
    eventHead: process.env.AUDIT_HEAD ?? null,
    eventBase: process.env.AUDIT_BASE ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
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
  const { chromium } = await import(
    pathToFileURL(resolve(root, 'node_modules/playwright/index.mjs')).href
  );
  const browser = await chromium.launch();
  const browserVersion = browser.version();
  await browser.close();
  const phone =
    'phone Doc (light|dark) native pan, zoom and (editor|guest-viewer) behavior preserve the document';
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
      `--reporter=line,json,${resolve(dirname(process.argv[1]), 'fixture-audit-reporter.ts')}`,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: 'true',
        SPINEL_FIXTURE_NO_RECOVERY: '1',
        PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(`playwright-report/${project}.json`),
      },
    },
  );
  let validation: ReturnType<typeof validateAuditReport> = {
    complete: false,
    reasons: ['Missing or unreadable report/identity evidence.'],
    attempts: [],
  };
  try {
    const report = JSON.parse(readFileSync(`playwright-report/${project}.json`, 'utf8'));
    const identities = JSON.parse(readFileSync('fixture-audit/attempt-identities.json', 'utf8'));
    validation = validateAuditReport(report, project, identities);
  } catch {
    /* Missing evidence remains explicitly failed. */
  }
  const expected = auditCases(project).length * 2;
  const complete = validation.complete && result.status === 0;
  writeFileSync(
    'fixture-audit/results.json',
    JSON.stringify(
      {
        ...identity,
        browserVersion,
        baselineDeltaSha256: sha256(baselineDelta),
        finishedAt: new Date().toISOString(),
        expectedAttempts: expected,
        attempts: validation.attempts,
        validationFailures: validation.reasons,
        spawnError: result.error
          ? { name: result.error.name, code: (result.error as NodeJS.ErrnoException).code ?? null }
          : null,
        exitCode: result.status,
        signal: result.signal,
        complete,
      },
      null,
      2,
    ) + '\n',
  );
  if (!complete) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
