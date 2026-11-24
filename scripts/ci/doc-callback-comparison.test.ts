import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  compareDocCallbackEvidence,
  DOC_CALLBACK_BASELINE,
  loadDocCallbackEvidence,
  verifyDocCallbackFile,
} from './doc-callback-comparison.ts';
import type { DocCallbackManifest, LoadedDocCallbackEvidence } from './doc-callback-comparison.ts';
import { analyzeDocCallbackLifetimes, DOC_CALLBACK_MARKERS } from './doc-callback-lifetimes.ts';
import { docTraceProcessorAuthority } from './doc-trace-processor.ts';
import {
  DOC_CALLBACK_CLEAN_STATS,
  DOC_CALLBACK_STATS_SQL,
} from '../../e2e/doc-responsiveness-callback-converter.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const candidateSource = 'f'.repeat(40);
const text =
  Array.from(
    { length: 16 },
    (_, index) =>
      `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
      'Keep the original page size and all of this text when navigating.',
  ).join('\r') + '\r\n';
const categories = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline.stack',
  'toplevel',
  'v8',
  'blink.user_timing',
  'disabled-by-default-renderer.scheduler',
];
const callsites = (['cursor', 'cursor', 'zoom-init', 'zoom-update'] as const).map(
  (family, index) => ({
    url: 'https://spinel.test/assets/bundle.js',
    lineNumber: 1,
    columnNumber: index,
    family,
  }),
);
const raw = {
  traceEvents: [
    ...Object.entries(DOC_CALLBACK_MARKERS).map(([phase, name], index) => ({
      name,
      cat: 'blink.user_timing',
      ph: 'I',
      pid: 1,
      tid: 2,
      ts: [1000, 10_000, 300_000, 2_000_000, 3_001_000][index],
      args: { data: { phase } },
    })),
    ...callsites.flatMap((site, index) => [
      {
        name: 'TimerInstall',
        ph: 'I',
        pid: 1,
        tid: 2,
        ts: 2000 + index,
        args: {
          data: {
            timerId: index + 1,
            frame: 'frame',
            singleShot: index !== 1,
            timeout: 500,
            stackTrace: [site],
          },
        },
      },
      {
        name: 'TimerRemove',
        ph: 'I',
        pid: 1,
        tid: 2,
        ts: 1_900_000 + index,
        args: { data: { timerId: index + 1, frame: 'frame' } },
      },
    ]),
    { name: 'ThreadControllerImpl::RunTask', ph: 'X', pid: 1, tid: 2, ts: 1000, dur: 1000 },
  ],
};
const rawBytes = gzipSync(JSON.stringify(raw));
// Opaque inner bytes deliberately exercise only provenance/framing at this layer.
// Native known-fixture and application acceptance own converter semantic fidelity.
const proto = Buffer.from([0x0a, 2, 0x08, 1]);
const protoBytes = gzipSync(proto);
const convertedTrace = {
  file: 'spn144-derived.json.gz',
  bytes: rawBytes.length,
  sha256: hash(rawBytes),
  storage: { compression: 'gzip' as const, producer: 'node:zlib' as const, level: 1 },
  decoded: { bytes: Buffer.byteLength(JSON.stringify(raw)), sha256: hash(JSON.stringify(raw)) },
};
function conversionRecord(output = convertedTrace) {
  const input = { bytes: proto.length, sha256: hash(proto) };
  const command = {
    code: 0,
    signal: null,
    stderr: '',
    stdout: '',
    diagnosticsTruncated: false,
    elapsedMs: 1,
    childClosed: true,
    outputRemoved: false,
    outputCloseFailure: null,
  };
  return {
    authority: docTraceProcessorAuthority('linux', 'x64'),
    input,
    framing: { ...input, packets: 1, emptyPackets: 0 },
    output,
    conversion: { ...command, args: ['convert', 'json', '/owned/input.pftrace'] },
    statistics: {
      ...command,
      args: ['query', '--format', 'csv', '/owned/input.pftrace', DOC_CALLBACK_STATS_SQL],
      stdout: DOC_CALLBACK_CLEAN_STATS,
    },
    passed: true,
    temporaryRemoved: true,
  };
}
const receiptBytes = (output = convertedTrace) =>
  Buffer.from(JSON.stringify(conversionRecord(output)));
const receiptArtifact = (bytes: Buffer) => ({
  file: 'spn144-conversion.json',
  bytes: bytes.length,
  sha256: hash(bytes),
});
const sourceFiles = [
  { file: 'bundle.js', content: '/* retained built code */', kind: 'runtime' },
  { file: 'bundle.js.map', content: '{"sourcesContent":["original"]}', kind: 'source-map' },
  { file: 'docs-ui.js', content: 'original', kind: 'docs-ui-source' },
];

function evidence(role: 'baselineObservation' | 'candidate'): LoadedDocCallbackEvidence {
  const analysis = analyzeDocCallbackLifetimes({
    traceEvents: raw.traceEvents,
    role,
    completion: { dataLossOccurred: false },
    frameId: 'frame',
    callsites,
  });
  const manifest: DocCallbackManifest = {
    schema: 2,
    role,
    preset: 'desktop',
    attempt: 0,
    source: role === 'candidate' ? candidateSource : DOC_CALLBACK_BASELINE,
    dirtyPaths: '',
    complete: true,
    passed: true,
    behaviorPassed: true,
    browser: '156.0.8078.4',
    runtime: 'v26.12.1',
    playwright: '1.64.1',
    runner: { run: '123', attempt: '1', name: 'same-runner' },
    harnessSha256: Object.fromEntries(
      [
        'e2e/doc-responsiveness-callbacks.spec.ts',
        'e2e/doc-responsiveness-callback-sources.ts',
        'e2e/doc-responsiveness-callback-trace.ts',
        'e2e/doc-responsiveness-callback-proto.ts',
        'e2e/doc-responsiveness-callback-converter.ts',
        'scripts/ci/doc-trace-processor.ts',
        'e2e/doc-responsiveness-callback-progress.ts',
        'e2e/doc-responsiveness-fixture.ts',
        'e2e/doc-responsiveness.ts',
        'scripts/ci/doc-callback-lifetimes.ts',
        'web/docResponsivenessEvidence.ts',
        'src/ui/docIdleEpisode.ts',
        'src/ui/nativeDocFlush.ts',
        'src/ui/nativeDocFlushDiagnostic.ts',
        'playwright.config.ts',
        'package-lock.json',
      ].map((path) => [path, hash(path)]),
    ),
    fixture: {
      paragraphs: 16,
      typedCharacters: 2071,
      enterKeys: 15,
      nativeKeydowns: 2086,
      nativeTextLength: 2088,
      sha256: hash(text),
      input: 'original native keyboard workload',
    },
    instrumentation: {
      converterAuthority: docTraceProcessorAuthority('linux', 'x64'),
      categories,
      traceConfig: {
        recordMode: 'recordUntilFull',
        traceBufferSizeInKb: 1048576,
        includedCategories: categories,
      },
      transferMode: 'ReturnAsStream',
      streamFormat: 'proto',
      streamCompression: 'none',
      bufferUsageReportingInterval: 1000,
      storage: { compression: 'gzip', producer: 'node:zlib', level: 1 },
      cpuThrottle: 1,
      mountedEditors: 1,
      deviceScaleFactor: 1,
      touch: false,
      viewport: { width: 1440, height: 1000 },
      playwrightTrace: false,
      latencyBudgetsEnforced: false,
    },
    observedKeydowns: 2086,
    textSha256: hash(text),
    frameId: 'frame',
    trace: {
      file: 'spn144-trace.pftrace.gz',
      sha256: hash(protoBytes),
      bytes: protoBytes.length,
      completion: { dataLossOccurred: false, traceFormat: 'proto', streamCompression: 'none' },
      storage: { compression: 'gzip', producer: 'node:zlib', level: 1 },
      transport: {
        bytes: proto.length,
        sha256: hash(proto),
      },
    },
    convertedTrace,
    conversionReceipt: receiptArtifact(receiptBytes()),
    attribution: {
      callsites,
      unmapped: [],
      artifacts: sourceFiles.map(({ file, content, kind }) => ({
        file,
        kind,
        sha256: hash(content),
        bytes: Buffer.byteLength(content),
      })),
    },
    analysis,
    errors: [],
    cleanup: { sessionDetached: true, fixtureClosed: true },
    input: {
      keydownAt: Array.from({ length: 2086 }, (_, index) => index + 1),
      keyToFrameMs: Array(2086).fill(8),
    },
    nativeAfterTyping: {
      text,
      selection: { start: 2086, end: 2086 },
      pending: { history: 0, collaboration: 0 },
    },
  };
  return { manifest: structuredClone(manifest), analysis: structuredClone(analysis), failures: [] };
}

test('accepts matched committed first-attempt observations with bounded candidate cleanup', () => {
  const result = compareDocCallbackEvidence(
    'desktop',
    evidence('baselineObservation'),
    evidence('candidate'),
    candidateSource,
  );
  assert.equal(result.accepted, true, result.failures.join('\n'));
});

test('baseline structural failure stays visible without becoming a candidate waiver', () => {
  const baseline = evidence('baselineObservation');
  baseline.analysis!.bounded = false;
  baseline.analysis!.candidateViolations = ['cursor pending high-water 4002 exceeds 4.'];
  assert.equal(
    compareDocCallbackEvidence('desktop', baseline, evidence('candidate'), candidateSource)
      .accepted,
    true,
  );
  const candidate = evidence('candidate');
  candidate.analysis!.bounded = false;
  assert.equal(
    compareDocCallbackEvidence('desktop', baseline, candidate, candidateSource).accepted,
    false,
  );
});

test('commit, retry, failed checks, browser errors, missing source and unchecked analysis reject the pair', () => {
  const changes: Array<(value: LoadedDocCallbackEvidence) => void> = [
    (value) => {
      value.manifest.source = 'e'.repeat(40);
    },
    (value) => {
      value.manifest.attempt = 1;
    },
    (value) => {
      value.manifest.passed = false;
    },
    (value) => {
      value.manifest.complete = false;
    },
    (value) => {
      value.manifest.behaviorPassed = false;
    },
    (value) => {
      value.manifest.errors.push('native error');
    },
    (value) => {
      value.manifest.attribution.unmapped = undefined as never;
    },
    (value) => {
      value.manifest.trace.completion.dataLossOccurred = true;
    },
    (value) => {
      value.analysis = null;
    },
    (value) => {
      value.analysis!.complete = false;
    },
    (value) => {
      value.failures.push('raw checksum differs');
    },
    (value) => {
      value.manifest.dirtyPaths = 'M web/docResponsivenessEvidence.ts';
    },
  ];
  for (const change of changes) {
    const candidate = evidence('candidate');
    change(candidate);
    assert.equal(
      compareDocCallbackEvidence(
        'desktop',
        evidence('baselineObservation'),
        candidate,
        candidateSource,
      ).accepted,
      false,
    );
  }
});

test('discloses unrelated unmapped function positions while requiring proven measured timer ownership', () => {
  const candidate = evidence('candidate');
  candidate.manifest.attribution.unmapped.push({
    kind: 'FunctionCall',
    url: '__playwright_utility_script__',
  });
  const result = compareDocCallbackEvidence(
    'desktop',
    evidence('baselineObservation'),
    candidate,
    candidateSource,
  );
  assert.equal(result.accepted, true);
  assert.equal(result.candidate.unmappedSourcePositions, 1);
  candidate.analysis!.complete = false;
  assert.equal(
    compareDocCallbackEvidence(
      'desktop',
      evidence('baselineObservation'),
      candidate,
      candidateSource,
    ).accepted,
    false,
  );
});

test('matching capture omissions or changes cannot replace the registered lossless method', () => {
  const changes: Array<(value: LoadedDocCallbackEvidence) => void> = [
    (value) => {
      delete value.manifest.instrumentation.streamCompression;
    },
    (value) => {
      value.manifest.instrumentation.traceConfig = {
        ...(value.manifest.instrumentation.traceConfig as Record<string, unknown>),
        recordMode: 'recordContinuously',
      };
    },
    (value) => {
      value.manifest.instrumentation.traceConfig = {
        ...(value.manifest.instrumentation.traceConfig as Record<string, unknown>),
        traceBufferSizeInKb: 204800,
      };
    },
    (value) => {
      value.manifest.instrumentation.categories = ['devtools.timeline'];
    },
    (value) => {
      value.manifest.instrumentation.bufferUsageReportingInterval = 0;
    },
    (value) => {
      value.manifest.trace.completion.streamCompression = 'gzip';
    },
    (value) => {
      value.manifest.trace.storage.level = 9;
    },
    (value) => {
      value.manifest.cleanup.fixtureClosed = false;
    },
    (value) => {
      value.manifest.cleanup.sessionDetached = false;
    },
    (value) => {
      value.manifest.trace.transport.sha256 = '';
    },
    (value) => {
      delete value.manifest.instrumentation.storage;
    },
    (value) => {
      delete value.manifest.harnessSha256['e2e/doc-responsiveness-callback-trace.ts'];
    },
  ];
  for (const change of changes) {
    const baseline = evidence('baselineObservation');
    const candidate = evidence('candidate');
    change(baseline);
    change(candidate);
    assert.equal(
      compareDocCallbackEvidence('desktop', baseline, candidate, candidateSource).accepted,
      false,
    );
  }
});

test('requires paired runtime, runner, harness and fixture identities, not merely two passing flags', () => {
  const changes: Array<(value: DocCallbackManifest) => void> = [
    (value) => {
      value.browser = 'different';
    },
    (value) => {
      value.runtime = 'different';
    },
    (value) => {
      value.playwright = 'different';
    },
    (value) => {
      value.runner.run = 'other';
    },
    (value) => {
      value.runner.attempt = '2';
    },
    (value) => {
      value.harnessSha256['web/docResponsivenessEvidence.ts'] = 'a'.repeat(64);
    },
    (value) => {
      value.fixture.input = 'bulk insert';
    },
    (value) => {
      value.instrumentation.profiler = true;
    },
  ];
  for (const change of changes) {
    const candidate = evidence('candidate');
    change(candidate.manifest);
    const result = compareDocCallbackEvidence(
      'desktop',
      evidence('baselineObservation'),
      candidate,
      candidateSource,
    );
    assert.equal(result.accepted, false);
    assert.match(result.failures.join('\n'), /Paired/);
  }
});

test('matching omissions or shortened/corrupt input do not satisfy the original workload', () => {
  const changes: Array<(value: DocCallbackManifest) => void> = [
    (value) => {
      delete value.harnessSha256['web/docResponsivenessEvidence.ts'];
    },
    (value) => {
      value.fixture.typedCharacters = 1;
    },
    (value) => {
      value.observedKeydowns--;
    },
    (value) => {
      value.input.keydownAt.pop();
    },
    (value) => {
      value.input.keyToFrameMs[1] = NaN;
    },
    (value) => {
      value.nativeAfterTyping.text = 'changed';
      value.textSha256 = hash('changed');
    },
    (value) => {
      value.nativeAfterTyping.selection.end = 0;
    },
    (value) => {
      value.nativeAfterTyping.pending.history = 1;
    },
    (value) => {
      value.instrumentation.cpuThrottle = 8;
    },
  ];
  for (const change of changes) {
    const baseline = evidence('baselineObservation');
    const candidate = evidence('candidate');
    change(baseline.manifest);
    change(candidate.manifest);
    assert.equal(
      compareDocCallbackEvidence('desktop', baseline, candidate, candidateSource).accepted,
      false,
    );
  }
});

test('allows only controlled matched baseline harness copies, including trimmed porcelain output', () => {
  const baseline = evidence('baselineObservation');
  baseline.manifest.dirtyPaths =
    'M web/docResponsivenessEvidence.ts\n?? scripts/ci/doc-callback-lifetimes.ts';
  assert.equal(
    compareDocCallbackEvidence('desktop', baseline, evidence('candidate'), candidateSource)
      .accepted,
    true,
  );
  for (const dirty of [
    'M server/index.ts',
    'M web/DocEditor.tsx',
    ' M web/DocEditor.tsx',
    'D web/docResponsivenessEvidence.ts',
    '?? unreviewed.ts',
    'M e2e/doc-responsiveness.spec.ts',
  ]) {
    baseline.manifest.dirtyPaths = dirty;
    assert.equal(
      compareDocCallbackEvidence('desktop', baseline, evidence('candidate'), candidateSource)
        .accepted,
      false,
    );
  }
});

test('CI pins the declared baseline and overlays only the matched callback harness', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const checkout = workflow
    .split('      - name: Immutable merged SPN-108 baseline\n')[1]
    ?.split('      - name:')[0];
  assert.equal(checkout?.match(/^          ref: ([a-f0-9]{40})$/m)?.[1], DOC_CALLBACK_BASELINE);
  const overlay = workflow
    .split('      - name: Match callback workload and read-only observations\n')[1]
    ?.split('      - name:')[0];
  assert.ok(overlay, 'The callback baseline overlay must be present.');
  const copied = [
    ...overlay.matchAll(/^          cp (.+) baseline-callback-source\/.*$/gm),
  ].flatMap((match) => match[1]!.split(' '));
  const baseline = evidence('baselineObservation');
  // Matching hashes cannot justify changing a file outside the measured harness.
  assert.deepEqual(copied.toSorted(), Object.keys(baseline.manifest.harnessSha256).toSorted());
  baseline.manifest.dirtyPaths = copied.map((path) => ` M ${path}`).join('\n');
  assert.equal(
    compareDocCallbackEvidence('desktop', baseline, evidence('candidate'), candidateSource)
      .accepted,
    true,
  );
});

async function temporary(t: { after: (callback: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-callback-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function retain(directory: string) {
  const value = evidence('candidate');
  await writeFile(join(directory, value.manifest.trace.file), protoBytes);
  await writeFile(join(directory, value.manifest.convertedTrace.file), rawBytes);
  await writeFile(join(directory, value.manifest.conversionReceipt.file), receiptBytes());
  for (const source of sourceFiles) await writeFile(join(directory, source.file), source.content);
  await writeFile(
    join(directory, 'spn134-progress.json'),
    JSON.stringify({
      schema: 1,
      terminal: 'passed',
      firstFailure: null,
      persistenceFailure: null,
      events: [{ phase: 'fixture-cleanup-complete' }],
    }),
  );
  await writeFile(join(directory, 'spn113-evidence.json'), JSON.stringify(value.manifest));
  return value.manifest;
}

test('loads exactly one case, hashes retained trace/maps/sources and recomputes the callback ledger', async (t) => {
  const directory = await temporary(t);
  await retain(directory);
  const loaded = await loadDocCallbackEvidence(directory);
  assert.deepEqual(loaded.failures, []);
  assert.equal(loaded.analysis?.accepted, true);
  await mkdir(join(directory, 'retry'));
  await writeFile(
    join(directory, 'retry/spn113-evidence.json'),
    await readFile(join(directory, 'spn113-evidence.json')),
  );
  await assert.rejects(loadDocCallbackEvidence(directory), /exactly one first-attempt/);
});

test('a changed retained build, missing file or incorrect byte count cannot borrow a valid manifest', async (t) => {
  const directory = await temporary(t);
  const manifest = await retain(directory);
  await writeFile(
    join(directory, sourceFiles[0]!.file),
    'x'.repeat(sourceFiles[0]!.content.length),
  );
  assert.match((await loadDocCallbackEvidence(directory)).failures.join('\n'), /checksum differs/);
  await retain(directory);
  manifest.trace.bytes++;
  await writeFile(join(directory, 'spn113-evidence.json'), JSON.stringify(manifest));
  assert.match(
    (await loadDocCallbackEvidence(directory)).failures.join('\n'),
    /byte length differs/,
  );
  await retain(directory);
  await rm(join(directory, sourceFiles[1]!.file));
  assert.ok((await loadDocCallbackEvidence(directory)).failures.length);
});

test('stored accepted analysis is checked against raw lifetimes, even when the raw checksum is updated', async (t) => {
  const directory = await temporary(t);
  const manifest = await retain(directory);
  const altered = structuredClone(raw);
  altered.traceEvents = altered.traceEvents.filter((event) => {
    const value = event as { name: string; args?: { data?: { timerId?: number } } };
    return !(value.name === 'TimerRemove' && value.args?.data?.timerId === 1);
  });
  const bytes = gzipSync(JSON.stringify(altered));
  await writeFile(join(directory, manifest.convertedTrace.file), bytes);
  manifest.convertedTrace.sha256 = hash(bytes);
  manifest.convertedTrace.bytes = Buffer.byteLength(bytes);
  manifest.convertedTrace.decoded = {
    bytes: Buffer.byteLength(JSON.stringify(altered)),
    sha256: hash(JSON.stringify(altered)),
  };
  const receipt = receiptBytes(manifest.convertedTrace);
  manifest.conversionReceipt = receiptArtifact(receipt);
  await writeFile(join(directory, manifest.conversionReceipt.file), receipt);
  await writeFile(join(directory, 'spn113-evidence.json'), JSON.stringify(manifest));
  const loaded = await loadDocCallbackEvidence(directory);
  assert.equal(loaded.analysis?.accepted, false);
  assert.match(loaded.failures.join('\n'), /differs from recomputation/);
});

test('artifact resolution rejects traversal and symlinks escaping the retained case', async (t) => {
  const directory = await temporary(t);
  const content = 'outside';
  await writeFile(join(directory, 'outside.js'), content);
  const caseDirectory = join(directory, 'case');
  await mkdir(caseDirectory);
  const artifact = {
    file: '../outside.js',
    bytes: Buffer.byteLength(content),
    sha256: hash(content),
  };
  await assert.rejects(verifyDocCallbackFile(caseDirectory, artifact), /escapes its case/);
  await symlink(join(directory, 'outside.js'), join(caseDirectory, 'link.js'));
  await assert.rejects(
    verifyDocCallbackFile(caseDirectory, { ...artifact, file: 'link.js' }),
    /escapes its case/,
  );
});

test('candidate-only callback evidence retains first-attempt/source/content/bounded-lifetime checks', () => {
  const result = compareDocCallbackEvidence(
    'desktop',
    null,
    evidence('candidate'),
    candidateSource,
  );
  assert.equal(result.mode, 'candidate-only');
  assert.equal(result.baseline, null);
  assert.equal(result.accepted, true, JSON.stringify(result));
  for (const mutate of [
    (value: LoadedDocCallbackEvidence) => {
      value.manifest.source = 'e'.repeat(40);
    },
    (value: LoadedDocCallbackEvidence) => {
      value.manifest.attempt = 1;
    },
    (value: LoadedDocCallbackEvidence) => {
      value.manifest.textSha256 = '0'.repeat(64);
    },
    (value: LoadedDocCallbackEvidence) => {
      value.manifest.behaviorPassed = false;
    },
    (value: LoadedDocCallbackEvidence) => {
      value.analysis!.accepted = false;
    },
    (value: LoadedDocCallbackEvidence) => {
      value.failures.push('Missing retained raw trace');
    },
  ]) {
    const candidate = evidence('candidate');
    mutate(candidate);
    assert.equal(
      compareDocCallbackEvidence('desktop', null, candidate, candidateSource).accepted,
      false,
    );
  }
});

test('stored gzip provenance and decoded transport identity cannot be borrowed or omitted', async (t) => {
  const directory = await temporary(t);
  for (const change of [
    (manifest: DocCallbackManifest) => {
      manifest.trace.transport.sha256 = '0'.repeat(64);
    },
    (manifest: DocCallbackManifest) => {
      manifest.trace.transport.bytes++;
    },
    (manifest: DocCallbackManifest) => {
      manifest.trace.storage.level = 9;
    },
    (manifest: DocCallbackManifest) => {
      manifest.trace.completion.streamCompression = 'gzip';
    },
  ]) {
    const manifest = await retain(directory);
    change(manifest);
    await writeFile(join(directory, 'spn113-evidence.json'), JSON.stringify(manifest));
    const loaded = await loadDocCallbackEvidence(directory);
    assert.ok(loaded.failures.length);
    assert.equal(
      compareDocCallbackEvidence(
        'desktop',
        evidence('baselineObservation'),
        loaded,
        candidateSource,
      ).accepted,
      false,
    );
  }
});

test('a stale passing manifest cannot override missing, timed-out or failed terminal progress', async (t) => {
  const directory = await temporary(t);
  for (const terminal of [undefined, 'timedOut', 'failed']) {
    await retain(directory);
    if (terminal === undefined) await rm(join(directory, 'spn134-progress.json'));
    else
      await writeFile(
        join(directory, 'spn134-progress.json'),
        JSON.stringify({
          schema: 1,
          terminal,
          firstFailure: { kind: terminal },
          persistenceFailure: null,
          events: [{ phase: 'fixture-cleanup-complete' }],
        }),
      );
    const loaded = await loadDocCallbackEvidence(directory);
    assert.equal(loaded.manifest.passed, true);
    assert.ok(loaded.failures.length);
    assert.equal(
      compareDocCallbackEvidence(
        'desktop',
        evidence('baselineObservation'),
        loaded,
        candidateSource,
      ).accepted,
      false,
    );
  }
});

test('missing or modified conversion authority, statistics and cleanup cannot borrow passing analysis', async (t) => {
  const directory = await temporary(t);
  for (const mutate of [
    (record: ReturnType<typeof conversionRecord>) => {
      record.authority.sha256 = '0'.repeat(64) as typeof record.authority.sha256;
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.input.sha256 = '0'.repeat(64);
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.framing.packets++;
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.output.sha256 = '0'.repeat(64);
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.passed = false;
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.temporaryRemoved = false;
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.statistics.args[3] = '/different/input.pftrace';
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.statistics.stdout = '';
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.statistics.stdout += '"lost","data_loss",1\n';
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.statistics.stdout = 'name,severity,value\n';
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.statistics.code = 1;
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.conversion.childClosed = false;
    },
    (record: ReturnType<typeof conversionRecord>) => {
      record.conversion.diagnosticsTruncated = true;
    },
    (record: ReturnType<typeof conversionRecord>) => {
      Object.assign(record, { inputCloseFailure: 'late close failed' });
    },
    (record: ReturnType<typeof conversionRecord>) => {
      Object.assign(record.conversion, { outputCloseFailure: 'late output close failed' });
    },
  ]) {
    const manifest = await retain(directory);
    const record = conversionRecord(structuredClone(manifest.convertedTrace));
    mutate(record);
    const bytes = Buffer.from(JSON.stringify(record));
    manifest.conversionReceipt = receiptArtifact(bytes);
    await writeFile(join(directory, manifest.conversionReceipt.file), bytes);
    await writeFile(join(directory, 'spn113-evidence.json'), JSON.stringify(manifest));
    const loaded = await loadDocCallbackEvidence(directory);
    assert.ok(loaded.failures.length, JSON.stringify(record));
    assert.equal(
      compareDocCallbackEvidence('desktop', null, loaded, candidateSource).accepted,
      false,
    );
  }
  const manifest = await retain(directory);
  await rm(join(directory, manifest.conversionReceipt.file));
  assert.ok((await loadDocCallbackEvidence(directory)).failures.length);
});

test('complete-looking raw protobuf truncation cannot be hidden by updating its stored checksum', async (t) => {
  const directory = await temporary(t),
    manifest = await retain(directory);
  const truncated = gzipSync(proto.subarray(0, proto.length - 1));
  await writeFile(join(directory, manifest.trace.file), truncated);
  manifest.trace.bytes = truncated.length;
  manifest.trace.sha256 = hash(truncated);
  await writeFile(join(directory, 'spn113-evidence.json'), JSON.stringify(manifest));
  const loaded = await loadDocCallbackEvidence(directory);
  assert.match(loaded.failures.join('\n'), /Truncated/);
  assert.equal(
    compareDocCallbackEvidence('desktop', null, loaded, candidateSource).accepted,
    false,
  );
});

test('individually supported converter artifacts still must match across the pair', async (t) => {
  const directory = await temporary(t),
    manifest = await retain(directory);
  const record = conversionRecord();
  record.authority = docTraceProcessorAuthority('darwin', 'arm64');
  const bytes = Buffer.from(JSON.stringify(record));
  manifest.conversionReceipt = receiptArtifact(bytes);
  await writeFile(join(directory, manifest.conversionReceipt.file), bytes);
  // A valid alternative binary cannot silently replace the declared instrument.
  await writeFile(join(directory, 'spn113-evidence.json'), JSON.stringify(manifest));
  assert.match((await loadDocCallbackEvidence(directory)).failures.join('\n'), /authority/);
  manifest.instrumentation.converterAuthority = record.authority;
  await writeFile(join(directory, 'spn113-evidence.json'), JSON.stringify(manifest));
  const candidate = await loadDocCallbackEvidence(directory);
  assert.deepEqual(candidate.failures, []);
  const baseline = evidence('baselineObservation');
  assert.match(
    compareDocCallbackEvidence('desktop', baseline, candidate, candidateSource).failures.join('\n'),
    /Paired instrumentation differs/,
  );
  baseline.manifest.instrumentation.converterAuthority = record.authority;
  assert.equal(
    compareDocCallbackEvidence('desktop', baseline, candidate, candidateSource).accepted,
    true,
  );
});
