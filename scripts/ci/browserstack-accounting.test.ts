import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('accounting CLI persists measured history, fails unknown admission and never touches devices', async () => {
  await exercise('new');
});
test('a null stored ledger cannot erase history by being treated as a new account', async () => {
  await exercise('invalid');
  await exercise('literal-null');
  await exercise('primitive');
});

async function exercise(scenario: 'new' | 'invalid' | 'literal-null' | 'primitive') {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-accounting-'));
  try {
    const fixturePath = fileURLToPath(
      new URL('../../docs/implementation/SPN-090-browserstack-history.json', import.meta.url),
    );
    const hook = join(directory, 'provider-fixture.ts');
    await writeFile(
      hook,
      String.raw`
import { readFileSync, writeFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));
const calls = [];
const hash = 'a'.repeat(40);
let stored = ${JSON.stringify(scenario === 'invalid' ? '{"schemaVersion":1,"ledger":null}' : scenario === 'literal-null' ? 'null' : scenario === 'primitive' ? '42' : '')};
function raw(id) {
  const entry = fixture.history.sessions.find(s => s.sessionId === id);
  const data = entry.observations.find(o => o.evidence.outcome === 'available').evidence.data;
  return { automation_session: { hashed_id: id, duration: data.durationSeconds,
    status: data.providerStatus, browserstack_status: data.executionStatus, created_at: data.createdAt } };
}
globalThis.fetch = async (url, init) => {
  const parsed = new URL(String(url));
  const method = init.method;
  calls.push({ host: parsed.host, path: parsed.pathname, method });
  writeFileSync(${JSON.stringify(join(directory, 'calls.json'))}, JSON.stringify(calls));
  if (parsed.host === 'api.browserstack.com') {
    if (method !== 'GET') throw new Error('provider mutation forbidden');
    const path = parsed.pathname;
    if (path.endsWith('/plan.json')) return Response.json({ parallel_sessions_max_allowed: 5, parallel_sessions_running: 0, queued_sessions: 0 });
    if (path.endsWith('/builds.json')) return Response.json(fixture.history.builds.map(b => ({ automation_build: { hashed_id: b.buildId, status: 'done' } })));
    const build = path.match(/builds\/([a-f0-9]{40})\/sessions.json$/);
    if (build) return Response.json(fixture.history.builds.find(b => b.buildId === build[1]).sessionIds.map(raw));
    const detail = path.match(/sessions\/([a-f0-9]{40}).json$/);
    if (detail) return Response.json(raw(detail[1]));
    throw new Error('unknown provider endpoint');
  }
  if (parsed.host !== 'api.github.com' || !parsed.pathname.startsWith('/repos/mxbaylee/spinel/')) throw new Error('unexpected host');
  const path = parsed.pathname.slice('/repos/mxbaylee/spinel/'.length);
  if (path === 'git/ref/heads/ci/browserstack-accounting') return stored ? Response.json({ object: { sha: hash } }) : new Response('', { status: 404 });
  if (path === 'contents/ledger.json' && method === 'GET') return Response.json({ type: 'file', path: 'ledger.json', encoding: 'base64', sha: hash, size: Buffer.byteLength(stored), content: Buffer.from(stored).toString('base64') });
  if (${JSON.stringify(scenario)} !== 'new') throw new Error('invalid ledger must not be overwritten');
  const body = JSON.parse(init.body);
  if (path === 'git/trees') {
    if (body.tree.length !== 1 || body.tree[0].path !== 'ledger.json') throw new Error('unexpected path');
    stored = body.tree[0].content;
    writeFileSync(${JSON.stringify(join(directory, 'stored.json'))}, stored);
    return Response.json({ sha: hash });
  }
  if (path === 'git/commits') {
    if (body.parents.length !== 0) throw new Error('source branch mutation');
    return Response.json({ sha: hash });
  }
  if (path === 'git/refs' && body.ref === 'refs/heads/ci/browserstack-accounting') return Response.json({ object: { sha: hash } });
  throw new Error('unexpected GitHub mutation');
};
`,
    );
    const child = spawnSync(
      process.execPath,
      ['--import', hook, fileURLToPath(new URL('./browserstack-accounting.ts', import.meta.url))],
      {
        cwd: directory,
        timeout: 10_000,
        encoding: 'utf8',
        env: {
          ...process.env,
          BS_USERNAME: 'unit-provider-user',
          BS_ACCESS_KEY: 'unit-provider-key',
          GITHUB_TOKEN: 'unit-github-token',
          SOURCE_SHA: 'b'.repeat(40),
          GITHUB_SHA: 'c'.repeat(40),
          GITHUB_REPOSITORY: 'mxbaylee/spinel',
          GITHUB_RUN_ID: '123456',
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_OUTPUT: join(directory, 'output'),
          GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
        },
      },
    );
    assert.equal(child.status, 1, child.stderr);
    assert.equal(child.stderr, '', child.stdout);
    const report = JSON.parse(
      await readFile(join(directory, 'artifacts/browserstack-admission.json'), 'utf8'),
    );
    const calls = JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8')) as {
      host: string;
      path: string;
      method: string;
    }[];
    assert.equal(report.status, 'blocked');
    assert.equal(report.allocationAllowed, false);
    assert.equal(report.remainingMinutes, null);
    assert.equal(await readFile(join(directory, 'output'), 'utf8'), 'allocation_allowed=false\n');
    assert.match(await readFile(join(directory, 'summary.md'), 'utf8'), /60 lifetime minutes/);
    assert.ok(calls.every((call) => call.host !== 'api.browserstack.com' || call.method === 'GET'));
    assert.ok(
      calls.every((call) => ['api.browserstack.com', 'api.github.com'].includes(call.host)),
    );
    assert.doesNotMatch(
      JSON.stringify(report) + child.stdout + child.stderr,
      /unit-provider-user|unit-provider-key|unit-github-token/,
    );
    if (scenario === 'new') {
      assert.equal(report.measuredTerminalSessionSeconds, 241);
      assert.equal(report.measuredTerminalSessions, 15);
      assert.equal(report.persistence.status, 'verified');
      const stored = JSON.parse(await readFile(join(directory, 'stored.json'), 'utf8'));
      assert.equal(stored.ledger.sessions.length, 15);
      assert.equal(stored.latest.evidence.history.builds.length, 5);
      assert.equal(stored.latest.report.allocationAllowed, false);
    } else {
      assert.ok(report.blockingReasons.includes('invalid-durable-ledger'));
      assert.equal(report.persistence.status, 'failed');
      assert.ok(calls.every((call) => call.method === 'GET'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
