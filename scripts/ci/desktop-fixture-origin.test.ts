import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFixtureOrigin } from './desktop-fixture-origin.ts';

test('fixture origin keeps desktop defaults and separates public TLS identity from loopback', () => {
  assert.deepEqual(parseFixtureOrigin(), {
    origin: 'https://localhost:8176',
    host: 'localhost:8176',
    hostname: 'localhost',
    port: 8176,
    servername: 'localhost',
  });
  assert.deepEqual(parseFixtureOrigin('https://fixture.example.test:8176/'), {
    origin: 'https://fixture.example.test:8176',
    host: 'fixture.example.test:8176',
    hostname: 'fixture.example.test',
    port: 8176,
    servername: 'fixture.example.test',
  });
  assert.equal(parseFixtureOrigin('https://localhost:9443').port, 9443);
  assert.equal(parseFixtureOrigin('https://localhost').port, 443);
  assert.equal(parseFixtureOrigin('https://127.0.0.1:9443').servername, undefined);
});

test('fixture origin rejects authority ambiguity, non-root URLs and invalid listener ports', () => {
  for (const value of [
    '',
    'http://localhost:8176',
    ' https://localhost:8176',
    'https://localhost:8176 ',
    'https://user:password@localhost:8176',
    'https://@localhost:8176',
    'https://localhost:8176\\',
    'https://localhost:8176/app',
    'https://localhost:8176/../',
    'https://localhost:8176?query',
    'https://localhost:8176/#fragment',
    'https://localhost:0',
    'https://localhost:65536',
    'https://-invalid:8176',
    'https://invalid..host:8176',
    'https://*.example.test:8176',
  ])
    assert.throws(
      () => parseFixtureOrigin(value),
      { message: 'invalid-fixture-https-origin' },
      value,
    );
});
