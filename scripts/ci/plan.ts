import { REVALIDATE_LABEL } from './pr-identity.ts';

/** The expensive fixed-size restore follows its production runtime and browser
 * entry points. Unknown commit ranges run it; both sides of renames come from
 * changedPaths. Ordinary browser checks still cover unrelated UI changes. */
export function needsRestoreTiming(paths: readonly string[]): boolean {
  return (
    paths.length === 0 ||
    paths.some(
      (path) =>
        /^(?:server|src\/server|src\/shared|src\/ui|lib|web)\//.test(path) ||
        /^e2e\/(?:restore-|supervised-restore)/.test(path) ||
        /^e2e\/(?:doc-touch|native-sheet-value)\./.test(path) ||
        /^scripts\/ci\/(?:changes|restore-timing-changes|restore-observer|pid-namespace)/.test(
          path,
        ) ||
        path.startsWith('scripts/dependencies/') ||
        path.startsWith('scripts/deploy/maintenance.') ||
        [
          'package.json',
          'package-lock.json',
          'Dockerfile',
          '.dockerignore',
          '.nvmrc',
          'vite.config.ts',
          'tsconfig.json',
        ].includes(path) ||
        path === '.github/workflows/ci.yml',
    )
  );
}

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
  'lint',
  'typecheck',
  'unit-tests',
  'lib-test-run',
  'playwright-run',
  'container-smoke',
  'restore-timing',
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
  version: 2;
  event: string;
  action: string | null;
  base: string | null;
  head: string | null;
  tested: string | null;
  mode: 'targeted' | 'full';
  labels: string[];
  paths: string[] | null;
  suites: Record<SuiteId, SuitePlan>;
}
const sha = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{40}$/.test(v) && !/^0+$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

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
 * proved. Persistent PR history can require full coverage independently of the
 * current event's labels; it can never reduce path-selected coverage. */
export function coveragePlan(
  eventName: string,
  raw: unknown,
  paths: string[] | null,
  tested?: string,
  forceFullReason?: string,
): CoveragePlan {
  if (
    forceFullReason !== undefined &&
    (typeof forceFullReason !== 'string' || !forceFullReason.trim())
  )
    throw new Error('A forced full-coverage requirement needs an explicit reason.');
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
  const unknown =
    paths?.filter(
      (path) => !documentationOnly([path]) && !performanceInput(path) && !serviceInput(path),
    ) ?? [];
  const fullReason =
    forceFullReason ??
    (!knownEvent
      ? 'Scheduled/manual or unsupported event requires full coverage.'
      : !reliable
        ? 'Immutable range or event labels unavailable; full coverage.'
        : event.action === 'edited'
          ? 'An edited event reaching code validation requires full coverage; cheap policy has a separate workflow.'
          : labels.includes(REVALIDATE_LABEL) ||
              (object(event.label) && event.label.name === REVALIDATE_LABEL)
            ? 'Base/ambiguous edit revalidation requires full coverage, including reserved-label removal.'
            : unknown.length
              ? 'Unknown paths require full coverage.'
              : !paths?.length
                ? 'Empty change range requires full coverage.'
                : paths?.some(fullInput)
                  ? 'Workflow, harness, build, runtime or dependency input requires full coverage.'
                  : labels.includes('ci-full')
                    ? 'ci-full adds full coverage.'
                    : null);
  const full = fullReason !== null;
  const app = full || !documentationOnly(paths ?? []);
  const performance = full || labels.includes('ci-performance') || !!paths?.some(performanceInput);
  const candidate = app || performance;
  const lib = full || !!paths?.some(libraryInput);
  const plan: CoveragePlan = {
    version: 2,
    event: eventName,
    action: typeof event.action === 'string' ? event.action : null,
    base: sha(base) ? base : null,
    head: sha(head) ? head : null,
    tested: sha(tested) ? tested : null,
    mode: full ? 'full' : 'targeted',
    labels: [...new Set(labels)].sort(),
    paths: paths === null ? null : [...new Set(paths)].sort(),
    suites: {} as CoveragePlan['suites'],
  };
  for (const id of suiteIds) {
    const selected = ['backlog', 'lint'].includes(id)
      ? true
      : id === 'restore-timing'
        ? full || needsRestoreTiming(paths ?? [])
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
      id === 'restore-timing'
        ? [
            'server/**',
            'src/{server,shared}/**',
            'lib/**',
            'web/** and src/ui/** (shared application/authentication bundle)',
            'e2e restore/shared helpers',
            'runtime/build/dependency/workflow inputs',
          ]
        : id === 'lib-test-run'
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
              : ['backlog', 'lint'].includes(id)
                ? ['complete immutable change range and current event metadata']
                : [
                    'all application, auth, persistence, sync, runtime, build, dependency and harness inputs',
                  ];
    plan.suites[id] = {
      selected,
      dependencies,
      inputs: plan.paths ?? [],
      reason: full
        ? fullReason!
        : selected
          ? performance && ['responsiveness-baseline', 'callback-baseline'].includes(id)
            ? 'Performance dependency or additive ci-performance label.'
            : 'Automatic coverage for the complete change range.'
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
    plan.version !== 2 ||
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
