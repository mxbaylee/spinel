import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { instrumentNativePhases, policyOriginSource } from './spn135-native-phases.ts';

const root = resolve(process.argv[2] ?? 'runtime-source');
const expected = 'dbbe5ccaf085ce20b79068d3596a35dcf2142223';
const { prepareDocsPatch } = await import(
  pathToFileURL(resolve(root, 'scripts/dependencies/patch-univer-docs.ts')).href
);
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
  "import { readFile, writeFile } from 'node:fs/promises';\nimport { startDiagnosticTrace } from './spn135-trace.ts';",
);
change(
  '      let profiling = false;',
  '      let profiling = false;\n      let finishTrace: Awaited<ReturnType<typeof startDiagnosticTrace>> | undefined;',
);
change(
  '      let profilerClock: ProfilerClockBracket | undefined;',
  `      let profilerClock: ProfilerClockBracket | undefined;
      let nativeDiagnostic: Record<string, unknown> | undefined;
      const retainNativeDiagnostic = async () => {
        if (nativeDiagnostic) return nativeDiagnostic;
        const capture = await f.page.evaluate(() => {
          const value = globalThis as unknown as Record<string, unknown>;
          return { native: value.__spn135Native ?? [], phaseError: value.__spn135PhaseError ?? null,
            captureError: value.__spn135CaptureError ?? null };
        }).catch(error => ({ collectionError: String(error) }));
        const bytes = JSON.stringify(capture);
        await writeFile(info.outputPath('spn135-native-idle.json'), bytes);
        nativeDiagnostic = { ...capture, sha256: createHash('sha256').update(bytes).digest('hex') };
        evidence.nativeDiagnostic = nativeDiagnostic;
        return nativeDiagnostic;
      };`,
);
change(
  "role: baseline ? 'baseline-observation' : 'candidate',",
  "role: 'diagnostic-only',\n        diagnostic: 'SPN-135 one desktop profile; never acceptance',",
);
change(
  '          profiler: profiled,',
  '          profiler: profiled,\n          browserTrace: profiled,',
);
change(
  "          await cdp.send('Profiler.enable');",
  "          finishTrace = await startDiagnosticTrace(cdp, info.outputPath('spn135-trace.json'));\n          evidence.traceClockStart = await f.page.evaluate(() => performance.mark('spn135-clock-start').startTime);\n          await cdp.send('Profiler.enable');",
);
change(
  '        evidence.timingCompleteAt = await now(f.page);',
  "        if (finishTrace) {\n          evidence.traceClockEnd = await f.page.evaluate(() => performance.mark('spn135-clock-end').startTime);\n          evidence.diagnosticTrace = await finishTrace();\n        }\n        await retainNativeDiagnostic();\n        evidence.timingCompleteAt = await now(f.page);",
);
change(
  '        evidence.completed = true;',
  `        expect((evidence.diagnosticTrace as { complete: boolean }).complete).toBe(true);
        const captured = await retainNativeDiagnostic();
        expect(captured.collectionError).toBeUndefined();
        expect(captured.phaseError).toBeNull();
        expect(captured.captureError).toBeNull();
        expect((captured.native as { cache: unknown }[]).filter(entry => entry.cache !== null).length).toBeGreaterThan(0);
        evidence.completed = true;`,
);
change(
  '        evidence.errors = f.errors;',
  `        if (finishTrace && !evidence.diagnosticTrace) evidence.diagnosticTrace = await finishTrace();
        try { await retainNativeDiagnostic(); }
        catch (error) { evidence.nativeDiagnosticRetentionError = String(error); }
        evidence.errors = f.errors;`,
);
writeFileSync(harness, text);
const policy = resolve(root, 'src/ui/boundedDocHistory.ts');
const policySource = readFileSync(policy, 'utf8');
const policyAnchor = '      manager.flushPendingChanges(unitId);';
if (policySource.split(policyAnchor).length !== 2) throw new Error('Ambiguous idle capture anchor');
writeFileSync(policy, policySource.replace(policyAnchor, policyOriginSource));
const controls = resolve(root, 'src/ui/boundedDocHistory.test.ts');
let controlSource = readFileSync(controls, 'utf8');
function changeControl(before: string, after: string) {
  if (controlSource.split(before).length !== 2)
    throw new Error('Ambiguous native race control anchor');
  controlSource = controlSource.replace(before, after);
}
changeControl(
  'afterEach(() => {',
  `function assertNativeCapture(count: number, origins: string[]) {
  const records = (globalThis as unknown as { __spn135Native: {
    unitId: string; phase: string; origin: string; count: number;
    cache: { kind: string; entries: [string, { value?: number }][] };
  }[] }).__spn135Native;
  expect(records.map(({ unitId, phase, origin, count }) => ({ unitId, phase, origin, count }))).toEqual([
    { unitId: 'doc', phase: 'history', origin: origins[0], count },
    { unitId: 'doc', phase: 'collaboration', origin: origins[1], count },
  ]);
  for (const record of records) {
    expect(record.cache.kind).toBe('array');
    expect(record.cache.entries.find(([key]) => key === 'length')?.[1].value).toBe(count);
  }
}
afterEach(() => {
  const diagnostic = globalThis as unknown as Record<string, unknown>;
  for (const key of ['__spn135Native', '__spn135NativeBytes', '__spn135CaptureError', '__spn135PhaseError']) delete diagnostic[key];`,
);
changeControl(
  '    // The original SDK timeouts can still run later without duplicating history.',
  "    assertNativeCapture(9, ['policy-idle', 'policy-idle']);\n    // The original SDK timeouts can still run later without duplicating history.",
);
changeControl(
  '    // The original SDK timeouts can still run later without duplicating history.\n    await vi.advanceTimersByTimeAsync(350);',
  "    // The original SDK timeouts can still run later without duplicating history.\n    await vi.advanceTimersByTimeAsync(350);\n    assertNativeCapture(9, ['policy-idle', 'policy-idle']);",
);
changeControl(
  "    expect(f.observations).toEqual([]);\n    expect(f.frames.size).toBe(0);\n    expect(f.manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });",
  "    expect(f.observations).toEqual([]);\n    expect(f.frames.size).toBe(0);\n    expect(f.manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });\n    assertNativeCapture(12, ['history-timer', 'collaboration-timer']);",
);
writeFileSync(controls, controlSource);
writeFileSync(
  resolve(root, 'e2e/spn135-trace.ts'),
  readFileSync(new URL('./spn135-trace.ts', import.meta.url)),
);
const nativeInstrumentation: unknown[] = [];
for (const format of ['es', 'cjs'] as const) {
  const file = `node_modules/@univerjs/docs/lib/${format}/index.js`;
  const installed = readFileSync(resolve(root, file), 'utf8');
  if (prepareDocsPatch(installed, format).patched !== installed)
    throw new Error('Expected fully patched pinned Docs runtime');
  const instrumented = instrumentNativePhases(installed);
  nativeInstrumentation.push({
    file,
    beforeSha256: createHash('sha256').update(installed).digest('hex'),
    afterSha256: createHash('sha256').update(instrumented).digest('hex'),
  });
  writeFileSync(resolve(root, file), instrumented);
}
const files = [
  'e2e/doc-responsiveness.spec.ts',
  'e2e/spn135-trace.ts',
  'e2e/doc-responsiveness.ts',
  'e2e/doc-responsiveness-fixture.ts',
  'src/ui/boundedDocHistory.ts',
  'src/ui/boundedDocHistory.test.ts',
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
  resolve(root, 'spn135-diagnostic-identity.json'),
  JSON.stringify(
    {
      source,
      diagnosticOnly: true,
      attemptsPerPreset: 1,
      samples: ['profile'],
      presets: ['desktop'],
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
  resolve(root, 'spn135-diagnostic-source.patch'),
  execFileSync('git', ['diff', '--', ...files], { cwd: root, encoding: 'utf8' }),
);
