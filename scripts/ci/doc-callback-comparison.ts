import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { glob, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { analyzeDocCallbackLifetimes } from './doc-callback-lifetimes.ts';
import type { DocCallbackCallsite } from './doc-callback-lifetimes.ts';

type Preset = 'desktop' | 'mobile';
type Analysis = ReturnType<typeof analyzeDocCallbackLifetimes>;
export const DOC_CALLBACK_BASELINE = '0e1df4725d9eccb77574d25e3eecdf678fe6ff44';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const validHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const expectedText =
  Array.from(
    { length: 16 },
    (_, index) =>
      `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
      'Keep the original page size and all of this text when navigating.',
  ).join('\r') + '\r\n';
const harnessPaths = [
  'e2e/doc-responsiveness-callbacks.spec.ts',
  'e2e/doc-responsiveness-callback-sources.ts',
  'e2e/doc-responsiveness-fixture.ts',
  'e2e/doc-responsiveness.ts',
  'scripts/ci/doc-callback-lifetimes.ts',
  'web/docResponsivenessEvidence.ts',
  'web/DocEditor.tsx',
  'playwright.config.ts',
  'package-lock.json',
];

export interface DocCallbackArtifactFile {
  file: string;
  sha256: string;
  bytes: number;
  kind?: string;
}

export interface DocCallbackManifest {
  schema: number;
  role: 'baselineObservation' | 'candidate';
  preset: Preset;
  attempt: number;
  source: string;
  dirtyPaths: string;
  complete: boolean;
  passed: boolean;
  behaviorPassed: boolean;
  browser: string;
  runtime: string;
  playwright: string;
  runner: { run: string | null; attempt: string | null; name: string };
  harnessSha256: Record<string, string>;
  fixture: Record<string, unknown>;
  instrumentation: Record<string, unknown>;
  observedKeydowns: number;
  textSha256: string;
  frameId: string;
  trace: DocCallbackArtifactFile & { completion: { dataLossOccurred: boolean } };
  attribution: {
    callsites: DocCallbackCallsite[];
    unmapped: unknown[];
    artifacts: DocCallbackArtifactFile[];
  };
  analysis: Analysis;
  errors: unknown[];
  input: { keydownAt: number[]; keyToFrameMs: number[] };
  nativeAfterTyping: {
    text: string;
    selection: { start: number; end: number };
    pending: { history: number; collaboration: number };
  };
}

export interface LoadedDocCallbackEvidence {
  manifest: DocCallbackManifest;
  analysis: Analysis | null;
  failures: string[];
}

/** Keep retained paths relative to this exact case directory, including symlinks. */
export async function verifyDocCallbackFile(directory: string, artifact: DocCallbackArtifactFile) {
  if (
    !artifact ||
    typeof artifact.file !== 'string' ||
    isAbsolute(artifact.file) ||
    !artifact.file ||
    !validHash(artifact.sha256) ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 0
  )
    throw new Error('Invalid retained artifact path, hash, or byte length.');
  const root = await realpath(directory);
  const path = await realpath(resolve(root, artifact.file));
  const inside = relative(root, path);
  if (!inside || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside))
    throw new Error(`Retained artifact escapes its case directory: ${artifact.file}`);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size !== artifact.bytes)
    throw new Error(`Retained artifact byte length differs: ${artifact.file}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== artifact.sha256)
    throw new Error(`Retained artifact checksum differs: ${artifact.file}`);
  return path;
}

