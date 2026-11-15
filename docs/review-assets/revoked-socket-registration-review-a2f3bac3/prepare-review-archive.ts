import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/mxbaylee/projects/spinel-socket-closure-registration';
const out = '/tmp/spinel-socket-closure-registration';
const source = 'a2f3bac37c084b8f9fbf163d562c96dae4aff8ef';
const prefix = 'docs/review-assets/revoked-socket-registration-review-a2f3bac3';
const tag = 'archive/revoked-socket-registration-review-a2f3bac3-20261114';
const stage = join(out, 'review-archive-stage');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const git = (args: string[], options: { env?: NodeJS.ProcessEnv; input?: Buffer | string } = {}) => execFileSync('git', args, { cwd: root, ...options });
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]).sort();
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), source);
assert.equal(git(['status', '--porcelain=v1']).length, 0);
const mode = process.argv[2];
if (mode === 'stage') {
  const plan = JSON.parse(readFileSync(join(out, 'review-archive-payload-plan.json'), 'utf8'));
  assert.equal(plan.source, source);
  assert(!existsSync(stage), 'Never overwrite an existing stage');
  const payload = join(stage, prefix);
  mkdirSync(payload, { recursive: true });
  for (const entry of plan.copies) {
    assert(!entry.archivePath.startsWith('/') && !entry.archivePath.split('/').includes('..'));
    const data = readFileSync(entry.sourcePath);
    assert.equal(data.length, entry.bytes); assert.equal(sha(data), entry.sha256);
    const target = join(payload, entry.archivePath);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data);
    assert.deepEqual(readFileSync(target), data);
  }
  writeFileSync(join(payload, 'copy-provenance.json'), JSON.stringify(plan, null, 2) + '\n');
  const readme = readFileSync(join(out, 'review-archive-README.md'));
  assert.equal(sha(readme), plan.readmeSha256);
  writeFileSync(join(payload, 'README.md'), readme);
  const payloads = files(payload).map(p => { const data = readFileSync(p); return { path: relative(payload, p), bytes: data.length, sha256: sha(data) }; });
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify({ source, base: '8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d', reservedTag: tag, phase: 'independent reviews complete; hosted validation pending', payloads }, null, 2) + '\n');
  console.log(JSON.stringify({ stage, prefix, payloads: payloads.length, reservedTag: tag }));
} else if (mode === 'seal') {
  assert.equal(process.argv[3], 'root-authorized-local-seal');
  const payload = join(stage, prefix);
  const manifest = JSON.parse(readFileSync(join(payload, 'manifest.json'), 'utf8'));
  for (const entry of manifest.payloads) {
    const data = readFileSync(join(payload, entry.path));
    assert.equal(data.length, entry.bytes); assert.equal(sha(data), entry.sha256);
  }
  assert.equal(files(payload).length, manifest.payloads.length + 1);
  const privateIndex = join(out, 'review-private-index'); assert(!existsSync(privateIndex));
  const env = { ...process.env, GIT_INDEX_FILE: privateIndex };
  git(['read-tree', source], { env });
  for (const p of files(payload)) {
    const blob = git(['hash-object', '-w', '--stdin'], { input: readFileSync(p) }).toString().trim();
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${relative(stage, p)}`], { env });
  }
  const tree = git(['write-tree'], { env }).toString().trim();
  const commit = git(['commit-tree', tree, '-p', source], { input: 'Preserve SPN-161 registration independent review evidence\n' }).toString().trim();
  const changes = git(['diff', '--name-status', source, commit]).toString().trim().split('\n');
  assert(changes.every(line => line.startsWith(`A\t${prefix}/`)));
  assert.equal(git(['status', '--porcelain=v1']).length, 0);
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), source);
  const result = { commit, parent: source, tree, reservedTag: tag, prefix, addedPaths: changes.length, payloads: manifest.payloads.length, published: false, candidateUnchanged: true };
  writeFileSync(join(out, 'review-archive-identity.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} else throw new Error('Only stage or explicitly root-authorized seal modes are supported');
