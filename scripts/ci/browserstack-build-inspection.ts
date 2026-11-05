import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, version } from 'vite';
import { inspectFinalBuild, sha256, validateRendererBoundary } from './browserstack-build-graph.ts';
import type { BuildMember } from './browserstack-build-graph.ts';

const root = process.cwd();
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--untracked-files=no'))
  throw new Error('Tracked source is dirty');
if (process.env.VITE_SYNC_EVIDENCE !== '1') throw new Error('Expected authored phone build flags');
const source = git('rev-parse', 'HEAD');
if (source !== process.env.GITHUB_SHA || process.env.GITHUB_RUN_ATTEMPT !== '1')
  throw new Error('Build inspection source or attempt mismatch');
await mkdir('artifacts', { recursive: true });
const identity = {
  source,
  tree: git('rev-parse', 'HEAD^{tree}'),
  eventBefore: process.env.SPN090_EVENT_BEFORE,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  node: process.version,
  vite: version,
  rolldown: JSON.parse(await readFile('node_modules/rolldown/package.json', 'utf8')).version,
  mode: 'production',
  flags: { VITE_SYNC_EVIDENCE: '1' },
  sourceHashes: Object.fromEntries(
    await Promise.all(
      [
        'package-lock.json',
        'vite.config.ts',
        'web/main.tsx',
        'web/application.tsx',
        'scripts/ci/browserstack-build-inspection.ts',
        'scripts/ci/browserstack-build-graph.ts',
        'src/build/rendererChunks.ts',
        'docs/implementation/evidence/SPN-090/renderer-baseline.json',
      ].map(async (file) => [file, sha256(await readFile(file))]),
    ),
  ),
};
await writeFile('artifacts/browserstack-build-identity.json', JSON.stringify(identity, null, 2));
let emitted:
  | { directory: string; bundle: Record<string, BuildMember>; hashes: Record<string, string> }
  | undefined;
await writeFile(
  'artifacts/browserstack-build-result.json',
  JSON.stringify({ complete: false, phase: 'build', ...identity }, null, 2),
);
try {
  await build({
    mode: 'production',
    plugins: [
      {
        name: 'spinel-phone-build-inspection',
        writeBundle: {
          order: 'post',
          handler(options, bundle) {
            if (emitted || !options.dir)
              throw new Error('Unexpected multiple or directoryless output');
            emitted = {
              directory: resolve(options.dir),
              bundle,
              hashes: Object.fromEntries(
                Object.entries(bundle).map(([file, member]) => [
                  file,
                  sha256(member.type === 'chunk' ? member.code : member.source),
                ]),
              ),
            };
          },
        },
      },
    ],
  });
  if (!emitted) throw new Error('Build inspection hook never ran');
  const graph = await inspectFinalBuild(emitted.directory, emitted.bundle, root, emitted.hashes);
  const baseline = JSON.parse(
    await readFile('docs/implementation/evidence/SPN-090/renderer-baseline.json', 'utf8'),
  );
  await writeFile(
    'artifacts/browserstack-build-graph.json',
    JSON.stringify(
      {
        ...identity,
        ...graph,
        rendererBaseline: baseline,
        rendererBoundary: { passed: false, status: 'pending' },
      },
      null,
      2,
    ),
  );
  const rendererBoundary = validateRendererBoundary(graph, baseline.modules);
  await writeFile(
    'artifacts/browserstack-build-graph.json',
    JSON.stringify(
      { ...identity, ...graph, rendererBoundary, rendererBaseline: baseline },
      null,
      2,
    ),
  );
  await writeFile(
    'artifacts/browserstack-build-result.json',
    JSON.stringify({ complete: true, phase: 'settled', ...identity }, null, 2),
  );
} catch (error) {
  try {
    await writeFile(
      'artifacts/browserstack-build-result.json',
      JSON.stringify(
        { complete: false, phase: 'failed', error: String(error), ...identity },
        null,
        2,
      ),
    );
  } catch (reportError) {
    console.error('Could not retain failure receipt', reportError);
  }
  throw error;
}
