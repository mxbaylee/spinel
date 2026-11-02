import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareDocsPatch } from '../dependencies/patch-univer-docs.ts';

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
  "        if (finishTrace) {\n          evidence.traceClockEnd = await f.page.evaluate(() => performance.mark('spn133-clock-end').startTime);\n          evidence.diagnosticTrace = await finishTrace();\n        }\n        evidence.timingCompleteAt = await now(f.page);",
);
change(
  '        evidence.completed = true;',
  '        expect((evidence.diagnosticTrace as { complete: boolean }).complete).toBe(true);\n        evidence.completed = true;',
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
const nativeInstrumentation: unknown[] = [];
for (const format of ['es', 'cjs'] as const) {
  const file = `node_modules/@univerjs/docs/lib/${format}/index.js`;
  const installed = readFileSync(resolve(root, file), 'utf8');
  if (prepareDocsPatch(installed, format).patched !== installed)
    throw new Error('Expected fully patched pinned Docs runtime');
  let instrumented = installed;
  for (const [method, alias, phase] of [
    ['_pushHistory', '_spn133PushHistory', 'history'],
    ['_emitChangeState', '_spn133EmitChangeState', 'collaboration'],
  ]) {
    const before = `\t${method}(unitId) {`;
    if (instrumented.split(before).length !== 2)
      throw new Error('Expected exactly one native method ' + method);
    const after = `\t${method}(unitId) {
\t\tconst start = performance.now();
\t\ttry { return this.${alias}(unitId); }
\t\tfinally { performance.measure("spn133-native-${phase}", { start, end: performance.now() }); }
\t}
\t${alias}(unitId) {`;
    instrumented = instrumented.replace(before, after);
    nativeInstrumentation.push({ file, before, after });
  }
  writeFileSync(resolve(root, file), instrumented);
}
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
  'node_modules/@univerjs/docs/lib/es/index.js',
  'node_modules/@univerjs/docs/lib/cjs/index.js',
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
      traceCategories: '-*,blink.user_timing,disabled-by-default-v8.gc',
      nativeInstrumentation,
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
