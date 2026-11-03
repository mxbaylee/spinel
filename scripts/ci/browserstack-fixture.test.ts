import assert from 'node:assert/strict';
import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  browserstackOrigin,
  createBrowserstackCertificate,
  parseFixtureOrigin,
  validateFixtureCertificate,
} from './browserstack-fixture.ts';

test('fixture origin keeps desktop defaults and separates public TLS identity from loopback', () => {
  assert.deepEqual(parseFixtureOrigin(), {
    origin: 'https://localhost:8176',
    host: 'localhost:8176',
    hostname: 'localhost',
    port: 8176,
    servername: 'localhost',
  });
  assert.deepEqual(parseFixtureOrigin(browserstackOrigin + '/'), {
    origin: browserstackOrigin,
    host: 'bs-local.com:8176',
    hostname: 'bs-local.com',
    port: 8176,
    servername: 'bs-local.com',
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

test('disposable TLS validates SAN, lifetime and key pairing, then removes only its owned files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-browserstack-tls-'));
  try {
    await writeFile(join(directory, 'keep.txt'), 'caller-owned');
    const tls = await createBrowserstackCertificate(directory);
    const certificate = await readFile(tls.certPath);
    const privateKey = await readFile(tls.keyPath);
    const parsed = new X509Certificate(certificate);
    assert.equal(parsed.checkHost('bs-local.com', { subject: 'never' }), 'bs-local.com');
    const lifetime = Date.parse(parsed.validTo) - Date.parse(parsed.validFrom);
    assert.ok(lifetime === 86_400_000 || lifetime === 86_401_000, String(lifetime));
    assert.equal((await stat(tls.keyPath)).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(tls.certificate).sort(), [
      'fingerprint256',
      'hostname',
      'selfSigned',
      'validFrom',
      'validTo',
    ]);
    assert.equal(tls.certificate.selfSigned, true);
    assert.equal(tls.certificate.hostname, 'bs-local.com');
    assert.equal(tls.certificate.fingerprint256, parsed.fingerprint256);
    assert.throws(() => validateFixtureCertificate(certificate, privateKey, 'different.test'), {
      message: 'fixture-certificate-host-mismatch',
    });
    assert.throws(
      () =>
        validateFixtureCertificate(
          certificate,
          privateKey,
          'bs-local.com',
          Date.parse(parsed.validTo),
        ),
      { message: 'fixture-certificate-invalid-validity' },
    );
    assert.throws(
      () =>
        validateFixtureCertificate(
          certificate,
          privateKey,
          'bs-local.com',
          Date.parse(parsed.validFrom) - 1,
        ),
      { message: 'fixture-certificate-invalid-validity' },
    );
    // The one-second allowance for OpenSSL's clock reads never admits a longer lifetime.
    const longDirectory = await mkdtemp(join(tmpdir(), 'spinel-browserstack-long-'));
    try {
      const longCert = join(longDirectory, 'cert.pem');
      const longKey = join(longDirectory, 'key.pem');
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-sha256',
          '-nodes',
          '-days',
          '2',
          '-subj',
          '/CN=bs-local.com',
          '-addext',
          'subjectAltName=DNS:bs-local.com',
          '-keyout',
          longKey,
          '-out',
          longCert,
        ],
        { stdio: 'ignore' },
      );
      assert.throws(
        () =>
          validateFixtureCertificate(readFileSync(longCert), readFileSync(longKey), 'bs-local.com'),
        { message: 'fixture-certificate-invalid-validity' },
      );
    } finally {
      await rm(longDirectory, { recursive: true, force: true });
    }
    const differentKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    });
    assert.throws(() => validateFixtureCertificate(certificate, differentKey, 'bs-local.com'), {
      message: 'fixture-certificate-key-mismatch',
    });
    assert.throws(() => validateFixtureCertificate('invalid', privateKey, 'bs-local.com'), {
      message: 'invalid-fixture-certificate-or-key',
    });
    assert.throws(() => validateFixtureCertificate(certificate, 'invalid', 'bs-local.com'), {
      message: 'invalid-fixture-certificate-or-key',
    });
    await mkdir(join(tls.directory, 'app'));
    await writeFile(join(tls.directory, 'app', 'app.sqlite'), 'disposable fixture');
    await tls.close();
    await tls.close();
    assert.deepEqual(await readdir(directory), ['keep.txt']);
    assert.equal(await readFile(join(directory, 'keep.txt'), 'utf8'), 'caller-owned');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid certificate directories fail before allocating a private fixture', async () => {
  await assert.rejects(createBrowserstackCertificate(''), { message: 'invalid-fixture-directory' });
  await assert.rejects(createBrowserstackCertificate('\0'), {
    message: 'invalid-fixture-directory',
  });
  const directory = await mkdtemp(join(tmpdir(), 'spinel-browserstack-directory-'));
  try {
    const file = join(directory, 'file');
    await writeFile(file, 'retained');
    await assert.rejects(createBrowserstackCertificate(file));
    assert.deepEqual(await readdir(directory), ['file']);
    assert.equal(await readFile(file, 'utf8'), 'retained');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
