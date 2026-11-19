import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { JSONReport } from '@playwright/test/reporter';
import { verifyDocEditingMobile } from './doc-editing-mobile-result.ts';

const source = 'a'.repeat(40);
function report(): JSONReport {
  // Only reporter fields used by this contract are populated. Collection has
  // the same stable identities; it does not contain execution results.
  return {
    errors: [],
    suites: [
      {
        title: 'doc-mobile.spec.ts',
        specs: [],
        suites: [
          {
            title: 'Doc editing @doc-editing-mobile',
            specs: [
              {
                id: 'native-editing',
                title: 'deletes a selection',
                tags: ['doc-editing-mobile'],
                tests: [
                  {
                    projectName: 'doc-editing-mobile',
                    expectedStatus: 'passed',
                    status: 'expected',
                    results: [{ status: 'passed', retry: 0, errors: [] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  } as unknown as JSONReport;
}
const spec = (value: JSONReport) => value.suites[0].suites![0].specs[0];
const only = (value: JSONReport) => spec(value).tests[0];

test('complete mobile evidence binds the requested source and all collected first attempts', () => {
  const collection = report();
  only(collection).results = [];
  assert.deepEqual(verifyDocEditingMobile(collection, report(), source, source), {
    requested: source,
    actual: source,
    project: 'doc-editing-mobile',
    testIds: ['native-editing'],
    tests: 1,
  });
});

test('missing, skipped, cancelled, retried and mismatched mobile evidence cannot pass', () => {
  for (const mutate of [
    (value: JSONReport) => {
      value.suites = [];
    },
    (value: JSONReport) => {
      spec(value).id = 'different-case';
    },
    (value: JSONReport) => {
      only(value).results = [];
    },
    (value: JSONReport) => {
      only(value).results[0].status = 'skipped';
    },
    (value: JSONReport) => {
      only(value).results[0].status = 'interrupted';
    },
    (value: JSONReport) => {
      only(value).results[0].status = 'failed';
    },
    (value: JSONReport) => {
      only(value).results[0].status = 'timedOut';
    },
    (value: JSONReport) => {
      only(value).expectedStatus = 'skipped';
    },
    (value: JSONReport) => {
      only(value).status = 'flaky';
    },
    (value: JSONReport) => {
      only(value).results[0].retry = 1;
    },
    (value: JSONReport) => {
      only(value).results.push(only(value).results[0]);
    },
    (value: JSONReport) => {
      only(value).projectName = 'mobile-https';
    },
    (value: JSONReport) => {
      value.errors.push({ message: 'runner failed' });
    },
    (value: JSONReport) => {
      only(value).results[0].errors.push({ message: 'case failed' });
    },
    (value: JSONReport) => {
      value.stats.skipped = 1;
    },
    (value: JSONReport) => {
      value.stats.expected = 0;
    },
    (value: JSONReport) => {
      spec(value).tags = [];
    },
    (value: JSONReport) => {
      spec(value).tags = ['doc-editing-mobile-extra'];
    },
    (value: JSONReport) => {
      value.suites[0].suites![0].specs.push(spec(value));
    },
  ]) {
    const observed = report();
    mutate(observed);
    assert.throws(() => verifyDocEditingMobile(report(), observed, source, source));
  }
  const skippedCollection = report();
  only(skippedCollection).expectedStatus = 'skipped';
  assert.throws(() => verifyDocEditingMobile(skippedCollection, report(), source, source));
  assert.throws(
    () => verifyDocEditingMobile(report(), report(), source, 'b'.repeat(40)),
    /requested revision/,
  );
  for (const requested of ['', 'main', '0'.repeat(40)])
    assert.throws(() => verifyDocEditingMobile(report(), report(), requested, requested));
});

test('CLI preserves a failing receipt when requested collection or execution is absent', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'spinel-mobile-result-'));
  try {
    for (const flag of ['0', '1']) {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('./doc-editing-mobile-result.ts', import.meta.url)),
          'missing-collection.json',
          'missing-result.json',
        ],
        {
          cwd,
          encoding: 'utf8',
          timeout: 5000,
          env: {
            ...process.env,
            SPINEL_DOC_EDITING_MOBILE: flag,
            REQUESTED_SHA: source,
            GITHUB_STEP_SUMMARY: join(cwd, 'summary.md'),
          },
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(
        readFileSync(join(cwd, 'doc-editing-mobile-result.json'), 'utf8'),
      );
      assert.equal(evidence.passed, false);
      assert.equal(evidence.requested, source);
      assert.match(evidence.error, flag === '1' ? /ENOENT/ : /runtime flag/);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
