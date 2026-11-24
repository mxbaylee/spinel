import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { prepareNativeWindowSources } from '../../e2e/doc-responsiveness-native-sources.ts';

const build = JSON.parse(await readFile('spn146-diagnostic-build.json', 'utf8'));
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
assert.equal(build.source, source);
assert.equal(build.reviewedHead, source);
assert.equal(build.tree, tree);
assert.equal(source, process.env.SPN146_REVIEWED_HEAD);
const prepared = await prepareNativeWindowSources('dist', {
  'node_modules/@univerjs/docs/lib/es/index.js': build.builds.find(
    (row: any) => row.format === 'es',
  ).priorSha256,
  'node_modules/@univerjs/core/lib/es/index.js':
    build.sources['node_modules/@univerjs/core/lib/es/index.js'],
});
await writeFile(
  'spn146-source-preparation.json',
  JSON.stringify({ ...prepared, source, tree, eventBefore: build.eventBefore }, null, 2),
);
