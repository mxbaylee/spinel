import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

const root = fileURLToPath(new URL('../../', import.meta.url));

function collect(shard?: string): string[] {
  const output = mkdtempSync(join(tmpdir(), 'spinel-development-collection-'));
  const reportPath = join(output, 'collection.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url)),
        'test',
        '--project=development',
        '--list',
        '--reporter=json',
        ...(shard ? [`--shard=${shard}`] : []),
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          CI: '1',
          SPINEL_E2E_PROJECT: 'development',
          SPINEL_DOC_EDITING_MOBILE: '',
          SPINEL_CI_FULL_COMPATIBILITY: 'false',
          SHARD: shard ?? '',
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        },
      },
    );
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as JSONReport;
    assert.deepEqual(report.errors, []);
    const ids: string[] = [];
    function visit(suites: JSONReportSuite[]) {
      for (const suite of suites) {
        for (const spec of suite.specs)
          for (const selected of spec.tests) {
            assert.equal(selected.projectName, 'development');
            ids.push(spec.id);
          }
        visit(suite.suites ?? []);
      }
    }
    visit(report.suites);
    assert.ok(ids.length > 0);
    assert.equal(new Set(ids).size, ids.length);
    return ids;
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

test('actual development matrix partitions the complete project exactly once', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const shards = [...workflow.matchAll(/project: development, shard: (\d+)\/(\d+)/g)].map(
    (match) => ({ current: Number(match[1]), total: Number(match[2]) }),
  );
  assert.ok(shards.length > 1);
  assert.ok(shards.every((shard) => shard.total === shards.length));
  assert.deepEqual(
    shards.map((shard) => shard.current).sort((a, b) => a - b),
    Array.from({ length: shards.length }, (_, index) => index + 1),
    'A missing or duplicated matrix owner must fail before collection.',
  );
  const full = collect();
  const partition = shards.flatMap((shard) => collect(`${shard.current}/${shard.total}`));
  assert.equal(new Set(partition).size, partition.length, 'No case may run in two owners.');
  assert.deepEqual(partition.sort(), full.sort(), 'No selected case may disappear.');
});
