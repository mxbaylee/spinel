import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  compareDocCallbackEvidence,
  DOC_CALLBACK_BASELINE,
  loadDocCallbackEvidence,
  verifyDocCallbackFile,
} from './doc-callback-comparison.ts';
import type { DocCallbackManifest, LoadedDocCallbackEvidence } from './doc-callback-comparison.ts';
import { analyzeDocCallbackLifetimes, DOC_CALLBACK_MARKERS } from './doc-callback-lifetimes.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const candidateSource = 'f'.repeat(40);
const text =
  Array.from(
    { length: 16 },
    (_, index) =>
      `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
      'Keep the original page size and all of this text when navigating.',
  ).join('\r') + '\r\n';
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
            timerId: index,
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
        args: { data: { timerId: index, frame: 'frame' } },
      },
    ]),
    { name: 'ThreadControllerImpl::RunTask', ph: 'X', pid: 1, tid: 2, ts: 1000, dur: 1000 },
  ],
};
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
    schema: 1,
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
        'e2e/doc-responsiveness-fixture.ts',
        'e2e/doc-responsiveness.ts',
        'scripts/ci/doc-callback-lifetimes.ts',
        'web/docResponsivenessEvidence.ts',
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
      file: 'spn113-trace.json',
      sha256: hash(JSON.stringify(raw)),
      bytes: Buffer.byteLength(JSON.stringify(raw)),
      completion: { dataLossOccurred: false },
    },
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
  ]) {
    baseline.manifest.dirtyPaths = dirty;
    assert.equal(
      compareDocCallbackEvidence('desktop', baseline, evidence('candidate'), candidateSource)
        .accepted,
      false,
    );
  }
});

async function temporary(t: { after: (callback: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-callback-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function retain(directory: string) {
  const value = evidence('candidate');
  await writeFile(join(directory, 'spn113-trace.json'), JSON.stringify(raw));
  for (const source of sourceFiles) await writeFile(join(directory, source.file), source.content);
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
  const bytes = JSON.stringify(altered);
  await writeFile(join(directory, manifest.trace.file), bytes);
  manifest.trace.sha256 = hash(bytes);
  manifest.trace.bytes = Buffer.byteLength(bytes);
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
