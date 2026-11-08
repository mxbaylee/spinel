import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assertInstalled,
  pinnedInstalled,
  sha256,
  toggle,
  variantName,
} from './patch-ab/toggle.ts';
import { readRuns, renderTable, summarize, type Run } from './patch-ab/summarize.ts';

const installed = (es: string) => ({ es, cjs: `${es}-cjs` });
const metrics = (p95: number, paired: number) => ({
  summary: {
    capacityFlushPairMs: { p95, max: paired },
    pairedFlushMaximumMs: paired,
    longTaskMs: { max: 120 },
    frameOpportunityMs: { p95: 80 },
  },
});
const withBudgetFields = (input: number, longTask: number) => ({
  summary: {
    ...metrics(10, 10).summary,
    longTaskMs: { max: longTask },
    frameOpportunityMs: { p95: input },
  },
});
const run = (pair: number, variant: string, m: unknown, es = variant): Run => ({
  variant,
  pair,
  exitCode: 0,
  installed: installed(`${es}0123456789abcdef`),
  metrics: m,
});

test('variant names are exactly previous and patched', () => {
  assert.equal(variantName('previous'), 'previous');
  assert.equal(variantName('patched'), 'patched');
  for (const bad of [undefined, '', 'original', 'qualifiedRangesPatched'])
    assert.throws(() => variantName(bad), /previous or patched/);
});

test('installed hashes must match the expected build for every format', () => {
  assert.doesNotThrow(() => assertInstalled('patched', installed('a'), installed('a')));
  assert.throws(
    () => assertInstalled('patched', installed('a'), { es: 'a', cjs: 'other' }),
    /Installed cjs for patched/,
  );
});

