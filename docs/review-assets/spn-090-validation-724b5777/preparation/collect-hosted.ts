// Prepared GET-only collector; not executed, not validation or publication.
// Usage: node collect-hosted.ts CI_RUN STORYBOOK_RUN DESKTOP_RUN NEW_OUTPUT_DIRECTORY
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync, unlinkSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const [ci, story, desktop, directory] = process.argv.slice(2);
if (![ci, story, desktop].every((v) => /^\d+$/.test(v ?? '')) || !directory)
  throw new Error('Expected CI, Storybook, Desktop run IDs and a NEW output directory');
const repository = 'mxbaylee/spinel';
const source = '724b577791273e0962ff08a38dea77a5aa632d84';
const base = 'c525aa933505d6e78b8fdd7a89940d87506d5cb3';
mkdirSync(directory); // Never overwrite any earlier checkpoint/failure.
const files: Array<Record<string, unknown>> = [];
const artifactsSeen: Array<Record<string, unknown>> = [];
const workflows: Array<Record<string, unknown>> = [];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const errors: string[] = [];
function save(name: string, bytes: Buffer, compress = true) {
  const stored = compress ? gzipSync(bytes) : bytes;
  const path = name + (compress ? '.gz' : '');
  writeFileSync(join(directory, path), stored);
  files.push({ path, bytes: stored.length, sha256: hash(stored), ...(compress ? { decodedBytes: bytes.length, decodedSha256: hash(bytes) } : {}) });
}
function get(endpoint: string, name: string, paginated = false): any {
  const bytes = execFileSync('gh', ['api', '--method', 'GET', endpoint, ...(paginated ? ['--paginate', '--slurp'] : [])], { maxBuffer: 128 * 1024 * 1024 });
  save(name + '.json', bytes);
  return JSON.parse(bytes.toString('utf8'));
}
async function compactArtifact(artifact: any) {
  if (artifact.expired) throw new Error(`Artifact ${artifact.id} expired; missing evidence must remain explicit`);
  const zipPath = join(directory, `temporary-artifact-${artifact.id}.zip`);
  const fd = openSync(zipPath, 'wx');
  try {
    execFileSync('gh', ['api', '--method', 'GET', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { stdio: ['ignore', fd, 'pipe'] });
  } finally { closeSync(fd); }
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(zipPath)) { digest.update(chunk); bytes += chunk.length; }
  const sha256 = digest.digest('hex');
  const record = { id: artifact.id, name: artifact.name, bytes, downloadedZipSha256: sha256, githubDigest: artifact.digest ?? null, jsonMembers: [] as Array<Record<string, unknown>> };
  artifactsSeen.push(record);
  if (artifact.digest && artifact.digest !== 'sha256:' + sha256) throw new Error(`Artifact ${artifact.id} ZIP digest mismatch; preserve downloaded failure`);
  const members = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n').filter((name) => name.endsWith('.json'));
  for (const [index, name] of members.entries()) {
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`Unsafe artifact member ${name}`);
    const contents = execFileSync('unzip', ['-p', zipPath, name], { maxBuffer: 64 * 1024 * 1024 });
    JSON.parse(contents.toString('utf8'));
    const storedName = `artifact-${artifact.id}-json-${index}.json`;
    save(storedName, contents);
    record.jsonMembers.push({ originalPath: name, storedPath: storedName + '.gz', bytes: contents.length, sha256: hash(contents) });
  }
  if (!members.length) throw new Error(`Artifact ${artifact.id} had no JSON evidence; keep ZIP for inspection`);
  // Full screenshots/build/profile payloads are not durable archive inputs.
  // Successful streamed ZIP digest + compact original JSON remain verifiable.
  unlinkSync(zipPath);
}
try {
  const pull = get(`repos/${repository}/pulls/224`, 'pr');
  if (pull.head.sha !== source || pull.base.sha !== base) throw new Error('PR source/base differs; preserve snapshot and coordinate before continuing');
  save('published-pr-body.md', Buffer.from(pull.body ?? '', 'utf8'));
  get(`repos/${repository}/commits/${source}`, 'source-commit');
  get(`repos/${repository}/commits/${base}`, 'base-commit');
  get(`repos/${repository}/commits/${source}/check-runs?per_page=100`, 'source-check-runs', true);
  if (pull.merge_commit_sha) get(`repos/${repository}/commits/${pull.merge_commit_sha}`, 'pr-tested-merge-commit');
  get(`repos/${repository}/actions/runs?head_sha=${source}&per_page=100`, 'all-source-runs', true);
  for (const [kind, id] of [['ci', ci], ['storybook', story], ['desktop', desktop]]) {
    const run = get(`repos/${repository}/actions/runs/${id}`, `run-${kind}`);
    if (run.head_sha !== source || run.event !== 'pull_request') throw new Error(`${kind} source/event mismatch`);
    const attempt = run.run_attempt;
    const pages = get(`repos/${repository}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`, `jobs-${kind}-attempt-${attempt}`, true);
    const jobs = pages.flatMap((p: any) => p.jobs);
    if (new Set(jobs.map((j: any) => j.id)).size !== jobs.length) throw new Error(`${kind} duplicate paginated jobs`);
    const artifactPages = get(`repos/${repository}/actions/runs/${id}/artifacts?per_page=100`, `artifacts-${kind}`, true);
    const artifacts = artifactPages.flatMap((p: any) => p.artifacts);
    workflows.push({ kind, id, attempt, status: run.status, conclusion: run.conclusion, allJobsTerminal: jobs.every((j: any) => j.status === 'completed'), jobs: jobs.map((j: any) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion })) });
    for (const job of jobs.filter((j: any) => j.status === 'completed' && j.conclusion !== 'skipped')) {
      const bytes = execFileSync('gh', ['api', '--method', 'GET', `repos/${repository}/actions/jobs/${job.id}/logs`, '--allow-escape-sequences'], { maxBuffer: 128 * 1024 * 1024 });
      save(`job-${job.id}.log`, bytes);
    }
    for (const artifact of artifacts.filter((a: any) => /^(ci-plan$|ci-results-|desktop-offline-|design-review-(desktop-light|desktop-dark|mobile-light|mobile-dark|tablet)$)/.test(a.name)))
      await compactArtifact(artifact);
  }
} catch (error) {
  errors.push(String(error));
  process.exitCode = 1;
} finally {
  writeFileSync(join(directory, 'collection-summary.json'), JSON.stringify({ observedAt: new Date().toISOString(), source, base, pr: 224, workflows, artifacts: artifactsSeen, errors, archiveReady: false, note: 'Raw GET-only checkpoint. Exact plan/tested-tree/gate/result identity and first-failure/privacy review still required. No current pass, merge or archive publication inferred.' }, null, 2) + '\n');
  writeFileSync(join(directory, 'raw-manifest.json'), JSON.stringify({ algorithm: 'sha256', files }, null, 2) + '\n');
}
