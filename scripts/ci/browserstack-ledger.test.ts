import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountingBranch, ledgerClient, ledgerFailure } from './browserstack-ledger.ts';

const root = 'a'.repeat(40),
  blob = 'b'.repeat(40),
  tree = 'c'.repeat(40),
  commit = 'd'.repeat(40);
const repository = 'mxbaylee/spinel';
const token = 'unit-secret-token';
function file(content: string) {
  return Response.json({
    type: 'file',
    path: 'ledger.json',
    encoding: 'base64',
    size: Buffer.byteLength(content),
    sha: blob,
    content: Buffer.from(content).toString('base64'),
  });
}
function client(
  respond: (path: string, method: string, body: Record<string, unknown> | undefined) => Response,
) {
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  const store = ledgerClient({
    repository,
    token,
    fetcher: async (url, init) => {
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
      assert.equal(init?.redirect, 'error');
      const prefix = `https://api.github.com/repos/${repository}/`;
      assert.ok(String(url).startsWith(prefix));
      const path = String(url).slice(prefix.length),
        method = init?.method ?? 'GET';
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      assert.doesNotMatch(JSON.stringify(body) ?? '', /unit-secret-token/);
      calls.push({ path, method, body });
      return respond(path, method, body);
    },
  });
  return { store, calls };
}

test('a new durable ledger is an orphan accounting branch and verified by immutable commit', async () => {
  let stored = '';
  const { store, calls } = client((path, method, body) => {
    if (path === `git/ref/heads/${accountingBranch}`) return new Response('', { status: 404 });
    if (path === 'git/trees') {
      assert.equal(method, 'POST');
      const entries = body?.tree as { path: string; content: string }[];
      assert.equal(entries.length, 1);
      assert.equal(entries[0].path, 'ledger.json');
      stored = entries[0].content;
      return Response.json({ sha: tree });
    }
    if (path === 'git/commits') {
      assert.deepEqual(body?.parents, []);
      assert.equal(body?.tree, tree);
      return Response.json({ sha: commit });
    }
    if (path === 'git/refs') {
      assert.deepEqual(body, { ref: `refs/heads/${accountingBranch}`, sha: commit });
      return Response.json({ object: { sha: commit } });
    }
    assert.equal(path, `contents/ledger.json?ref=${commit}`);
    return file(stored);
  });
  const previous = await store.read();
  assert.deepEqual(previous, { value: null, blobSha: null });
  const value = { ledger: { sessions: ['synthetic'] } };
  const saved = await store.write(previous, value, '123', '1');
  assert.equal(saved.commit, commit);
  assert.equal(saved.url, `https://github.com/${repository}/blob/${commit}/ledger.json`);
  assert.equal(calls.length, 5);
  assert.deepEqual(JSON.parse(stored), value);
});

test('an existing ledger uses its old blob SHA and retains the new commit only after readback', async () => {
  let stored = '{"previous":true}\n';
  const { store, calls } = client((path, method, body) => {
    if (path.startsWith('git/ref/')) return Response.json({ object: { sha: root } });
    if (method === 'PUT') {
      assert.equal(path, 'contents/ledger.json');
      assert.equal(body?.sha, blob);
      assert.equal(body?.branch, accountingBranch);
      stored = Buffer.from(body?.content as string, 'base64').toString('utf8');
      return Response.json({ commit: { sha: commit } });
    }
    assert.ok(
      [`contents/ledger.json?ref=${root}`, `contents/ledger.json?ref=${commit}`].includes(path),
    );
    return file(stored);
  });
  const previous = await store.read();
  assert.deepEqual(previous.value, { previous: true });
  await store.write(previous, { next: true }, '123', '2');
  assert.equal(calls.length, 4);
  assert.deepEqual(JSON.parse(stored), { next: true });
});

test('conflicting writes and denied access fail once without exposing raw remote errors', async () => {
  for (const status of [403, 409, 422]) {
    const { store, calls } = client(() => new Response(`secret ${token}`, { status }));
    await assert.rejects(
      store.write({ value: {}, blobSha: blob }, {}, '123', '1'),
      new RegExp(`ledger-http-${status}`),
    );
    assert.equal(calls.length, 1);
  }
  assert.equal(ledgerFailure(new Error(`secret ${token}`)), 'ledger-operation-failed');
});

test('a concurrent initial branch creator is not overwritten or retried', async () => {
  const { store, calls } = client((path) => {
    if (path === 'git/trees') return Response.json({ sha: tree });
    if (path === 'git/commits') return Response.json({ sha: commit });
    assert.equal(path, 'git/refs');
    return new Response('secret-conflict', { status: 422 });
  });
  await assert.rejects(
    store.write({ value: null, blobSha: null }, {}, '123', '1'),
    /ledger-http-422/,
  );
  assert.equal(calls.length, 3);
});

test('an existing branch with missing, malformed or oversized ledger data is not a fresh ledger', async () => {
  for (const invalid of [
    () => new Response('', { status: 404 }),
    () => file('invalid JSON'),
    () =>
      Response.json({
        type: 'file',
        path: 'other.json',
        encoding: 'base64',
        size: 2,
        content: 'e30=',
        sha: blob,
      }),
    () =>
      Response.json({
        type: 'file',
        path: 'ledger.json',
        encoding: 'base64',
        size: 2_000_000,
        content: '',
        sha: blob,
      }),
  ]) {
    const { store, calls } = client((path) =>
      path.startsWith('git/ref/') ? Response.json({ object: { sha: root } }) : invalid(),
    );
    await assert.rejects(store.read(), /ledger-(http-404|invalid-json|invalid-response)/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.method === 'GET'));
  }
});

test('a different readback never counts as verified persistence', async () => {
  const { store } = client((_path, method) =>
    method === 'PUT' ? Response.json({ commit: { sha: commit } }) : file('{"different":true}\n'),
  );
  await assert.rejects(
    store.write({ value: {}, blobSha: blob }, {}, '123', '1'),
    /ledger-write-mismatch/,
  );
});

test('invalid identity and excessive output are refused before a write', async () => {
  assert.throws(
    () => ledgerClient({ repository: '../other', token }),
    /ledger-missing-credentials/,
  );
  const { store, calls } = client(() => {
    throw new Error('unexpected network');
  });
  await assert.rejects(
    store.write({ value: null, blobSha: null }, {}, 'bad', '1'),
    /ledger-invalid-run/,
  );
  await assert.rejects(
    store.write({ value: null, blobSha: null }, 'x'.repeat(1_048_576), '1', '1'),
    /ledger-full/,
  );
  assert.equal(calls.length, 0);
});
