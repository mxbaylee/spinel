// Deliberately narrow: Markdown under docs may describe executable examples,
// but .ts/.tsx design mockups and unknown JSON still need the full suite.
export function documentationOnly(paths: string[]): boolean {
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        /^(README|AGENTS|THIRD-PARTY-NOTICES)\.md$/.test(path) ||
        /^docs\/.+\.md$/.test(path) ||
        path === 'docs/todo/backlog.json',
    )
  );
}

export const suiteIds = [
  'backlog',
  'pull-request',
  'lint',
  'typecheck',
  'unit-tests',
  'lib-test-run',
  'playwright-run',
  'container-smoke',
  'sync-transition',
  'doc-responsiveness',
  'doc-callback-lifetimes',
  'responsiveness-baseline',
  'callback-baseline',
  'phone-compatibility',
] as const;
export type SuiteId = (typeof suiteIds)[number];
export interface SuitePlan {
  selected: boolean;
  reason: string;
  dependencies: string[];
  inputs: string[];
}
export interface CoveragePlan {
  version: 1;
  event: string;
  action: string | null;
  base: string | null;
  head: string | null;
  tested: string | null;
  mode: 'metadata' | 'targeted' | 'full';
  labels: string[];
  paths: string[] | null;
  suites: Record<SuiteId, SuitePlan>;
}
const sha = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{40}$/.test(v) && !/^0+$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Positive, closed recognition only. Unknown edited fields and base retargets
 * are code events; no absence-of-base heuristic can classify them as metadata. */
export function titleBodyOnly(eventName: string, event: unknown): boolean {
  if (
    eventName !== 'pull_request' ||
    !object(event) ||
    event.action !== 'edited' ||
    !object(event.changes)
  )
    return false;
  const entries = Object.entries(event.changes);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, value]) =>
        ['title', 'body'].includes(key) &&
        object(value) &&
        Object.keys(value).length === 1 &&
        Object.hasOwn(value, 'from') &&
        (typeof value.from === 'string' || (key === 'body' && value.from === null)),
    )
  );
}
const performanceInput = (path: string) =>
  /^(web|server|lib|e2e|\.github|\.storybook)\//.test(path) ||
  /^src\/(shared|server\/(sync|history|collaboration))\//.test(path) ||
  /^scripts\/(ci|dependencies|sync-transition)\//.test(path) ||
  /^(package(-lock)?\.json|.*\.config\.ts|tsconfig\.json|\.nvmrc|Dockerfile|\.dockerignore)$/.test(
    path,
  );
const serviceInput = (path: string) =>
  /^src\/server\/(auth|workspace|backup|maintenance|appearance|diagnostics|formulas|health|mcp|pdf)\//.test(
    path,
  );
const fullInput = (path: string) =>
  /^(\.github|scripts\/(ci|dependencies))\//.test(path) ||
  /^(package(-lock)?\.json|.*\.config\.ts|tsconfig\.json|\.nvmrc|Dockerfile|\.dockerignore)$/.test(
    path,
  );
const libraryInput = (path: string) =>
  /^(lib|scripts\/dependencies)\//.test(path) ||
  /^(package(-lock)?\.json|vitest\.config\.ts|tsconfig\.json|\.nvmrc|\.github\/workflows\/ci\.yml)$/.test(
    path,
  );

/** Complete immutable diff supplied by changedPaths; null means it could not be
 * proved. There is no changed-file API pagination or current-label lookup. */
