import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { readServerEvidence } from './fixture-evidence.ts';
import type { ServerEvidence } from './fixture-evidence.ts';
import { appendDiagnostic, isReset, resetDiagnostic } from './reset-diagnostics.ts';

// Observe only: this reporter never changes a test's result, retries or budget.
// A failure here is swallowed so diagnostics cannot affect the gate.
export default class ResetDiagnosticsReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    try {
      if (result.status === 'passed' || result.status === 'skipped') return;
      if (!isReset(result.errors)) return;
      const project = test.parent.project();
      const origin = project?.use.baseURL;
      let evidence: ServerEvidence | undefined;
      if (origin)
        try {
          evidence = readServerEvidence(origin);
        } catch {
          evidence = undefined;
        }
      const diagnostic = resetDiagnostic({
        project: project?.name ?? 'unknown',
        file: basename(test.location.file),
        line: test.location.line,
        attempt: result.retry + 1,
        status: result.status,
        errors: result.errors,
        evidence,
        now: Date.now(),
      });
      if (!diagnostic) return;
      console.error(JSON.stringify(diagnostic));
      const path = resolve('playwright-report', `reset-diagnostics-${diagnostic.project}.json`);
      let saved: unknown = [];
      try {
        saved = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        saved = [];
      }
      mkdirSync(resolve('playwright-report'), { recursive: true });
      writeFileSync(path, JSON.stringify(appendDiagnostic(saved, diagnostic), null, 2) + '\n');
    } catch {
      // Diagnostics are best effort and must never decide the run.
    }
  }
}