export async function loadDocCallbackEvidence(
  directory: string,
): Promise<LoadedDocCallbackEvidence> {
  const manifests: string[] = [];
  for await (const path of glob('**/spn113-evidence.json', { cwd: directory }))
    manifests.push(path);
  if (manifests.length !== 1)
    throw new Error(
      `Expected exactly one first-attempt callback manifest in ${directory}; found ${manifests.length}.`,
    );
  const path = resolve(directory, manifests[0]!);
  const manifest = JSON.parse(await readFile(path, 'utf8')) as DocCallbackManifest;
  const failures: string[] = [];
  let analysis: Analysis | null = null;
  try {
    const files = [manifest.trace, ...(manifest.attribution?.artifacts ?? [])];
    if (!manifest.attribution?.artifacts?.length)
      throw new Error('Retained source attribution artifacts are missing.');
    const kinds = new Set(manifest.attribution.artifacts.map((artifact) => artifact.kind));
    for (const kind of ['runtime', 'source-map', 'docs-ui-source'])
      if (!kinds.has(kind))
        throw new Error(`Retained source attribution is missing ${kind} evidence.`);
    const names = new Set<string>();
    for (const file of files) {
      if (!file || typeof file.file !== 'string')
        throw new Error('Retained artifact metadata is missing.');
      if (names.has(file.file)) throw new Error(`Duplicate retained artifact path: ${file.file}`);
      names.add(file.file);
      await verifyDocCallbackFile(dirname(path), file);
    }
    const raw = JSON.parse(await readFile(resolve(dirname(path), manifest.trace.file), 'utf8')) as {
      traceEvents?: unknown[];
    };
    if (!Array.isArray(raw.traceEvents)) throw new Error('Raw trace has no traceEvents array.');
    analysis = analyzeDocCallbackLifetimes({
      traceEvents: raw.traceEvents,
      completion: manifest.trace.completion,
      frameId: manifest.frameId,
      role: manifest.role,
      callsites: manifest.attribution.callsites,
    });
    if (!isDeepStrictEqual(analysis, manifest.analysis))
      failures.push(
        'Stored callback analysis differs from recomputation over retained raw evidence.',
      );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  return { manifest, analysis, failures };
}

/** Numeric budgets are descriptive in traced samples; SPN-108 stays independent. */
export function compareDocCallbackEvidence(
  preset: Preset,
  baseline: LoadedDocCallbackEvidence,
  candidate: LoadedDocCallbackEvidence,
  candidateSource: string,
) {
  const failures: string[] = [];
  const check = (condition: unknown, message: string) => {
    if (!condition) failures.push(message);
  };
  check(preset === 'desktop' || preset === 'mobile', 'Unknown callback preset.');
  check(/^[a-f0-9]{40}$/.test(candidateSource), 'Expected candidate commit is invalid.');
  for (const [label, evidence, role, source] of [
    ['baseline', baseline, 'baselineObservation', DOC_CALLBACK_BASELINE],
    ['candidate', candidate, 'candidate', candidateSource],
  ] as const) {
    failures.push(...evidence.failures.map((failure) => `${label}: ${failure}`));
    const value = evidence.manifest;
    check(
      value.schema === 1 && value.role === role && value.preset === preset && value.attempt === 0,
      `${label}: wrong schema, role, preset, or first-attempt identity.`,
    );
    check(
      value.source === source,
      `${label}: source does not match the required immutable commit.`,
    );
    check(
      value.complete === true && value.passed === true && value.behaviorPassed === true,
      `${label}: callback collection or native behavior did not complete successfully.`,
    );
    check(
      Array.isArray(value.errors) && value.errors.length === 0,
      `${label}: browser errors remain.`,
    );
    check(
      value.trace?.completion?.dataLossOccurred === false,
      `${label}: trace completion reports missing/lost data.`,
    );
    // The mapper also records arbitrary FunctionCall positions. Only unknown
    // measured timer ownership blocks completeness in the recomputed analyzer;
    // unrelated unmapped calls remain disclosed rather than silently discarded.
    check(
      Array.isArray(value.attribution?.unmapped),
      `${label}: unmapped source observations were not retained.`,
    );
    check(
      evidence.analysis?.complete === true && evidence.analysis.accepted === true,
      `${label}: recomputed callback evidence is incomplete or rejected.`,
    );
    if (role === 'candidate')
      check(
        evidence.analysis?.bounded === true,
        'candidate: callback lifetime bounds or cleanup failed.',
      );
    for (const key of ['browser', 'runtime', 'playwright'] as const)
      check(
        typeof value[key] === 'string' && value[key].length > 0,
        `${label}: missing ${key} identity.`,
      );
    for (const path of harnessPaths)
      check(validHash(value.harnessSha256?.[path]), `${label}: missing harness hash for ${path}.`);
    check(
      value.fixture?.paragraphs === 16 &&
        value.fixture.typedCharacters === 2071 &&
        value.fixture.enterKeys === 15 &&
        value.fixture.nativeKeydowns === 2086 &&
        value.fixture.nativeTextLength === 2088 &&
        value.fixture.sha256 === sha256(expectedText),
      `${label}: the original complete typing fixture changed.`,
    );
    check(
      value.observedKeydowns === 2086 &&
        value.input?.keydownAt?.length === 2086 &&
        value.input.keyToFrameMs?.length === 2086,
      `${label}: observed native key/frame counts are incomplete.`,
    );
    check(
      value.input?.keydownAt?.every(
        (at, index, all) =>
          Number.isFinite(at) && at >= 0 && (index === 0 || at >= all[index - 1]!),
      ) &&
        value.input?.keyToFrameMs?.every((duration) => Number.isFinite(duration) && duration >= 0),
      `${label}: native input observations have invalid clocks/durations.`,
    );
    check(
      value.textSha256 === sha256(expectedText) &&
        value.nativeAfterTyping?.text === expectedText &&
        value.nativeAfterTyping.selection?.start === 2086 &&
        value.nativeAfterTyping.selection?.end === 2086 &&
        value.nativeAfterTyping.pending?.history === 0 &&
        value.nativeAfterTyping.pending?.collaboration === 0,
      `${label}: exact native content, selection, or drained state is missing.`,
    );
    check(
      value.instrumentation?.cpuThrottle === (preset === 'mobile' ? 4 : 1) &&
        value.instrumentation.mountedEditors === 1 &&
        value.instrumentation.deviceScaleFactor === 1 &&
        value.instrumentation.touch === (preset === 'mobile') &&
        isDeepStrictEqual(
          value.instrumentation.viewport,
          preset === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        ) &&
        value.instrumentation.playwrightTrace === false &&
        value.instrumentation.latencyBudgetsEnforced === false,
      `${label}: the registered traced browser preset changed.`,
    );
    if (role === 'candidate')
      check(
        value.dirtyPaths === '',
        'candidate: uncommitted source cannot establish final-commit acceptance.',
      );
    else {
      const dirty =
        typeof value.dirtyPaths === 'string'
          ? value.dirtyPaths.split('\n').filter(Boolean)
          : ['invalid'];
      // The fixture trims git's output, removing the leading status space from
      // its first modified-file line. Accept that serialization, not arbitrary paths.
      check(
        dirty.every((line) => {
          const match = /^([ M?]{1,2}) (.+)$/.exec(line);
          return (
            match && ['M', '??'].includes(match[1]!.trim()) && harnessPaths.includes(match[2]!)
          );
        }),
        'baseline: changes extend beyond the explicitly matched measurement harness.',
      );
    }
  }
  for (const key of [
    'browser',
    'runtime',
    'playwright',
    'runner',
    'harnessSha256',
    'fixture',
    'instrumentation',
  ] as const)
    check(
      isDeepStrictEqual(baseline.manifest[key], candidate.manifest[key]),
      `Paired ${key} differs.`,
    );
  return {
    schema: 1,
    preset,
    accepted: failures.length === 0,
    failures,
    baseline: {
      source: baseline.manifest.source,
      traceSha256: baseline.manifest.trace?.sha256,
      bounded: baseline.analysis?.bounded,
      unmappedSourcePositions: baseline.manifest.attribution?.unmapped?.length ?? null,
      families: baseline.analysis?.families,
    },
    candidate: {
      source: candidate.manifest.source,
      traceSha256: candidate.manifest.trace?.sha256,
      bounded: candidate.analysis?.bounded,
      unmappedSourcePositions: candidate.manifest.attribution?.unmapped?.length ?? null,
      families: candidate.analysis?.families,
    },
    timing:
      'Traced callback observations are descriptive; unchanged unprofiled SPN-108 gates remain required.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [preset, baselineDirectory, candidateDirectory, output] = process.argv.slice(2);
  if (
    (preset !== 'desktop' && preset !== 'mobile') ||
    !baselineDirectory ||
    !candidateDirectory ||
    !output
  )
    throw new Error(
      'Usage: node scripts/ci/doc-callback-comparison.ts <desktop|mobile> <baseline-root> <candidate-root> <output.json>',
    );
  let report:
    ReturnType<typeof compareDocCallbackEvidence> | { accepted: false; failures: string[] };
  try {
    // Large raw traces are loaded/analyzed sequentially, not both in parallel.
    const baseline = await loadDocCallbackEvidence(baselineDirectory);
    const candidate = await loadDocCallbackEvidence(candidateDirectory);
    const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    report = compareDocCallbackEvidence(preset, baseline, candidate, source);
  } catch (error) {
    report = {
      accepted: false,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ accepted: report.accepted, failures: report.failures }, null, 2));
  if (!report.accepted) process.exitCode = 1;
}
