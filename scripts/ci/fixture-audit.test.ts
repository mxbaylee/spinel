import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditCases, validateAuditReport } from './fixture-audit.ts';
import type { AuditIdentity, AuditProject } from './fixture-audit.ts';

function evidence(project: AuditProject = 'production') {
  const identities: AuditIdentity[] = [];
  const report = {
    config: { workers: 1, projects: [{ name: project, repeatEach: 2, retries: 0 }] },
    errors: [],
    specs: auditCases(project).map((item, index) => ({
      ...item,
      id: `case-${index}`,
      tests: [0, 1].map((repeatEachIndex) => {
        const startTime = new Date(Date.UTC(2026, 10, 1, 0, index, repeatEachIndex)).toISOString();
        identities.push({
          ...item,
          project,
          repeatEachIndex,
          testId: `test-${index}-${repeatEachIndex}`,
          retry: 0,
          status: 'passed',
          expectedStatus: 'passed',
          startTime,
          durationMs: 12,
          workerIndex: repeatEachIndex,
        });
        return {
          projectName: project,
          expectedStatus: 'passed',
          status: 'expected',
          results: [
            { retry: 0, status: 'passed', duration: 12, startTime, workerIndex: repeatEachIndex },
          ],
        };
      }),
    })),
  };
  return { report, identities };
}

for (const project of ['production', 'development', 'sync-production'] as const) {
  test(`the exact ${project} manifest accepts both genuine first-attempt repetitions`, () => {
    const { report, identities } = evidence(project);
    const verified = validateAuditReport(report, project, identities);
    assert.equal(verified.complete, true, verified.reasons.join('\n'));
    assert.equal(verified.attempts.length, auditCases(project).length * 2);
    assert.deepEqual(
      verified.attempts.slice(0, 2).map((attempt) => attempt.repeatEachIndex),
      [0, 1],
    );
  });
}

test('the retained original baseline report is verified without inventing repetition indices', () => {
  const { report } = evidence();
  const verified = validateAuditReport(report, 'production');
  assert.equal(verified.complete, true);
  assert.ok(verified.attempts.every((attempt) => attempt.repeatEachIndex === null));
  assert.deepEqual(
    verified.attempts.slice(0, 2).map((attempt) => attempt.sampleOrdinal),
    [0, 1],
  );
});

test('a missing scenario offset by an extra matching test still fails despite the right total', () => {
  const { report } = evidence();
  report.specs[0].title = 'an unexpected replacement case';
  assert.equal(validateAuditReport(report, 'production').complete, false);
});

test('three executions of one case cannot compensate for only one of another', () => {
  const { report } = evidence();
  report.specs[0].tests.push(report.specs[1].tests.pop()!);
  assert.equal(validateAuditReport(report, 'production').complete, false);
});

test('wrong-project records are not accepted as the requested coverage', () => {
  const { report } = evidence();
  report.specs[0].tests[0].projectName = 'development';
  assert.equal(validateAuditReport(report, 'production').complete, false);
});

for (const status of ['skipped', 'failed', 'timedOut', 'interrupted']) {
  test(`a ${status} first attempt remains a failed audit`, () => {
    const { report } = evidence();
    report.specs[0].tests[0].results[0].status = status;
    assert.equal(validateAuditReport(report, 'production').complete, false);
  });
}

test('expected-failing annotations and passing retries cannot satisfy the sample', () => {
  const { report } = evidence();
  report.specs[0].tests[0].expectedStatus = 'failed';
  assert.equal(validateAuditReport(report, 'production').complete, false);
  report.specs[0].tests[0].expectedStatus = 'passed';
  report.specs[0].tests[0].results[0].retry = 1;
  assert.equal(validateAuditReport(report, 'production').complete, false);
});

for (const field of ['repeatEachIndex', 'testId', 'startTime'] as const) {
  test(`duplicate ${field} cannot masquerade as two independent repetitions`, () => {
    const { report, identities } = evidence();
    if (field === 'repeatEachIndex') identities[1].repeatEachIndex = identities[0].repeatEachIndex;
    else identities[1][field] = identities[0][field];
    assert.equal(validateAuditReport(report, 'production', identities).complete, false);
  });
}

test('missing identity records or broadened retry configuration fail closed', () => {
  const { report, identities } = evidence();
  identities.pop();
  assert.equal(validateAuditReport(report, 'production', identities).complete, false);
  report.config.projects[0].retries = 1;
  assert.equal(validateAuditReport(report, 'production').complete, false);
});