export function coveragePlan(
  eventName: string,
  raw: unknown,
  paths: string[] | null,
  tested?: string,
): CoveragePlan {
  const event = object(raw) ? raw : {};
  const pr = object(event.pull_request) ? event.pull_request : {};
  const base = eventName === 'pull_request' && object(pr.base) ? pr.base.sha : event.before;
  const head = eventName === 'pull_request' && object(pr.head) ? pr.head.sha : event.after;
  const labelsValid =
    eventName !== 'pull_request' ||
    (Array.isArray(pr.labels) &&
      pr.labels.every((label) => object(label) && typeof label.name === 'string'));
  const labels = Array.isArray(pr.labels)
    ? pr.labels.flatMap((label) =>
        object(label) && typeof label.name === 'string' ? [label.name] : [],
      )
    : [];
  const knownEvent =
    eventName === 'push' ||
    (eventName === 'pull_request' &&
      ['opened', 'reopened', 'synchronize', 'labeled', 'unlabeled', 'edited'].includes(
        String(event.action),
      ));
  const reliable = paths !== null && sha(base) && sha(head) && labelsValid;
  const metadata = reliable && titleBodyOnly(eventName, event);
  const unknown =
    paths?.filter(
      (path) => !documentationOnly([path]) && !performanceInput(path) && !serviceInput(path),
    ) ?? [];
  const fullReason = !knownEvent
    ? 'Scheduled/manual or unsupported event requires full coverage.'
    : !reliable
      ? 'Immutable range or event labels unavailable; full coverage.'
      : event.action === 'edited' && !metadata
        ? 'Base retarget or ambiguous edit requires full coverage.'
        : unknown.length
          ? 'Unknown paths require full coverage.'
          : !paths?.length && !metadata
            ? 'Empty change range requires full coverage.'
            : paths?.some(fullInput)
              ? 'Workflow, harness, build, runtime or dependency input requires full coverage.'
              : labels.includes('ci-full')
                ? 'ci-full adds full coverage.'
                : null;
  const full = !metadata && fullReason !== null;
  const app = !metadata && (full || !documentationOnly(paths ?? []));
  const performance =
    !metadata && (full || labels.includes('ci-performance') || !!paths?.some(performanceInput));
  const candidate = app || performance;
  const lib = !metadata && (full || !!paths?.some(libraryInput));
  const plan: CoveragePlan = {
    version: 1,
    event: eventName,
    action: typeof event.action === 'string' ? event.action : null,
    base: sha(base) ? base : null,
    head: sha(head) ? head : null,
    tested: sha(tested) ? tested : null,
    mode: metadata ? 'metadata' : full ? 'full' : 'targeted',
    labels: [...new Set(labels)].sort(),
    paths: paths === null ? null : [...new Set(paths)].sort(),
    suites: {} as CoveragePlan['suites'],
  };
  for (const id of suiteIds) {
    const selected =
      id === 'pull-request'
        ? eventName === 'pull_request'
        : metadata
          ? false
          : ['backlog', 'lint'].includes(id)
            ? true
            : id === 'lib-test-run'
              ? lib
              : ['responsiveness-baseline', 'callback-baseline'].includes(id)
                ? performance
                : id === 'phone-compatibility'
                  ? full
                  : ['doc-responsiveness', 'doc-callback-lifetimes'].includes(id)
                    ? candidate
                    : app;
    const dependencies =
      id === 'lib-test-run'
        ? [
            'lib/**',
            'scripts/dependencies/**',
            'package{,-lock}.json',
            'vitest.config.ts',
            'tsconfig.json',
            '.nvmrc',
            '.github/workflows/ci.yml',
          ]
        : ['responsiveness-baseline', 'callback-baseline'].includes(id)
          ? [
              'web/**',
              'server/**',
              'lib/**',
              'e2e/**',
              'src/shared/**',
              'src/server/{sync,history,collaboration}/**',
              'scripts/{ci,dependencies,sync-transition}/**',
              'build/runtime/dependency/workflow configuration',
            ]
          : id === 'phone-compatibility'
            ? ['full plan backstop; ordinary phone owners remain in routine browser coverage']
            : ['backlog', 'lint', 'pull-request'].includes(id)
              ? ['complete immutable change range and current event metadata']
              : [
                  'all application, auth, persistence, sync, runtime, build, dependency and harness inputs',
                ];
    plan.suites[id] = {
      selected,
      dependencies,
      inputs: plan.paths ?? [],
      reason: metadata
        ? id === 'pull-request'
          ? 'Title/body validation only; existing code checks untouched.'
          : 'Metadata event emits no code evidence.'
        : id === 'pull-request' && eventName !== 'pull_request'
          ? 'No pull request on this event.'
          : full
            ? fullReason!
            : selected
              ? performance && ['responsiveness-baseline', 'callback-baseline'].includes(id)
                ? 'Performance dependency or additive ci-performance label.'
                : 'Automatic coverage for the complete change range.'
              : id === 'pull-request'
                ? 'No pull request on this event.'
                : id === 'phone-compatibility'
                  ? 'Routine phone contract owners cover every assertion; full duplicate compatibility reserved for backstop.'
                  : `No ${id} dependency changed; explicit inapplicability.`,
    };
  }
  return plan;
}

/** Aggregates never infer success from a skipped job. A complete plan and an
 * exact selected-success/inapplicable-skipped result are both mandatory. */
export function verifyCoverage(
  plan: unknown,
  classification: string,
  results: Record<string, string | undefined>,
  ids: readonly SuiteId[],
) {
  if (
    classification !== 'success' ||
    !object(plan) ||
    plan.version !== 1 ||
    !['full', 'targeted'].includes(String(plan.mode)) ||
    !object(plan.suites) ||
    Object.keys(plan.suites).length !== suiteIds.length
  )
    throw new Error('Coverage plan missing, malformed or not a code run.');
  for (const id of suiteIds) {
    const suite = plan.suites[id];
    if (
      !object(suite) ||
      Object.keys(suite).length !== 4 ||
      typeof suite.selected !== 'boolean' ||
      typeof suite.reason !== 'string' ||
      !suite.reason ||
      !Array.isArray(suite.dependencies) ||
      !suite.dependencies.length ||
      !suite.dependencies.every((v) => typeof v === 'string') ||
      !Array.isArray(suite.inputs) ||
      !suite.inputs.every((v) => typeof v === 'string')
    )
      throw new Error(`Malformed coverage decision: ${id}`);
  }
  return ids.map((id) => {
    const suite = (plan as unknown as CoveragePlan).suites[id];
    const actual = results[id];
    if (actual !== (suite.selected ? 'success' : 'skipped'))
      throw new Error(
        `Incomplete coverage ${id}: selected=${suite.selected}, result=${actual ?? 'missing'}`,
      );
    return { suite: id, ...suite, result: actual };
  });
}
