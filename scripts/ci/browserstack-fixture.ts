import { execFile } from 'node:child_process';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const browserstackOrigin = 'https://bs-local.com:8176';
const certificateLifetime = 24 * 60 * 60 * 1000;
const runFile = promisify(execFile);

export type FixtureOrigin = {
  origin: string;
  host: string;
  hostname: string;
  port: number;
  servername: string | undefined;
};

/** Keep the public origin independent of the listener's loopback address. */
export function parseFixtureOrigin(value = 'https://localhost:8176'): FixtureOrigin {
  const invalid = () => new Error('invalid-fixture-https-origin');
  if (typeof value !== 'string' || !/^https:\/\/[^/?#@\\\s]+\/?$/i.test(value)) throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  const ip = isIP(hostname);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !hostname ||
    hostname.length > 253 ||
    (!ip &&
      !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
  )
    throw invalid();
  const port = Number(url.port || 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid();
  return {
    origin: url.origin,
    host: url.host,
    hostname,
    port,
    servername: ip ? undefined : hostname,
  };
}

export type FixtureCertificate = {
  hostname: string;
  selfSigned: true;
  fingerprint256: string;
  validFrom: string;
  validTo: string;
};

/** Certificate evidence contains no PEM, private key or temporary file path. */
export function validateFixtureCertificate(
  certificate: string | Buffer,
  privateKey: string | Buffer,
  hostname: string,
  now = Date.now(),
): FixtureCertificate {
  let parsed: X509Certificate;
  let matchesKey: boolean;
  try {
    parsed = new X509Certificate(certificate);
    matchesKey = parsed.checkPrivateKey(createPrivateKey(privateKey));
  } catch {
    throw new Error('invalid-fixture-certificate-or-key');
  }
  const hostMatches = isIP(hostname)
    ? parsed.checkIP(hostname)
    : parsed.checkHost(hostname, { subject: 'never', wildcards: false });
  if (!hostMatches) throw new Error('fixture-certificate-host-mismatch');
  if (!matchesKey) throw new Error('fixture-certificate-key-mismatch');
  if (parsed.subject !== parsed.issuer || !parsed.verify(parsed.publicKey))
    throw new Error('fixture-certificate-not-self-signed');
  const validFrom = Date.parse(parsed.validFrom);
  const validTo = Date.parse(parsed.validTo);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(validFrom) ||
    !Number.isFinite(validTo) ||
    validFrom > now ||
    validTo <= now ||
    validTo <= validFrom ||
    validTo - validFrom > certificateLifetime
  )
    throw new Error('fixture-certificate-invalid-validity');
  return {
    hostname,
    selfSigned: true,
    fingerprint256: parsed.fingerprint256,
    validFrom: new Date(validFrom).toISOString(),
    validTo: new Date(validTo).toISOString(),
  };
}

/** This directory is owned by one lane; cleanup never removes the caller's directory. */
export async function createBrowserstackCertificate(directory: string) {
  if (typeof directory !== 'string' || !directory.trim() || directory.includes('\0'))
    throw new Error('invalid-fixture-directory');
  const parent = resolve(directory);
  await mkdir(parent, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(parent, 'browserstack-'));
  const keyPath = join(temporaryDirectory, 'key.pem');
  const certPath = join(temporaryDirectory, 'cert.pem');
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= rm(temporaryDirectory, { recursive: true, force: true }));
  try {
    // OpenSSL preserves this mode when writing its output into the existing file.
    const keyFile = await open(keyPath, 'wx', 0o600);
    await keyFile.close();
    try {
      await runFile(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-sha256',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=bs-local.com',
          '-addext',
          'subjectAltName=DNS:bs-local.com,DNS:localhost,IP:127.0.0.1',
          '-keyout',
          keyPath,
          '-out',
          certPath,
        ],
        { timeout: 15_000, maxBuffer: 64 * 1024, windowsHide: true, shell: false },
      );
    } catch {
      throw new Error('fixture-certificate-generation-failed');
    }
    const [certificate, privateKey] = await Promise.all([readFile(certPath), readFile(keyPath)]);
    const metadata = validateFixtureCertificate(certificate, privateKey, 'bs-local.com');
    return { directory: temporaryDirectory, keyPath, certPath, certificate: metadata, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Fixture certificate creation and cleanup failed.',
      );
    }
    throw error;
  }
}

type DesktopFixture = Awaited<
  ReturnType<typeof import('./desktop-offline-fixture.ts').createDesktopOfflineFixture>
>;
export type BrowserstackFixture = DesktopFixture & { certificate: FixtureCertificate };

/** Reuse production accounts, images and storage; only TLS/origin differ from desktop. */
export async function createBrowserstackFixture(directory: string): Promise<BrowserstackFixture> {
  const tls = await createBrowserstackCertificate(directory);
  try {
    // Pure certificate/origin tests must not load the application or Univer runtime.
    const { createDesktopOfflineFixture } = await import('./desktop-offline-fixture.ts');
    const fixture = await createDesktopOfflineFixture({
      directory: join(tls.directory, 'app'),
      origin: browserstackOrigin,
      keyPath: tls.keyPath,
      certPath: tls.certPath,
    });
    const closeFixture = fixture.close;
    let closing: Promise<void> | undefined;
    function close() {
      closing ??= (async () => {
        const errors: unknown[] = [];
        try {
          await closeFixture();
        } catch (error) {
          errors.push(error);
        }
        try {
          await tls.close();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length)
          throw new AggregateError(errors, 'BrowserStack fixture teardown failed.');
      })();
      return closing;
    }
    // Preserve the existing transport getter instead of freezing its value in a spread.
    return Object.assign(fixture, { certificate: tls.certificate, close });
  } catch (error) {
    try {
      await tls.close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'BrowserStack fixture startup and cleanup failed.',
      );
    }
    throw error;
  }
}
