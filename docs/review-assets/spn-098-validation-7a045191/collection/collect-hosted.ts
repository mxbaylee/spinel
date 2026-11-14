// Prepared GET-only collection; not yet executed or accepted as validation.
// Usage after publication: node collect-hosted.ts CI_RUN STORYBOOK_RUN DESKTOP_RUN NEW_OUTPUT_DIRECTORY
// Keeps original ZIPs in scratch. Compact durable retention is a later audited step.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync, createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const [ci, story, desktop, directory] = process.argv.slice(2);
if (![ci, story, desktop].every((v) => /^\d+$/.test(v ?? '')) || !directory)
  throw new Error('Expected three numeric run IDs and a NEW output directory');
const repository = 'mxbaylee/spinel';
const source = '7a0451917ef38524138fa2eac432d4520fbed008';
const base = 'c525aa933505d6e78b8fdd7a89940d87506d5cb3';
const pr = 227;
mkdirSync(directory); // Refuse overwrite of every previous snapshot/failure.
mkdirSync(join(directory, 'original-zips'));
const files: Array<Record<string, unknown>> = [];
const downloads: Array<Record<string, unknown>> = [];
const workflows: Array<Record<string, unknown>> = [];
const errors: string[] = [];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function save(name: string, bytes: Buffer) {
  const stored = gzipSync(bytes);
  const decoded = gunzipSync(stored);
  if (!decoded.equals(bytes)) throw new Error(`Gzip round-trip differs: ${name}`);
  const path = name + '.gz';
  writeFileSync(join(directory, path), stored, { flag: 'wx' });
  files.push({ path, bytes: stored.length, sha256: hash(stored), decodedBytes: decoded.length, decodedSha256: hash(decoded) });
}
function get(endpoint: string, name: string, paginated = false): any {
  const bytes = execFileSync('gh', ['api', '--method', 'GET', endpoint, ...(paginated ? ['--paginate', '--slurp'] : [])], { maxBuffer: 128 * 1024 * 1024 });
  save(name + '.json', bytes);
  return JSON.parse(bytes.toString('utf8'));
}
async function download(artifact: any, run: any) {
  const path = `original-zips/artifact-${artifact.id}.zip`;
  const record: Record<string, unknown> = { id: artifact.id, name: artifact.name, run: run.id, attempt: run.run_attempt, source, path, expiresAt: artifact.expires_at, githubDigest: artifact.digest ?? null, apiBytes: artifact.size_in_bytes, complete: false };
  downloads.push(record);
  if (artifact.expired) throw new Error(`Artifact ${artifact.id} expired; missing evidence stays explicit`);
  if (artifact.workflow_run?.head_sha && artifact.workflow_run.head_sha !== source)
    throw new Error(`Artifact ${artifact.id} source differs`);
  const fd = openSync(join(directory, path), 'wx');
  try {
    execFileSync('gh', ['api', '--method', 'GET', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { stdio: ['ignore', fd, 'pipe'] });
  } catch (error) {
    record.partialBytes = statSync(join(directory, path)).size;
    throw error;
  } finally { closeSync(fd); }
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(join(directory, path))) {
    digest.update(chunk); bytes += chunk.length;
  }
  const sha256 = digest.digest('hex');
  Object.assign(record, { bytes, sha256 });
  files.push({ path, bytes, sha256, storage: 'original ZIP bytes, no decoded claim' });
  if (artifact.digest && artifact.digest !== 'sha256:' + sha256)
    throw new Error(`Artifact ${artifact.id} ZIP digest mismatch; original retained`);
  if (typeof artifact.size_in_bytes === 'number' && artifact.size_in_bytes !== bytes)
    throw new Error(`Artifact ${artifact.id} ZIP size mismatch; original retained`);
  record.complete = true;
}
const selectedArtifact = /^(ci-plan$|ci-results-|desktop-offline-|design-review-(desktop-light|desktop-dark|mobile-light|mobile-dark|tablet)$|theme-screenshots-(development|production)-[12]$|doc-(callback-lifetimes|responsiveness)-(desktop|mobile)$|sized-restore-acceptance$)/;
try {
  const pull = get(`repos/${repository}/pulls/${pr}`, 'pr');
  if (pull.head.sha !== source || pull.base.sha !== base)
    throw new Error('PR source/base differs; preserve snapshot and coordinate before continuing');
  save('published-pr-body.md', Buffer.from(pull.body ?? '', 'utf8'));
  get(`repos/${repository}/commits/${source}`, 'source-commit');
  get(`repos/${repository}/commits/${base}`, 'base-commit');
  if (pull.merge_commit_sha) get(`repos/${repository}/commits/${pull.merge_commit_sha}`, 'pr-observed-merge-commit');
  get(`repos/${repository}/commits/${source}/check-runs?per_page=100`, 'source-check-runs', true);
  get(`repos/${repository}/actions/runs?head_sha=${source}&per_page=100`, 'all-source-runs', true);
  for (const [kind, id] of [['ci', ci], ['storybook', story], ['desktop', desktop]]) {
    const run = get(`repos/${repository}/actions/runs/${id}`, `run-${kind}`);
    if (run.head_sha !== source || run.event !== 'pull_request')
      throw new Error(`${kind} workflow source/event differs`);
    if (run.run_attempt !== 1) throw new Error(`${kind} is not first attempt; preserve and investigate before collection`);
    const attempt = run.run_attempt;
    const pages = get(`repos/${repository}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`, `jobs-${kind}-attempt-${attempt}`, true);
    const jobs = pages.flatMap((p: any) => p.jobs);
    if (new Set(jobs.map((j: any) => j.id)).size !== jobs.length)
      throw new Error(`${kind} duplicated paginated jobs`);
    const artifactPages = get(`repos/${repository}/actions/runs/${id}/artifacts?per_page=100`, `artifacts-${kind}`, true);
    const artifacts = artifactPages.flatMap((p: any) => p.artifacts);
    if (new Set(artifacts.map((a: any) => a.id)).size !== artifacts.length)
      throw new Error(`${kind} duplicated paginated artifacts`);
    workflows.push({ kind, id, attempt, status: run.status, conclusion: run.conclusion, allJobsTerminal: jobs.every((j: any) => j.status === 'completed'), jobs: jobs.map((j: any) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion })) });
    for (const job of jobs.filter((j: any) => j.status === 'completed' && j.conclusion !== 'skipped')) {
      const bytes = execFileSync('gh', ['api', '--method', 'GET', `repos/${repository}/actions/jobs/${job.id}/logs`, '--allow-escape-sequences'], { maxBuffer: 128 * 1024 * 1024 });
      save(`job-${job.id}.log`, bytes);
    }
    for (const artifact of artifacts.filter((a: any) => selectedArtifact.test(a.name)))
      await download(artifact, run);
  }
} catch (error) {
  errors.push(String(error));
  process.exitCode = 1;
} finally {
  writeFileSync(join(directory, 'collection-summary.json'), JSON.stringify({ observedAt: new Date().toISOString(), source, base, pr, workflows, downloads, errors, archiveReady: false, note: 'GET-only raw checkpoint, not acceptance. Preserve every first result. Exact plan canonical/raw digests, source/tested trees, gate selection and original artifact member/CRC/privacy checks remain necessary. Original full ZIPs are scratch retention; no compact archive, merge, rerun or publication is performed.' }, null, 2) + '\n');
  writeFileSync(join(directory, 'raw-manifest.json'), JSON.stringify({ algorithm: 'sha256', files }, null, 2) + '\n');
}
