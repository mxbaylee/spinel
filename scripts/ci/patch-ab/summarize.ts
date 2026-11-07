// Opt-in SPN-146 attribution experiment (.github/workflows/patch-ab.yml); remove
// once the flush-tail question is answered. Summarizes alternating runs laid out
// as <runs>/pair-<n>-<variant>/{installed.json,exit-code,metrics.json}.
//   node scripts/ci/patch-ab/summarize.ts <runs> <summary.json> <summary.md>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_RESPONSIVENESS_BUDGETS } from '../../../e2e/doc-responsiveness.ts';

const { flushP95Ms, flushMaxMs, inputP95Ms, longTaskMaxMs } = DOC_RESPONSIVENESS_BUDGETS.mobile;

export interface Run {
  variant: string;
  pair: number;
  /** Playwright's exit code; a failed sample can still have valid metrics. */
  exitCode: number | null;
  /** Installed es/cjs sha256 recorded by toggle.ts, or null if missing. */
  installed: { es: string; cjs: string } | null;
  /** Parsed spn108-metrics.json, or null if the run produced none. */
  metrics: any;
  /** Position in the job's execution order (1-based), when the workflow recorded it. */
  seq?: number | null;
}

export interface Row {
  variant: string;
  pair: number;
  exitCode: number | null;
  flushP95: number | null;
  flushMax: number | null;
  pairedFlushMax: number | null;
  longestTask: number | null;
  inputP95: number | null;
  sha: string;
  budget: 'pass' | 'fail' | 'n/a';
  /** Whether this run went first or second within its pair, from the recorded sequence. */
  order: 'first' | 'second' | '-';
}

const number = (value: unknown) => (typeof value === 'number' ? value : null);

export function summarize(runs: Run[], expectedPairs?: number) {
  const problems: string[] = [];
  const firstSeq = new Map<number, number>();
  for (const run of runs)
    if (typeof run.seq === 'number')
      firstSeq.set(run.pair, Math.min(firstSeq.get(run.pair) ?? Infinity, run.seq));
  const rows: Row[] = runs.map((run) => {
    const label = `pair-${run.pair}-${run.variant}`;
    const summary = run.metrics?.summary;
    if (!summary) problems.push(`${label}: missing spn108-metrics.json`);
    if (!run.installed) problems.push(`${label}: missing installed.json`);
    const flushP95 = number(summary?.capacityFlushPairMs?.p95);
    const pairedFlushMax = number(summary?.pairedFlushMaximumMs);
    const inputP95 = number(summary?.frameOpportunityMs?.p95);
    const longestTask = number(summary?.longTaskMs?.max);
    return {
      variant: run.variant,
      pair: run.pair,
      exitCode: run.exitCode,
      flushP95,
      flushMax: number(summary?.capacityFlushPairMs?.max),
      pairedFlushMax,
      longestTask,
      inputP95,
      sha: run.installed?.es.slice(0, 12) ?? '-',
      // Every budget the spec gates on, not only the flush ones: a run over the input p95 or the
      // longest-task budget fails here too, so a failing spec cannot read as a pass.
      budget:
        flushP95 === null || pairedFlushMax === null
          ? 'n/a'
          : flushP95 <= flushP95Ms &&
              pairedFlushMax <= flushMaxMs &&
              (inputP95 === null || inputP95 <= inputP95Ms) &&
              (longestTask === null || longestTask <= longTaskMaxMs)
            ? 'pass'
            : 'fail',
      order:
        typeof run.seq !== 'number' ? '-' : run.seq === firstSeq.get(run.pair) ? 'first' : 'second',
    };
  });
  // Each variant must be one build, and the two variants must differ.
  const byVariant = new Map<string, Set<string>>();
  for (const run of runs)
    if (run.installed)
      byVariant.set(
        run.variant,
        (byVariant.get(run.variant) ?? new Set()).add(`${run.installed.es}/${run.installed.cjs}`),
      );
  for (const [variant, shas] of byVariant)
    if (shas.size !== 1) problems.push(`${variant}: ${shas.size} different installed builds`);
  const [first, second] = [...byVariant.values()];
  if (byVariant.size === 2 && [...first!][0] === [...second!][0])
    problems.push('previous and patched installed the same build');
  // Per-variant tally. A variant that did not produce metrics for every expected pair
  // is a harness problem, not a quiet gap in the sample.
  const tally: Record<
    string,
    { runs: number; measured: number; overBudget: number; nonZeroExit: number }
  > = {};
  for (const row of rows) {
    const entry = (tally[row.variant] ??= {
      runs: 0,
      measured: 0,
      overBudget: 0,
      nonZeroExit: 0,
    });
    entry.runs += 1;
    if (row.budget !== 'n/a') entry.measured += 1;
    if (row.budget === 'fail') entry.overBudget += 1;
    // A run can exit non-zero (a timeout, an input or long-task budget) with every flush budget passing.
    if (row.exitCode !== 0) entry.nonZeroExit += 1;
  }
  if (expectedPairs !== undefined)
    for (const variant of ['previous', 'patched'])
      if ((tally[variant]?.measured ?? 0) !== expectedPairs)
        problems.push(
          `${variant}: ${tally[variant]?.measured ?? 0} of ${expectedPairs} expected pairs produced metrics`,
        );
  const cpuThrottles = [
    ...new Set(
      runs
        .map((run) => run.metrics?.instrumentation?.cpuThrottle)
        .filter((value): value is number => typeof value === 'number'),
    ),
  ].sort((a, b) => a - b);
  if (cpuThrottles.length > 1)
    problems.push(`runs used different CPU throttles: ${cpuThrottles.join(', ')}`);
  return {
    budgets: { flushP95Ms, flushMaxMs, inputP95Ms, longTaskMaxMs },
    rows,
    problems,
    tally,
    cpuThrottles,
  };
}

