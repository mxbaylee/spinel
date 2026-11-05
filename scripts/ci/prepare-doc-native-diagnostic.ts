import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { prepareDocsPatch } from '../dependencies/patch-univer-docs.ts';

// Explicitly reproduce the last accepted native composition implementation in
// this clean runner installation. The candidate application policy is unchanged.
assert.equal(process.argv[2], '--prior-native');
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const reviewedHead = process.env.SPN146_REVIEWED_HEAD;
assert.match(reviewedHead ?? '', /^[a-f0-9]{40}$/);
assert.equal(source, reviewedHead, 'Diagnostic checkout must equal the reviewed source.');
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const builds = [];
for (const format of ['es', 'cjs'] as const) {
  const path = `node_modules/@univerjs/docs/lib/${format}/index.js`;
  const installed = await readFile(path, 'utf8');
  const prepared = prepareDocsPatch(installed, format);
  assert.equal(
    installed,
    prepared.patched,
    'Clean install must contain the candidate patch first.',
  );
  assert.equal(
    hash(prepared.constantGuardPatched),
    {
      es: '57ec2ee153792c73e466a753d2e5c9ed1cd19615bb45a04fbe72c9336a6ad2b8',
      cjs: '941110089ab9110c90383b5d343c912d38770b416234e25dfa4b7c2a7bfd8ce5',
    }[format],
  );
  builds.push({
    format,
    path,
    installedSha256: hash(installed),
    priorSha256: hash(prepared.constantGuardPatched),
    prior: prepared.constantGuardPatched,
  });
}
for (const build of builds) {
  await writeFile(build.path, build.prior);
  assert.equal(hash(await readFile(build.path)), build.priorSha256);
}
const sources = Object.fromEntries(
  await Promise.all(
    [
      'package-lock.json',
      'scripts/ci/prepare-doc-native-diagnostic.ts',
      'scripts/dependencies/patch-univer-docs.ts',
      'src/ui/boundedDocHistory.ts',
      'src/ui/nativeDocFlushDiagnostic.ts',
      'web/docResponsivenessEvidence.ts',
      'e2e/doc-responsiveness.spec.ts',
      'e2e/doc-responsiveness-native-trace.ts',
      'e2e/doc-responsiveness-native-window.ts',
      'e2e/doc-responsiveness-native-sources.ts',
      'e2e/doc-responsiveness-callback-trace.ts',
      'e2e/doc-responsiveness-callback-progress.ts',
      'node_modules/@univerjs/core/lib/es/index.js',
      'node_modules/@univerjs/core/lib/cjs/index.js',
    ].map(async (path) => [path, hash(await readFile(path))]),
  ),
);
await writeFile(
  'spn146-diagnostic-build.json',
  JSON.stringify(
    {
      diagnosticOnly: true,
      role: 'prior-native',
      source,
      reviewedHead,
      eventBefore: process.env.SPN146_EVENT_BEFORE ?? null,
      tree,
      nativeReference: '2f442317dd2e1c188ae4a810ac094fd1162a4a2a',
      builds: builds.map(({ prior: _prior, ...build }) => build),
      sources,
      limits:
        'One 2086-key mobile profile at 4x throttle; instrumented diagnostic, no latency acceptance or historical execution reconstruction.',
    },
    null,
    2,
  ) + '\n',
);
