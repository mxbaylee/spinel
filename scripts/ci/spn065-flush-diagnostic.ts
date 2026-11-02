import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Temporary SPN-065 diagnostic only. Never substitutes for unprofiled acceptance.
const [directory, variant] = process.argv.slice(2);
if (!directory || !['main', 'candidate', 'repaired'].includes(variant ?? ''))
  throw new Error('Expected directory and main/candidate/repaired.');
const root = resolve(directory);
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const expected =
  variant === 'main'
    ? '0bdbbcb5ca23b84e172e41a11bd0cf555e911130'
    : 'c3636afe3f21216805af80de0dabe129a92d57c6';
if (source !== expected) throw new Error(`Unexpected source ${source}`);
function change(file: string, before: string, after: string) {
  const path = resolve(root, file);
  const text = readFileSync(path, 'utf8');
  if (text.split(before).length !== 2) throw new Error(`Expected one match in ${file}: ${before}`);
  writeFileSync(path, text.replace(before, after));
}
if (variant === 'repaired') {
  change(
    'web/DocEditor.tsx',
    '      lastConnection = state;\n      publish(lastState);',
    '      const connectionChanged = state !== lastConnection;\n      lastConnection = state;\n      if (connectionChanged) publish(lastState);',
  );
  change(
    'web/SheetEditor.tsx',
    '        lastConnection = state;\n        publish(lastState);',
    '        const connectionChanged = state !== lastConnection;\n        lastConnection = state;\n        if (connectionChanged) publish(lastState);',
  );
}
const diagnostic = `(globalThis as unknown as { __spn065Publication?: { publish: number; connection: number; flushes: unknown[] } })`;
for (const name of ['publish', 'connection']) {
  const signature =
    name === 'publish'
      ? '    const publish = (state: SaveState) => {'
      : '    const publishConnection = (state: ConnectionState) => {';
  change(
    'web/DocEditor.tsx',
    signature,
    `${signature}\n      (${diagnostic}.__spn065Publication ??= { publish: 0, connection: 0, flushes: [] }).${name}++;`,
  );
}
change(
  'src/ui/boundedDocHistory.ts',
  '    const startedAt = performance.now();',
  `    const diagnostic = ${diagnostic}.__spn065Publication;\n    const beforePublish = diagnostic?.publish ?? 0;\n    const beforeConnection = diagnostic?.connection ?? 0;\n    const startedAt = performance.now();`,
);
change(
  'src/ui/boundedDocHistory.ts',
  '    try {\n      observe?.({',
  `    const completedAt = performance.now();\n    performance.measure('spn065-flush-' + reason, { start: startedAt, end: completedAt });\n    diagnostic?.flushes.push({ reason, startedAt, completedAt, history, collaboration, publish: diagnostic.publish - beforePublish, connection: diagnostic.connection - beforeConnection });\n    try {\n      observe?.({`,
);
change(
  'src/ui/boundedDocHistory.ts',
  'durationMs: performance.now() - startedAt,',
  'durationMs: completedAt - startedAt,',
);
const harness = 'e2e/doc-responsiveness.spec.ts';
change(
  harness,
  "import { readFile, writeFile } from 'node:fs/promises';",
  "import { readFile, writeFile } from 'node:fs/promises';\nimport { bounded, retainDiagnosticTrace } from './spn065-trace.ts';",
);
change(
  harness,
  "        profiled = sample === 'profile';",
  "        profiled = sample === 'profile';\n      const diagnostic = true;\n      let tracing = false;",
);
change(
  harness,
  "role: baseline ? 'baseline-observation' : 'candidate',",
  "role: 'diagnostic-only',\n        diagnostic: 'SPN-065 matched main/candidate/repaired; no acceptance claim',",
);
change(
  harness,
  '          profiler: profiled,',
  '          profiler: true,\n          browserTrace: true,',
);
change(
  harness,
  '        if (profiled) {',
  `        if (profiled || diagnostic) {\n          await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.gc', transferMode: 'ReturnAsStream' });\n          tracing = true;`,
);
writeFileSync(
  resolve(root, 'e2e/spn065-trace.ts'),
  readFileSync(new URL('./spn065-trace.ts', import.meta.url)),
);
change(
  harness,
  '      } finally {\n        if (finishInput)',
  '      } finally {\n        let traceFailure: unknown;\n        try {\n        if (finishInput)',
);
change(
  harness,
  '        evidence.errors = f.errors;',
  `        if (tracing) {\n          try { evidence.diagnosticTraceBytes = await retainDiagnosticTrace(cdp, info.outputPath('spn065-browser-trace.json')); }\n          catch (error) { traceFailure = error; evidence.diagnosticTraceError = String(error); }\n        }\n        evidence.publicationDiagnostic = await bounded(f.page.evaluate(() => ${diagnostic}.__spn065Publication), 5_000, 'Publication observation').catch((error) => { traceFailure ??= error; return { error: String(error) }; });\n        evidence.errors = f.errors;`,
);
change(
  harness,
  '        await cdp.detach().catch(() => {});\n        await f.close();\n      }\n    });',
  "        } finally {\n          await bounded(cdp.detach(), 5_000, 'CDP cleanup').catch(() => {});\n          await f.close();\n        }\n        if (traceFailure) throw traceFailure;\n      }\n    });",
);
const files = [
  'web/DocEditor.tsx',
  'web/SheetEditor.tsx',
  'src/ui/boundedDocHistory.ts',
  harness,
  'e2e/spn065-trace.ts',
  'e2e/doc-responsiveness.ts',
  'e2e/doc-responsiveness-fixture.ts',
  'web/docResponsivenessEvidence.ts',
  'playwright.config.ts',
  'package-lock.json',
];
writeFileSync(
  resolve(root, 'spn065-diagnostic-identity.json'),
  JSON.stringify(
    {
      variant,
      source,
      expected,
      diagnosticOnly: true,
      attempts: 1,
      selection: 'e2e/doc-responsiveness.spec.ts; desktop sustained native typing plain-1$',
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
  resolve(root, 'spn065-diagnostic-source.patch'),
  execFileSync('git', ['diff', '--', ...files], { cwd: root, encoding: 'utf8' }),
);