test('toggling rewrites both bundles to distinct, repeatable builds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'patch-ab-'));
  try {
    for (const format of ['es', 'cjs']) {
      mkdirSync(join(root, 'node_modules/@univerjs/docs/lib', format), { recursive: true });
      cpSync(
        `node_modules/@univerjs/docs/lib/${format}/index.js`,
        join(root, 'node_modules/@univerjs/docs/lib', format, 'index.js'),
      );
    }
    const previous = await toggle(root, 'previous');
    const patched = await toggle(root, 'patched');
    assert.notEqual(previous.es, patched.es);
    assert.notEqual(previous.cjs, patched.cjs);
    assert.deepEqual(await toggle(root, 'previous'), previous);
    // The installed bytes are the pinned builds, not merely whatever was just written.
    assert.deepEqual({ es: previous.es, cjs: previous.cjs }, pinnedInstalled.previous);
    assert.deepEqual({ es: patched.es, cjs: patched.cjs }, pinnedInstalled.patched);
    assert.match(previous.es, /^[0-9a-f]{64}$/);
    assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('summary applies the mobile flush gates and reports harness problems', () => {
  const ok = summarize([
    run(1, 'previous', metrics(50, 100)),
    run(1, 'patched', metrics(50.1, 40)),
    run(2, 'previous', metrics(10, 100.1)),
    run(2, 'patched', metrics(10, 10)),
  ]);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(
    ok.rows.map((row) => row.budget),
    ['pass', 'fail', 'fail', 'pass'],
  );
  assert.deepEqual(ok.budgets, {
    flushP95Ms: 50,
    flushMaxMs: 100,
    inputP95Ms: 200,
    longTaskMaxMs: 500,
  });
  const table = renderTable(ok);
  assert.match(
    table,
    /\| previous \| 1 \| - \| 50\.0 \| 100\.0 \| 100\.0 \| 120\.0 \| 80\.0 \| previous0123 \| 0 \| pass \|/,
  );
  assert.ok(!table.includes('Harness problems'));

  const bad = summarize([
    run(1, 'previous', null),
    { ...run(1, 'patched', metrics(1, 1)), installed: null },
    run(2, 'previous', metrics(1, 1), 'other'),
  ]);
  assert.equal(bad.rows[0]!.budget, 'n/a');
  for (const pattern of [
    /pair-1-previous: missing spn108/,
    /pair-1-patched: missing installed/,
    /previous: 2 different/,
  ])
    assert.ok(
      bad.problems.some((p) => pattern.test(p)),
      String(pattern),
    );
  assert.match(renderTable(bad), /Harness problems/);

  const same = summarize([
    run(1, 'previous', metrics(1, 1), 'x'),
    run(1, 'patched', metrics(1, 1), 'x'),
  ]);
  assert.deepEqual(same.problems, ['previous and patched installed the same build']);
});

test('summary tallies over-budget runs, records run order and requires every expected pair', () => {
  const seq = (r: Run, n: number): Run => ({ ...r, seq: n });
  const runs = [
    seq(run(1, 'previous', metrics(10, 120)), 1),
    seq(run(1, 'patched', metrics(10, 10)), 2),
    seq(run(2, 'patched', metrics(10, 10)), 3),
    seq(run(2, 'previous', metrics(10, 10)), 4),
  ];
  const result = summarize(runs, 2);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.tally, {
    previous: { runs: 2, measured: 2, overBudget: 1, nonZeroExit: 0 },
    patched: { runs: 2, measured: 2, overBudget: 0, nonZeroExit: 0 },
  });
  // A run that exits non-zero with every flush budget passing is counted apart from a flush breach.
  const timedOut = summarize(
    runs.map((r) => (r.variant === 'patched' && r.pair === 1 ? { ...r, exitCode: 1 } : r)),
    2,
  );
  assert.deepEqual(timedOut.tally.patched, { runs: 2, measured: 2, overBudget: 0, nonZeroExit: 1 });
  assert.deepEqual(
    result.rows.map((row) => `${row.pair}-${row.variant}-${row.order}`),
    ['1-previous-first', '1-patched-second', '2-patched-first', '2-previous-second'],
  );
  const table = renderTable(result);
  assert.match(
    table,
    /previous 1 of 2 \(budgets\), 0 of 2 non-zero exits, patched 0 of 2 \(budgets\), 0 of 2 non-zero exits/,
  );
  assert.match(table, /Do not pool/);
  // A half-empty run is a harness problem, not a quiet gap.
  const short = summarize([...runs.slice(0, 3), seq(run(2, 'previous', null), 4)], 2);
  assert.ok(short.problems.some((p) => /previous: 1 of 2 expected pairs produced metrics/.test(p)));
  assert.equal(summarize(runs.slice(0, 2)).problems.length, 0, 'no expectation, no count check');
});

test('summary records the CPU throttle and flags a mix of throttles', () => {
  const throttled = (rate: number) => ({
    ...metrics(10, 10),
    instrumentation: { cpuThrottle: rate },
  });
  const one = summarize([run(1, 'previous', throttled(6)), run(1, 'patched', throttled(6))]);
  assert.deepEqual(one.cpuThrottles, [6]);
  assert.deepEqual(one.problems, []);
  assert.match(renderTable(one), /CPU throttle \(from the metrics\): 6x/);
  const mixed = summarize([run(1, 'previous', throttled(4)), run(1, 'patched', throttled(8))]);
  assert.ok(mixed.problems.some((p) => /different CPU throttles: 4, 8/.test(p)));
  assert.match(renderTable(summarize([run(1, 'previous', metrics(1, 1))])), /unrecorded/);
});

test('runs are read in alternating order and tolerate missing files', () => {
  const root = mkdtempSync(join(tmpdir(), 'patch-ab-'));
  try {
    for (const name of ['pair-2-patched', 'pair-1-patched', 'pair-1-previous', 'ignored']) {
      mkdirSync(join(root, name));
    }
    writeFileSync(join(root, 'pair-1-previous/exit-code'), '1\n');
    writeFileSync(join(root, 'pair-1-previous/seq'), '2\n');
    writeFileSync(join(root, 'pair-1-previous/metrics.json'), JSON.stringify(metrics(1, 2)));
    writeFileSync(join(root, 'pair-1-previous/installed.json'), JSON.stringify(installed('a')));
    const runs = readRuns(root);
    assert.deepEqual(
      runs.map((r) => `${r.pair}-${r.variant}`),
      ['1-previous', '1-patched', '2-patched'],
    );
    assert.equal(runs[0]!.exitCode, 1);
    assert.equal(runs[0]!.seq, 2);
    assert.equal(runs[1]!.seq, null);
    assert.equal(runs[1]!.metrics, null);
    assert.equal(runs[1]!.exitCode, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing runs directory reads as no runs instead of throwing', () => {
  assert.deepEqual(readRuns(join(tmpdir(), 'patch-ab-does-not-exist')), []);
});

test('the opt-in workflow stays label-gated, same-repository and read-only', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/patch-ab.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /ci-patch-ab/);
  assert.match(workflow, /"ci-patch-ab","ci-patch-ab-6x","ci-patch-ab-8x"/);
  // The label reaches the shell through env and is matched against fixed names only.
  assert.match(workflow, /LABEL: \$\{\{ github\.event\.label\.name \}\}/);
  assert.match(workflow, /ci-patch-ab-6x\) rate=6 ;;/);
  assert.match(workflow, /ci-patch-ab-8x\) rate=8 ;;/);
  assert.match(workflow, /\*\) rate=4 ;;/);
  assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  const steps = workflow.split(/\n {6}- /);
  const summarize = steps.find((step) => step.startsWith('name: Summarize'));
  assert.ok(summarize, 'a Summarize step exists');
  assert.match(summarize, /^\s+if: always\(\)$/m);
  assert.match(summarize, /summarize\.ts/);
  assert.match(summarize, /PAIRS="\$PAIRS"/, 'the expected pair count reaches the summarizer');
  assert.match(workflow, /echo "\$seq" > "\$run\/seq"/, 'run order is recorded per run');
});