const cell = (value: number | null) => (value === null ? '-' : value.toFixed(1));

export function renderTable({
  budgets,
  rows,
  problems,
  tally,
  cpuThrottles,
}: ReturnType<typeof summarize>) {
  const lines = [
    '## SPN-146 hosted Docs A/B (mobile plain-1)',
    '',
    `Budget: capacity flush p95 <= ${budgets.flushP95Ms} ms, paired flush max <= ${budgets.flushMaxMs} ms, input p95 <= ${budgets.inputP95Ms} ms, longest task <= ${budgets.longTaskMaxMs} ms. Times in ms. CPU throttle (from the metrics): ${cpuThrottles.length ? cpuThrottles.map((rate) => `${rate}x`).join(', ') : 'unrecorded'}.`,
    '',
    '| variant | pair | order | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.variant} | ${r.pair} | ${r.order} | ${cell(r.flushP95)} | ${cell(r.flushMax)} | ${cell(r.pairedFlushMax)} | ${cell(r.longestTask)} | ${cell(r.inputP95)} | ${r.sha} | ${r.exitCode ?? '-'} | ${r.budget} |`,
    ),
  ];
  lines.push(
    '',
    '**Over budget per variant:** ' +
      (Object.entries(tally)
        .map(
          ([variant, t]) =>
            `${variant} ${t.overBudget} of ${t.measured} (budgets), ${t.nonZeroExit} of ${t.runs} non-zero exits`,
        )
        .join(', ') || 'no runs') +
      '. Do not pool these counts with another run or another runner without saying so; one run cannot separate the builds when the tail is rare (1 of 28 previous-build pairs at 4x).',
  );
  if (problems.length) lines.push('', '**Harness problems**', '', ...problems.map((p) => `- ${p}`));
  return `${lines.join('\n')}\n`;
}

export function readRuns(directory: string): Run[] {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .flatMap((name) => {
      const match = /^pair-(\d+)-(previous|patched)$/.exec(name);
      if (!match) return [];
      const dir = join(directory, name);
      const metrics = read(join(dir, 'metrics.json'));
      const installed = read(join(dir, 'installed.json'));
      const exitCode = read(join(dir, 'exit-code'));
      const seq = read(join(dir, 'seq'));
      return [
        {
          variant: match[2]!,
          pair: Number(match[1]),
          exitCode: exitCode === null ? null : Number(exitCode),
          installed: installed && JSON.parse(installed),
          metrics: metrics && JSON.parse(metrics),
          seq: seq === null ? null : Number(seq),
        },
      ];
    })
    .sort(
      (a, b) =>
        a.pair - b.pair ||
        (a.seq != null && b.seq != null ? a.seq - b.seq : a.variant === 'previous' ? -1 : 1),
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, json, markdown] = process.argv.slice(2);
  if (!directory || !json || !markdown) throw new Error('Usage: summarize.ts <runs> <json> <md>');
  const expectedPairs = process.env.PAIRS ? Number(process.env.PAIRS) : undefined;
  const result = summarize(readRuns(directory), expectedPairs);
  if (!result.rows.length) result.problems.push('no runs found');
  writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(markdown, renderTable(result));
  if (result.problems.length) {
    console.error(result.problems.join('\n'));
    process.exitCode = 1;
  }
}
