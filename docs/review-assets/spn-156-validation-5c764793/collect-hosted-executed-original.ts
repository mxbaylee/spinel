// Prepared GET-only collector. Not executed or graded as validation.
// Usage after manager publication: node collect-hosted.ts PR CI_RUN STORYBOOK_RUN DESKTOP_RUN NEW_OUTPUT_DIRECTORY
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const [pr, ci, story, desktop, directory] = process.argv.slice(2);
if (![pr, ci, story, desktop].every((n) => /^\d+$/.test(n ?? '')) || !directory) throw new Error('Expected PR, CI, Storybook, Desktop IDs and a NEW output directory');
const repository = 'mxbaylee/spinel';
const source = '5c764793f03f7f885873d08d6eca0660cd401bf0';
const base = 'c525aa933505d6e78b8fdd7a89940d87506d5cb3';
mkdirSync(directory); // Never overwrite a previous snapshot.
const files: Array<Record<string, unknown>> = [];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function save(name: string, bytes: Buffer, compress = true) {
  const stored = compress ? gzipSync(bytes) : bytes;
  const path = name + (compress ? '.gz' : '');
  writeFileSync(join(directory, path), stored);
  files.push({ path, bytes: stored.length, sha256: hash(stored), ...(compress ? { decoded: { bytes: bytes.length, sha256: hash(bytes) } } : {}) });
}
function api(endpoint: string, name: string, paginated = false): any {
  const args = ['api', endpoint, ...(paginated ? ['--paginate', '--slurp'] : [])];
  const bytes = execFileSync('gh', args, { maxBuffer: 128 * 1024 * 1024 });
  save(name + '.json', bytes);
  return JSON.parse(bytes.toString('utf8'));
}
const pull = api(`repos/${repository}/pulls/${pr}`, 'pr');
if (pull.head.sha !== source || pull.base.sha !== base) throw new Error('PR source/base changed; preserve this failed snapshot and stop');
save('published-pr-body.md', Buffer.from(pull.body ?? '', 'utf8'));
api(`repos/${repository}/commits/${source}`, 'source-commit');
api(`repos/${repository}/commits/${base}`, 'base-commit');
api(`repos/${repository}/commits/${source}/check-runs?per_page=100`, 'source-check-runs', true);
const workflows: any[] = [];
for (const [kind, id] of [['ci', ci], ['storybook', story], ['desktop', desktop]]) {
  const run = api(`repos/${repository}/actions/runs/${id}`, `run-${kind}`);
  if (run.head_sha !== source) throw new Error(`${kind} workflow source differs; stop`);
  const pages = api(`repos/${repository}/actions/runs/${id}/jobs?per_page=100`, `jobs-${kind}`, true);
  const jobs = pages.flatMap((p: any) => p.jobs);
  const artifactsPages = api(`repos/${repository}/actions/runs/${id}/artifacts?per_page=100`, `artifacts-${kind}`, true);
  const artifacts = artifactsPages.flatMap((p: any) => p.artifacts);
  workflows.push({ kind, id, status: run.status, conclusion: run.conclusion, attempt: run.run_attempt, jobs: jobs.map((j: any) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion })) });
  if (run.status !== 'completed') continue; // Snapshot only; pending never means passed.
  for (const artifact of artifacts.filter((a: any) => /^(ci-plan|ci-results-|theme-screenshots-(sync-production|production-[12])$|desktop-offline-)/.test(a.name))) {
    if (artifact.expired) throw new Error(`Required artifact ${artifact.id} expired`);
    const bytes = execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { maxBuffer: 128 * 1024 * 1024 });
    save(`artifact-${artifact.id}.zip`, bytes, false);
    if (artifact.digest && artifact.digest !== 'sha256:' + hash(bytes)) throw new Error(`Artifact ZIP digest mismatch: ${artifact.id}`);
  }
  for (const job of jobs.filter((j: any) => j.status === 'completed' && j.conclusion !== 'skipped' && true)) {
    const bytes = execFileSync('gh', ['api', `repos/${repository}/actions/jobs/${job.id}/logs`, '--allow-escape-sequences'], { maxBuffer: 128 * 1024 * 1024 });
    save(`job-${job.id}.log`, bytes);
  }
}
writeFileSync(join(directory, 'collection-summary.json'), JSON.stringify({ observedAt: new Date().toISOString(), source, base, pr: Number(pr), workflows, archiveReady: false, note: 'Raw collection only. Exact plan/tested-tree/aggregate/gate validation, privacy audit and review report inspection still required; no merge or archive publication is claimed.' }, null, 2) + '\n');
writeFileSync(join(directory, 'raw-manifest.json'), JSON.stringify({ algorithm: 'sha256', files }, null, 2) + '\n');
console.log(JSON.stringify({ source, pr, workflows: workflows.map(({ kind, status, conclusion, attempt }) => ({ kind, status, conclusion, attempt })), archiveReady: false }));
