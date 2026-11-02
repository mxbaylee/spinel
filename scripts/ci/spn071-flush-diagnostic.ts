import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [directory, variant] = process.argv.slice(2);
if (!directory || !['main', 'candidate'].includes(variant ?? ''))
  throw new Error('Expected directory and main/candidate');
const root = resolve(directory);
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const expected =
  variant === 'main'
    ? 'df1d910822cba284178f26ac4f6cf359ddcfacef'
    : '53ad6848d79b7b5034db6f6e99a107a518f5d9e5';
if (source !== expected) throw new Error('Unexpected source ' + source);
const harness = 'e2e/doc-responsiveness.spec.ts';
function change(before: string, after: string) {
  const path = resolve(root, harness);
  const text = readFileSync(path, 'utf8');
  if (text.split(before).length !== 2) throw new Error('Expected one match: ' + before);
  writeFileSync(path, text.replace(before, after));
}
change(
  "import { readFile, writeFile } from 'node:fs/promises';",
  "import { readFile, writeFile } from 'node:fs/promises';\nimport { startDiagnosticTrace } from './spn071-trace.ts';",
);
change(
  "        profiled = sample === 'profile';",
  "        profiled = sample === 'profile';\n      const diagnosticTrace = sample === 'plain-3';\n      let finishTrace: Awaited<ReturnType<typeof startDiagnosticTrace>> | undefined;",
);
change(
  "role: baseline ? 'baseline-observation' : 'candidate',",
  "role: 'diagnostic-only',\n        diagnostic: 'SPN-071 matched main/candidate sequence; not acceptance',",
);
change(
  '          profiler: profiled,',
  '          profiler: profiled || diagnosticTrace,\n          browserTrace: diagnosticTrace,',
);
change(
  '        if (profiled) {',
  `        if (profiled || diagnosticTrace) {
          finishTrace = await startDiagnosticTrace(cdp, info.outputPath('spn071-trace.jsonl'));
          evidence.traceClockStart = await f.page.evaluate(() => performance.mark('spn071-clock-start').startTime);`,
);
change(
  '      } finally {\n        if (finishInput)',
  '      } finally {\n        let diagnosticError: unknown;\n        try {\n        if (finishInput)',
);
change(
  '        evidence.errors = f.errors;',
  `        if (finishTrace) {
          try {
            evidence.traceClockEnd = await f.page.evaluate(() => performance.mark('spn071-clock-end').startTime);
            evidence.diagnosticTrace = await finishTrace();
            if (!(evidence.diagnosticTrace as { complete: boolean }).complete) diagnosticError = new Error('Incomplete diagnostic trace');
          } catch (error) { diagnosticError = error; evidence.diagnosticTraceError = String(error); }
        }
        evidence.errors = f.errors;`,
);
change(
  '        await cdp.detach().catch(() => {});\n        await f.close();\n      }\n    });',
  `        } finally {
          await cdp.detach().catch(() => {});
          await f.close();
        }
        if (diagnosticError) throw diagnosticError;
      }
    });`,
);
writeFileSync(
  resolve(root, 'e2e/spn071-trace.ts'),
  readFileSync(new URL('./spn071-trace.ts', import.meta.url)),
);
const files = [
  harness,
  'e2e/spn071-trace.ts',
  'src/ui/boundedDocHistory.ts',
  'web/DocEditor.tsx',
  'web/spinelSync.ts',
  'e2e/doc-responsiveness.ts',
  'e2e/doc-responsiveness-fixture.ts',
  'web/docResponsivenessEvidence.ts',
  'playwright.config.ts',
  'package-lock.json',
];
writeFileSync(
  resolve(root, 'spn071-diagnostic-identity.json'),
  JSON.stringify(
    {
      variant,
      source,
      expected,
      diagnosticOnly: true,
      attempts: 1,
      sequence: ['plain-1', 'plain-2', 'plain-3'],
      traceSample: 'plain-3',
      files: Object.fromEntries(
        files.map((file) => [
          file,
          createHash('sha256')
            .update(readFileSync(resolve(root, file)))
            .digest('hex'),
        ]),
      ),
    },
    null,
    2,
  ),
);
writeFileSync(
  resolve(root, 'spn071-diagnostic-source.patch'),
  execFileSync('git', ['diff', '--', ...files], { cwd: root, encoding: 'utf8' }),
);
