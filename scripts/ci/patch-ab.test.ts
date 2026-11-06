import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertInstalled, sha256, toggle, variantName } from './patch-ab/toggle.ts';
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
  assert.deepEqual(ok.budgets, { flushP95Ms: 50, flushMaxMs: 100 });
  const table = renderTable(ok);
  assert.match(
    table,
    /\| previous \| 1 \| 50\.0 \| 100\.0 \| 100\.0 \| 120\.0 \| 80\.0 \| previous0123 \| 0 \| pass \|/,
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

test('runs are read in alternating order and tolerate missing files', () => {
  const root = mkdtempSync(join(tmpdir(), 'patch-ab-'));
  try {
    for (const name of ['pair-2-patched', 'pair-1-patched', 'pair-1-previous', 'ignored']) {
      mkdirSync(join(root, name));
    }
    writeFileSync(join(root, 'pair-1-previous/exit-code'), '1\n');
    writeFileSync(join(root, 'pair-1-previous/metrics.json'), JSON.stringify(metrics(1, 2)));
    writeFileSync(join(root, 'pair-1-previous/installed.json'), JSON.stringify(installed('a')));
    const runs = readRuns(root);
    assert.deepEqual(
      runs.map((r) => `${r.pair}-${r.variant}`),
      ['1-previous', '1-patched', '2-patched'],
    );
    assert.equal(runs[0]!.exitCode, 1);
    assert.equal(runs[1]!.metrics, null);
    assert.equal(runs[1]!.exitCode, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
