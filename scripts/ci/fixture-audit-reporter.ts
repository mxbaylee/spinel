// Exact identities for this fixed sample; no request, credential or document data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export default class FixtureAuditReporter implements Reporter {
  private readonly attempts: object[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    this.attempts.push({
      testId: test.id,
      file: basename(test.location.file),
      title: test.title,
      project: test.parent.project()?.name,
      repeatEachIndex: test.repeatEachIndex,
      retry: result.retry,
      status: result.status,
      expectedStatus: test.expectedStatus,
      startTime: result.startTime.toISOString(),
      durationMs: result.duration,
      workerIndex: result.workerIndex,
    });
    mkdirSync('fixture-audit', { recursive: true });
    writeFileSync(
      'fixture-audit/attempt-identities.json',
      JSON.stringify(this.attempts, null, 2) + '\n',
    );
  }
}
