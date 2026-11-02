import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'runtime-source');
const expected = '8d2f994c3ac53c1849bd2b68927059d9c20c99f0';
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (source !== expected) throw new Error('Unexpected diagnostic runtime source: ' + source);
const harness = resolve(root, 'e2e/doc-responsiveness.spec.ts');
const original = readFileSync(harness, 'utf8');
let text = original;
function change(before: string, after: string) {
  if (text.split(before).length !== 2) throw new Error('Expected one harness anchor: ' + before);
  text = text.replace(before, after);
}
change(
  "import { readFile, writeFile } from 'node:fs/promises';",
  "import { readFile, writeFile } from 'node:fs/promises';\nimport { startDiagnosticTrace } from './spn133-trace.ts';",
);
change(
  '      let profiling = false;',
  '      let profiling = false;\n      let finishTrace: Awaited<ReturnType<typeof startDiagnosticTrace>> | undefined;',
);
change(
  "role: baseline ? 'baseline-observation' : 'candidate',",
  "role: 'diagnostic-only',\n        diagnostic: 'SPN-133 one profile per preset; never acceptance',",
);
change(
  '          profiler: profiled,',
  '          profiler: profiled,\n          browserTrace: profiled,',
);
change(
  "          await cdp.send('Profiler.enable');",
  "          finishTrace = await startDiagnosticTrace(cdp, info.outputPath('spn133-trace.json'));\n          evidence.traceClockStart = await f.page.evaluate(() => performance.mark('spn133-clock-start').startTime);\n          await cdp.send('Profiler.enable');",
);
change(
  '        evidence.timingCompleteAt = await now(f.page);',
  "        if (finishTrace) {\n          evidence.traceClockEnd = await f.page.evaluate(() => performance.mark('spn133-clock-end').startTime);\n          evidence.diagnosticTrace = await finishTrace();\n          expect((evidence.diagnosticTrace as { complete: boolean }).complete).toBe(true);\n        }\n        evidence.timingCompleteAt = await now(f.page);",
);
change(
  '        evidence.errors = f.errors;',
  '        if (finishTrace && !evidence.diagnosticTrace) evidence.diagnosticTrace = await finishTrace();\n        evidence.errors = f.errors;',
);
writeFileSync(harness, text);
writeFileSync(
  resolve(root, 'e2e/spn133-trace.ts'),
  readFileSync(new URL('./spn133-trace.ts', import.meta.url)),
);
const files = [
  'e2e/doc-responsiveness.spec.ts',
  'e2e/spn133-trace.ts',
  'e2e/doc-responsiveness.ts',
  'e2e/doc-responsiveness-fixture.ts',
  'src/ui/boundedDocHistory.ts',
  'web/DocEditor.tsx',
  'web/spinelSync.ts',
  'web/docResponsivenessEvidence.ts',
  'scripts/dependencies/patch-univer-docs.ts',
  'scripts/dependencies/patch-univer-core.ts',
  'package-lock.json',
  'playwright.config.ts',
];
writeFileSync(
  resolve(root, 'spn133-diagnostic-identity.json'),
  JSON.stringify(
    {
      source,
      diagnosticOnly: true,
      attemptsPerPreset: 1,
      samples: ['profile'],
      presets: ['desktop', 'mobile'],
      originalHarnessSha256: createHash('sha256').update(original).digest('hex'),
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
  resolve(root, 'spn133-diagnostic-source.patch'),
  execFileSync('git', ['diff', '--', ...files], { cwd: root, encoding: 'utf8' }),
);