test('summarize fails a run over the input p95 or longest-task budget even when the flush budgets pass', () => {
  const rows = summarize(
    [
      run(1, 'previous', withBudgetFields(80, 120)),
      run(1, 'patched', withBudgetFields(205, 120)),
      run(2, 'previous', withBudgetFields(80, 520)),
      run(2, 'patched', withBudgetFields(200, 500)),
    ],
    2,
  ).rows;
  assert.deepEqual(
    rows.map((row) => `${row.pair}-${row.variant}-${row.budget}`),
    ['1-previous-pass', '1-patched-fail', '2-previous-fail', '2-patched-pass'],
  );
});

// Runs the workflow's real "Alternate previous and patched" script with stubbed tools. `measured`
// says which run numbers (1-based) leave a metrics file behind.
const runAlternation = (pairs: number, measured: (n: number) => boolean, stress = 0) => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/patch-ab.yml', import.meta.url),
    'utf8',
  );
  const step = workflow.split(/\n {6}- /).find((s) => s.startsWith('name: Alternate'));
  assert.ok(step, 'the alternation step exists');
  const body = step.split(/run: \|\n/)[1]!;
  const script = body
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
  const root = mkdtempSync(join(tmpdir(), 'patch-ab-flow-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    // node: the toggle writes its output file; npm: no-op; npx: creates metrics when the run is measured.
    writeFileSync(join(bin, 'node'), '#!/bin/bash\nmkdir -p "$(dirname "$3")"; echo "{}" > "$3"\n');
    writeFileSync(join(bin, 'npm'), '#!/bin/bash\nexit 0\n');
    const count = join(root, 'count');
    writeFileSync(
      join(bin, 'npx'),
      `#!/bin/bash
mkdir -p test-results
n=$(( $(cat "${count}" 2>/dev/null || echo 0) + 1 )); echo $n > "${count}"
mkdir -p test-results/x
# A timed-out run still leaves a partial metrics file, without a summary.
if [ -f "${root}/measured-$n" ]; then echo '{"summary":{}}' > test-results/x/spn108-metrics.json; else echo '{"primaryFailure":"timeout"}' > test-results/x/spn108-metrics.json; fi
exit 1
`,
    );
    for (let n = 1; n <= pairs * 2; n++)
      if (measured(n)) writeFileSync(join(root, `measured-${n}`), '');
    for (const tool of ['node', 'npm', 'npx']) chmodSync(join(bin, tool), 0o755);
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PAIRS: String(pairs),
        STRESS_PROCESSES: String(stress),
      },
      encoding: 'utf8',
    });
    const runs = Number(existsSync(count) ? readFileSync(count, 'utf8') : 0);
    return { status: result.status, stdout: result.stdout + result.stderr, runs };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('the alternation stops after four consecutive runs with no metrics and never on measured runs', () => {
  const dead = runAlternation(8, () => false);
  assert.equal(dead.status, 0, dead.stdout);
  assert.equal(dead.runs, 4, 'four unmeasured runs end the cycle');
  assert.match(dead.stdout, /Stopping: 4 consecutive runs produced no metrics/);
  // Every run is measured (and exits 1, as a budget failure would): all 16 still run.
  const live = runAlternation(8, () => true);
  assert.equal(live.runs, 16);
  assert.doesNotMatch(live.stdout, /Stopping/);
  // A measured run resets the count: three dead, one live, three dead never reaches four in a row.
  const gappy = runAlternation(2, (n) => n === 4);
  assert.equal(gappy.runs, 4);
  const resets = runAlternation(6, (n) => n === 4);
  assert.equal(
    resets.runs,
    8,
    'the count restarts after run 4, so runs 5 to 8 are the four that stop it',
  );
});

