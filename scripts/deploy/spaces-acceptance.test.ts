import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  assertAcceptanceCatalog,
  assertPrivateResponse,
  parseSpacesAcceptanceEnvironment,
} from './spaces-acceptance.ts';

const accessKeyId = 'fixture-access-key';
const secretAccessKey = 'fixture-secret-key';
const endpoint = 'https://fixture-bucket.sfo3.digitaloceanspaces.com';
const pair = JSON.stringify({ accessKeyId, secretAccessKey });
const valid = { DIGITAL_OCEAN_ACCESS_KEY: pair, DIGITAL_OCEAN_ENDPOINT: endpoint };

test('two named CI secrets support a credential pair and bucket endpoint without guessing credentials', () => {
  const expected = {
    status: 'ready',
    configuration: { accessKeyId, secretAccessKey, bucket: 'fixture-bucket', region: 'sfo3' },
  };
  assert.deepEqual(parseSpacesAcceptanceEnvironment(valid), expected);
  assert.deepEqual(
    parseSpacesAcceptanceEnvironment({
      DIGITAL_OCEAN_ACCESS_KEY: accessKeyId,
      DIGITAL_OCEAN_SECRET_KEY: secretAccessKey,
      DIGITAL_OCEAN_ENDPOINT: `${endpoint}/`,
    }),
    expected,
  );
  const missing = parseSpacesAcceptanceEnvironment({
    ...valid,
    DIGITAL_OCEAN_ACCESS_KEY: accessKeyId,
  });
  assert.equal(missing.status, 'unavailable');
  if (missing.status === 'unavailable') assert.match(missing.reason, /secretAccessKey is missing/);
});

test('missing or malformed external capability is explicit and never includes supplied secret values', () => {
  for (const environment of [
    {},
    { DIGITAL_OCEAN_ACCESS_KEY: pair },
    { ...valid, DIGITAL_OCEAN_ACCESS_KEY: '{malformed-private-value' },
    { ...valid, DIGITAL_OCEAN_ACCESS_KEY: JSON.stringify({ accessKeyId }) },
    { ...valid, DIGITAL_OCEAN_ACCESS_KEY: JSON.stringify({ secretAccessKey }) },
    {
      ...valid,
      DIGITAL_OCEAN_ACCESS_KEY: JSON.stringify({
        accessKeyId,
        secretAccessKey,
        unexpected: 'private',
      }),
    },
    {
      ...valid,
      DIGITAL_OCEAN_ACCESS_KEY: JSON.stringify({ accessKeyId, secretAccessKey: ['private'] }),
    },
    {
      ...valid,
      DIGITAL_OCEAN_ACCESS_KEY: JSON.stringify({ accessKeyId: 'space forbidden', secretAccessKey }),
    },
    {
      ...valid,
      DIGITAL_OCEAN_ACCESS_KEY: JSON.stringify({ accessKeyId, secretAccessKey: 'line\nbreaks' }),
    },
  ]) {
    const result = parseSpacesAcceptanceEnvironment(environment);
    assert.equal(result.status, 'unavailable');
    assert.doesNotMatch(
      JSON.stringify(result),
      /fixture-access-key|fixture-secret-key|malformed-private-value|fixture-bucket/,
    );
  }
});

test('the probe requires a concrete Spaces bucket origin and rejects redirects and custom hosts', () => {
  const incomplete = parseSpacesAcceptanceEnvironment({
    ...valid,
    DIGITAL_OCEAN_ENDPOINT: 'https://sfo3.digitaloceanspaces.com',
  });
  assert.equal(incomplete.status, 'unavailable');
  if (incomplete.status === 'unavailable') assert.match(incomplete.reason, /missing the bucket/);
  for (const invalid of [
    'not-a-url',
    'http://fixture-bucket.sfo3.digitaloceanspaces.com',
    'https://fixture-bucket.sfo3.digitaloceanspaces.com.evil.invalid',
    'https://fixture-bucket.sfo3.cdn.digitaloceanspaces.com',
    'https://127.0.0.1',
    `${endpoint}:443`,
    `${endpoint}:8443`,
    `${endpoint}/data`,
    `${endpoint}?private=query`,
    `${endpoint}#private-fragment`,
    'https://private:credentials@fixture-bucket.sfo3.digitaloceanspaces.com',
    'https://fixture-bucket.nyc3.digitaloceanspaces.com@evil.invalid',
  ]) {
    const result = parseSpacesAcceptanceEnvironment({ ...valid, DIGITAL_OCEAN_ENDPOINT: invalid });
    assert.equal(
      result.status,
      'unavailable',
      'Unsafe or incomplete endpoint must not reach the provider',
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /evil.invalid|127.0.0.1|private=query|private-fragment|private:credentials/,
    );
  }
});

test('a known authenticated artifact requires explicit anonymous denial rather than a redirect or missing result', () => {
  for (const denied of [401, 403]) assert.doesNotThrow(() => assertPrivateResponse(denied));
  for (const status of [200, 206, 301, 302, 404, 429, 500])
    assert.throws(() => assertPrivateResponse(status), /not denied/);
});

test('provider acceptance refuses incomplete, foreign or duplicate catalog entries', () => {
  const complete = ['isolated/one.spinel', 'isolated/two.spinel'];
  assert.doesNotThrow(() => assertAcceptanceCatalog([...complete].reverse(), complete));
  for (const actual of [
    [complete[0]],
    [...complete, 'isolated/one.spinel.pending'],
    [...complete, 'other/private.spinel'],
    [...complete, complete[0]],
  ])
    assert.throws(() => assertAcceptanceCatalog(actual, complete), /did not match/);
});

test('CI probe produces only redacted readiness evidence without package installation or provider requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-spaces-probe-'));
  try {
    const output = join(directory, 'github-output'),
      summary = join(directory, 'github-summary');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...valid,
      DIGITAL_OCEAN_SECRET_KEY: '',
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      SPACES_ACCEPTANCE_COMMIT: 'a'.repeat(40),
    };
    delete env.NODE_TEST_CONTEXT;
    const script = fileURLToPath(new URL('./spaces-acceptance.ts', import.meta.url));
    for (const expected of ['ready', 'unavailable']) {
      if (expected === 'unavailable') env.DIGITAL_OCEAN_ACCESS_KEY = accessKeyId;
      await writeFile(output, '');
      await writeFile(summary, '');
      const child = spawnSync(process.execPath, [script, '--probe'], {
        env,
        cwd: directory,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stderr);
      const evidence = await readFile(
        join(directory, 'artifacts', 'spaces-acceptance.json'),
        'utf8',
      );
      assert.equal(JSON.parse(evidence).status, expected);
      assert.equal(await readFile(output, 'utf8'), `ready=${expected === 'ready'}\n`);
      const allOutput = child.stdout + child.stderr + evidence + (await readFile(summary, 'utf8'));
      assert.doesNotMatch(allOutput, /fixture-access-key|fixture-secret-key|fixture-bucket|sfo3/);
      assert.deepEqual(JSON.parse(evidence).checks, []);
      assert.equal(JSON.parse(evidence).cleanup, 'not-needed');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
