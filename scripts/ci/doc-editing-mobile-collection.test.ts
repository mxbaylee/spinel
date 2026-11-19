import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

function collect(flag: string, compatibility = 'false', project = '') {
  const output = mkdtempSync(join(tmpdir(), 'spinel-mobile-collection-'));
  const reportPath = join(output, 'collection.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url)),
        'test',
        'e2e/documents.spec.ts',
        'e2e/doc-mobile.spec.ts',
        '--list',
        '--reporter=json',
        ...(project ? [`--project=${project}`] : []),
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          CI: '1',
          SHARD: '',
          SPINEL_E2E_PROJECT: project,
          SPINEL_DOC_EDITING_MOBILE: flag,
          SPINEL_CI_FULL_COMPATIBILITY: compatibility,
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        },
      },
    );
    assert.equal(result.error, undefined, result.stderr);
    return {
      status: result.status,
      stderr: result.stderr,
      report: existsSync(reportPath)
        ? (JSON.parse(readFileSync(reportPath, 'utf8')) as JSONReport)
        : undefined,
    };
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

function identities(result: ReturnType<typeof collect>) {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.report);
  assert.deepEqual(result.report.errors, []);
  const rows: { id: string; project: string; mobile: boolean }[] = [];
  function visit(suites: JSONReportSuite[]) {
    for (const suite of suites) {
      for (const spec of suite.specs)
        for (const test of spec.tests)
          rows.push({
            id: `${test.projectName}:${spec.id}`,
            project: test.projectName,
            mobile: spec.tags.includes('doc-editing-mobile'),
          });
      visit(suite.suites ?? []);
    }
  }
  visit(result.report.suites);
  assert.ok(rows.length > 0);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  return rows;
}

test('actual routine/full collection keeps automatic owners and adds only the explicitly requested mobile owner', () => {
  for (const compatibility of ['false', 'true']) {
    const ordinary = identities(collect('', compatibility));
    assert.equal(ordinary.filter((row) => row.mobile).length, 0);
    assert.equal(ordinary.filter((row) => row.project === 'doc-editing-mobile').length, 0);
    for (const owner of [
      'development',
      'production',
      'mobile-https',
      'sync-development',
      'sync-production',
    ])
      assert.ok(
        ordinary.some((row) => row.project === owner),
        owner,
      );
    const requested = identities(collect('1', compatibility));
    const mobile = requested.filter((row) => row.mobile);
    assert.ok(mobile.length > 0, 'An explicit request must collect the mobile editing contract.');
    assert.ok(mobile.every((row) => row.project === 'doc-editing-mobile'));
    assert.deepEqual(
      requested
        .filter((row) => !row.mobile)
        .map((row) => row.id)
        .sort(),
      ordinary.map((row) => row.id).sort(),
      'Opt-in selection must not remove or duplicate any automatic case.',
    );
  }
});

test('an explicitly selected mobile project refuses absent or nonexact runtime flags', () => {
  for (const flag of ['', '0', 'true', 'false', '01']) {
    const result = collect(flag, 'true', 'doc-editing-mobile');
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, /requires SPINEL_DOC_EDITING_MOBILE=1/);
  }
});
