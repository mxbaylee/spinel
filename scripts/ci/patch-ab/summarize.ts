// Opt-in SPN-146 attribution experiment (.github/workflows/patch-ab.yml); remove
// once the flush-tail question is answered. Summarizes alternating runs laid out
// as <runs>/pair-<n>-<variant>/{installed.json,exit-code,metrics.json}.
//   node scripts/ci/patch-ab/summarize.ts <runs> <summary.json> <summary.md>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_RESPONSIVENESS_BUDGETS } from '../../../e2e/doc-responsiveness.ts';

const { flushP95Ms, flushMaxMs } = DOC_RESPONSIVENESS_BUDGETS.mobile;

export interface Run {
  variant: string;
  pair: number;
  /** Playwright's exit code; a failed sample can still have valid metrics. */
  exitCode: number | null;
  /** Installed es/cjs sha256 recorded by toggle.ts, or null if missing. */
  installed: { es: string; cjs: string } | null;
  /** Parsed spn108-metrics.json, or null if the run produced none. */
  metrics: any;
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
}

const number = (value: unknown) => (typeof value === 'number' ? value : null);

export function summarize(runs: Run[]) {
  const problems: string[] = [];
  const rows: Row[] = runs.map((run) => {
    const label = `pair-${run.pair}-${run.variant}`;
    const summary = run.metrics?.summary;
    if (!summary) problems.push(`${label}: missing spn108-metrics.json`);
    if (!run.installed) problems.push(`${label}: missing installed.json`);
    const flushP95 = number(summary?.capacityFlushPairMs?.p95);
    const pairedFlushMax = number(summary?.pairedFlushMaximumMs);
    return {
      variant: run.variant,
      pair: run.pair,
      exitCode: run.exitCode,
      flushP95,
      flushMax: number(summary?.capacityFlushPairMs?.max),
      pairedFlushMax,
      longestTask: number(summary?.longTaskMs?.max),
      inputP95: number(summary?.frameOpportunityMs?.p95),
      sha: run.installed?.es.slice(0, 12) ?? '-',
      budget:
        flushP95 === null || pairedFlushMax === null
          ? 'n/a'
          : flushP95 <= flushP95Ms && pairedFlushMax <= flushMaxMs
            ? 'pass'
            : 'fail',
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
  return { budgets: { flushP95Ms, flushMaxMs }, rows, problems };
}

const cell = (value: number | null) => (value === null ? '-' : value.toFixed(1));

export function renderTable({ budgets, rows, problems }: ReturnType<typeof summarize>) {
  const lines = [
    '## SPN-146 hosted Docs A/B (mobile plain-1)',
    '',
    `Budget: capacity flush p95 <= ${budgets.flushP95Ms} ms, paired flush max <= ${budgets.flushMaxMs} ms. Times in ms.`,
    '',
    '| variant | pair | flush p95 | flush max | paired flush max | longest task | input p95 | sha | exit | budget |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.variant} | ${r.pair} | ${cell(r.flushP95)} | ${cell(r.flushMax)} | ${cell(r.pairedFlushMax)} | ${cell(r.longestTask)} | ${cell(r.inputP95)} | ${r.sha} | ${r.exitCode ?? '-'} | ${r.budget} |`,
    ),
  ];
  if (problems.length) lines.push('', '**Harness problems**', '', ...problems.map((p) => `- ${p}`));
  return `${lines.join('\n')}\n`;
}

export function readRuns(directory: string): Run[] {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  return readdirSync(directory)
    .flatMap((name) => {
      const match = /^pair-(\d+)-(previous|patched)$/.exec(name);
      if (!match) return [];
      const dir = join(directory, name);
      const metrics = read(join(dir, 'metrics.json'));
      const installed = read(join(dir, 'installed.json'));
      const exitCode = read(join(dir, 'exit-code'));
      return [
        {
          variant: match[2]!,
          pair: Number(match[1]),
          exitCode: exitCode === null ? null : Number(exitCode),
          installed: installed && JSON.parse(installed),
          metrics: metrics && JSON.parse(metrics),
        },
      ];
    })
    .sort((a, b) => a.pair - b.pair || (a.variant === 'previous' ? -1 : 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, json, markdown] = process.argv.slice(2);
  if (!directory || !json || !markdown) throw new Error('Usage: summarize.ts <runs> <json> <md>');
  const result = summarize(readRuns(directory));
  if (!result.rows.length) result.problems.push('no runs found');
  writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(markdown, renderTable(result));
  if (result.problems.length) {
    console.error(result.problems.join('\n'));
    process.exitCode = 1;
  }
}