test('stress mode starts competing busy loops and ends them with every run', () => {
  // If a loop outlived its run, the script's stdout pipe would stay open and spawnSync would never return.
  const stressed = runAlternation(1, () => true, 2);
  assert.equal(stressed.status, 0);
  assert.equal(stressed.runs, 2);
  const summary = summarize(
    [run(1, 'previous', metrics(1, 1)), run(1, 'patched', metrics(1, 1))],
    1,
    4,
  );
  assert.equal(summary.stressProcesses, 4);
  assert.match(renderTable(summary), /Competing load: 4 busy-loop processes/);
  assert.doesNotMatch(
    renderTable(summarize([run(1, 'previous', metrics(1, 1))], undefined, 0)),
    /Competing load/,
  );
  const workflow = readFileSync(
    new URL('../../.github/workflows/patch-ab.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /"ci-patch-ab-stress"/);
  assert.match(workflow, /STRESS_PROCESSES=\$\(\( \(\$\(nproc\) \+ 1\) \/ 2 \)\)/);
});

test('the profile label runs the profile sample under stress and keeps its profiles', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/patch-ab.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /"ci-patch-ab-profile"/);
  assert.match(workflow, /\[ "\$LABEL" = ci-patch-ab-profile \]; then echo "SAMPLE=profile"/);
  assert.match(workflow, /typing \$\{SAMPLE:-plain-1\}/);
  assert.match(workflow, /spn108-profile\*/);
});

test('the gc label keeps plain-1 under stress and turns on the GC trace', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/patch-ab.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /"ci-patch-ab-gc"/);
  assert.match(workflow, /\[ "\$LABEL" = ci-patch-ab-gc \]; then echo "SPN146_GC_TRACE=1"/);
  assert.match(workflow, /ci-patch-ab-gc \] \|\| .*; then echo "STRESS_PROCESSES/);
});

test('the heap label samples allocations by pair parity and keeps the raw sampling profile', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/patch-ab.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /"ci-patch-ab-heap"/);
  assert.match(workflow, /SPN146_HEAP_SAMPLE=all/);
  assert.match(workflow, /SPN146_HEAP_SAMPLE=live/);
  assert.match(workflow, /spn146-heap-sampling\.json/);
});

test('the semispace label compares a larger young generation inside one run', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/patch-ab.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /"ci-patch-ab-semispace"/);
  assert.match(workflow, /SPN146_AB_V8_FLAGS="--min-semi-space-size=64 --max-semi-space-size=64"/);
  assert.match(workflow, /unset SPN146_AB_V8_FLAGS/);
  assert.match(workflow, /SEMISPACE_AB=1" >> "\$GITHUB_ENV"; echo "SPN146_GC_TRACE=1"/);
});
