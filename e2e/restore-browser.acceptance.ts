/** Explicit, bounded acceptance: current production build, Linux supervisor and
 * local Chromium over HTTPS. No API mocks, seeded sessions or physical-device claim.
 * Run under the owner watchdog with the immutable current Dockerfile image ID. */
import { execFile, execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

const run = promisify(execFile);
const image = process.env.SPINEL_RESTORE_BROWSER_IMAGE;
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image))
  throw new Error(
    'Set SPINEL_RESTORE_BROWSER_IMAGE to the immutable ID of the current production Dockerfile build.',
  );
const project = resolve('.');
const output = resolve(
  process.env.SPINEL_RESTORE_BROWSER_EVIDENCE ?? 'test-results/spn112-real-browser',
);
const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-browser-'));
const container = `spinel-restore-browser-${randomUUID()}`;
const volume = `${container}-state`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let stage = 'initializing';
let browser: Browser | undefined;
let failurePage: Page | undefined;
let child: ChildProcess | undefined;
let exit: Promise<number | null> | undefined;
let succeeded = false;
let shutdownPromise: Promise<void> | undefined;
let containerExit: number | null | undefined;
let volumeDisposition:
  'not-created' | 'creation-unconfirmed' | 'retained' | 'cleanup-unconfirmed' | 'removed' =
  'not-created';
const sockets = new Set<Socket>();
const captures: Array<{ state: string; variant: string; filename: string }> = [];
const proxy = httpsServer();
const artifact: Record<string, unknown> = {
  scope:
    'Real production Admin browser flow with synthetic CDP passkey, Linux controller and disposable HTTPS proxy; not physical-device or remote-provider acceptance',
  startedAt: new Date().toISOString(),
  image,
  containerMemoryMiB: 1800,
  containerCpus: 2,
  volume,
  storage:
    'Durable Linux named volume for workspace/recovery; private host bind for source exchange and evidence only',
};

async function poll<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  ms = 60_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (value !== null && accept(value)) return value;
    if (child && child.exitCode !== null) throw new Error('Fixture exited before acceptance.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Bounded acceptance observation timed out.');
}
const privateJson = async <T>(name: string) =>
  JSON.parse(await readFile(join(directory, name), 'utf8')) as T;
function hostFile(path: string) {
  if (!path.startsWith('/fixture/')) throw new Error('Invalid fixture file reference.');
  const result = resolve(directory, path.slice('/fixture/'.length));
  if (relative(directory, result).startsWith('..'))
    throw new Error('Invalid fixture file reference.');
  return result;
}
async function capture(page: Page, state: string) {
  for (const [theme, width, variant] of [
    ['light', 1280, 'light'],
    ['dark', 1280, 'dark'],
    ['light', 390, 'phone'],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const modal = page.getByRole('dialog');
    if (!(await modal.count()))
      await page
        .getByRole('region', { name: 'Restore workspace', exact: true })
        .scrollIntoViewIfNeeded();
    const filename = `${state}-${variant}.png`;
    await page.screenshot({
      path: join(output, filename),
      animations: 'disabled',
      fullPage: false,
    });
    captures.push({ state, variant, filename });
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}
async function shutdown() {
  return (shutdownPromise ??= (async () => {
    // A timed-out ownership command may leave its Docker process running.
    await run('docker', ['rm', '--force', `${container}-init`], {
      timeout: 10_000,
      maxBuffer: 4096,
    }).catch(() => {});
    await browser?.close().catch(() => {});
    browser = undefined;
    if (child && child.exitCode === null) {
      await run('docker', ['stop', '--time', '30', container], {
        timeout: 40_000,
        maxBuffer: 4096,
      }).catch(() => {});
      const completed = await Promise.race([
        exit!,
        new Promise<null>((resolveWait) => setTimeout(() => resolveWait(null), 5000)),
      ]);
      containerExit = completed;
      if (completed === null && child.exitCode === null)
        await run('docker', ['kill', container], { timeout: 10_000, maxBuffer: 4096 }).catch(
          () => {},
        );
    }
    for (const socket of sockets) socket.destroy();
    proxy.closeAllConnections();
    if (proxy.listening)
      await new Promise<void>((resolveClose) => proxy.close(() => resolveClose()));
  })());
}

try {
  await mkdir(output, { recursive: true });
  artifact.sourceBase = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const productionSource = execFileSync(
    'docker',
    [
      'image',
      'inspect',
      image,
      '--format',
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
    ],
    { encoding: 'utf8' },
  ).trim();
  if (!/^[a-f0-9]{40}$/.test(productionSource))
    throw new Error('Production image requires its exact Git source label.');
  artifact.productionSource = productionSource;
  const sourceFiles = [
    'e2e/restore-browser.acceptance.ts',
    'e2e/restore-browser-fixture.ts',
    'web/BackupRestore.tsx',
    'web/BackupRestore.stories.tsx',
    'web/backup-restore.css',
    'web/AdminPage.tsx',
    'src/shared/restore.ts',
    'src/server/backup/restore-control.ts',
    'src/server/backup/restore-registry.ts',
    'src/server/backup/restore-routes.ts',
    'src/server/maintenance/supervisor.ts',
    'src/server/maintenance/supervisor-client.ts',
    'src/server/maintenance/restore-rpc.ts',
    'src/server/maintenance/restore-jobs.ts',
    'server/app.ts',
    'server/index.ts',
    'server/supervisor.ts',
    'scripts/deploy/maintenance.ts',
    'Dockerfile',
    'package-lock.json',
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(sourceFiles.map(async (path) => [path, hash(await readFile(path))])),
  );
  artifact.sourceHashes = sourceHashes;
  for (const [path, expected] of Object.entries(sourceHashes))
    if (
      !path.startsWith('e2e/') &&
      hash(execFileSync('git', ['show', `${productionSource}:${path}`])) !== expected
    )
      throw new Error('Current source differs from the production image source.');
  const probe = createServer();
  await new Promise<void>((resolveListen) => probe.listen(0, '127.0.0.1', resolveListen));
  const httpPort = (probe.address() as { port: number }).port;
  await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
  const keyFile = join(directory, 'tls-key.pem'),
    certFile = join(directory, 'tls-cert.pem');
  await run(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { timeout: 20_000, maxBuffer: 4096 },
  );
  proxy.setSecureContext({ key: await readFile(keyFile), cert: await readFile(certFile) });
  proxy.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  proxy.on('request', (request, response) => {
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: httpPort,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end('Fixture application unavailable.');
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
  proxy.on('upgrade', (request, socket, head) => {
    const upstream = connect(httpPort, '127.0.0.1', () => {
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`);
      for (let i = 0; i < request.rawHeaders.length; i += 2)
        upstream.write(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}\r\n`);
      upstream.write('\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
  });
  await new Promise<void>((resolveListen) => proxy.listen(0, '127.0.0.1', resolveListen));
  const origin = `https://localhost:${(proxy.address() as { port: number }).port}`;
  const credential = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = credential.publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(32).toString('base64url');
  const publicKey = Buffer.concat([
    Buffer.from([0xa5, 1, 2, 3, 0x26, 0x20, 1, 0x21, 0x58, 32]),
    Buffer.from(jwk.x!, 'base64url'),
    Buffer.from([0x22, 0x58, 32]),
    Buffer.from(jwk.y!, 'base64url'),
  ]);
  await writeFile(
    join(directory, 'bootstrap.json'),
    JSON.stringify({ origin, credentialId, publicKey: publicKey.toString('base64url') }),
    { mode: 0o600 },
  );
  stage = 'starting-linux-supervisor';
  volumeDisposition = 'creation-unconfirmed';
  await run('docker', ['volume', 'create', volume], { timeout: 15_000, maxBuffer: 4096 });
  volumeDisposition = 'retained';
  // The volume is empty here. Only its ownership is initialized as root; the
  // fixture, shipped CLI and application all run as the unprivileged fixture UID.
  await run(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      `${container}-init`,
      '--pull=never',
      '--memory=1800m',
      '--memory-swap=1800m',
      '--cpus=2',
      '--network=none',
      '--user',
      '0:0',
      '-v',
      `${volume}:/state`,
      image,
      'chown',
      `${process.getuid!()}:${process.getgid!()}`,
      '/state',
    ],
    { timeout: 15_000, maxBuffer: 4096 },
  );
  child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--pull=never',
      '--name',
      container,
      '--memory=1800m',
      '--memory-swap=1800m',
      '--cpus=2',
      '--user',
      `${process.getuid!()}:${process.getgid!()}`,
      '-p',
      `127.0.0.1:${httpPort}:3199`,
      '-v',
      `${join(project, 'e2e/restore-browser-fixture.ts')}:/app/e2e/restore-browser-fixture.ts:ro`,
      '-v',
      `${directory}:/fixture`,
      '-v',
      `${volume}:/state`,
      '-e',
      `SPINEL_IMAGE=${image}`,
      '-w',
      '/app',
      image,
      'node',
      '--max-old-space-size=128',
      'e2e/restore-browser-fixture.ts',
    ],
    { stdio: 'ignore' },
  );
  exit = new Promise((resolveExit) => child!.once('exit', resolveExit));
  child.on('error', () => {});
  const source = await poll(
    () =>
      privateJson<{ operatorId: string; archive: string; keyFile: string; sha256: string }>(
        'ready.json',
      ),
    (value) => !!value.operatorId,
  );
  const shipped = await privateJson<{
    image: string;
    sourceHashes: Record<string, string>;
    bundleHashes: Record<string, string>;
  }>('image-evidence.json');
  if (shipped.image !== image) throw new Error('Unexpected production image identity.');
  for (const [path, expected] of Object.entries(shipped.sourceHashes))
    if (hash(await readFile(path)) !== expected)
      throw new Error('Shipped server source does not match current source.');
  artifact.shippedImage = shipped;
  artifact.shippedCli = await privateJson('cli-proof.json');
  artifact.fixtureUid = process.getuid!();
  stage = 'authenticating-browser';
  browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  failurePage = page;
  page.setDefaultTimeout(30_000);
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await cdp.send('WebAuthn.addCredential', {
    authenticatorId,
    credential: {
      credentialId: Buffer.from(credentialId, 'base64url').toString('base64'),
      isResidentCredential: true,
      rpId: 'localhost',
      privateKey: credential.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      userHandle: Buffer.from(source.operatorId).toString('base64'),
      signCount: 0,
    },
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible();
  await page.goto(`${origin}/admin#health`);
  const restore = page.getByRole('region', { name: 'Restore workspace', exact: true });
  await expect(restore.getByRole('button', { name: 'Prepare restore', exact: true })).toBeEnabled();
  stage = 'preparing-through-admin';
  await restore.getByRole('button', { name: 'Prepare restore', exact: true }).click();
  const preparation = page.getByRole('dialog', { name: 'Prepare workspace restore', exact: true });
  const archiveChoice = page.waitForEvent('filechooser');
  await preparation.getByLabel('Encrypted workspace backup', { exact: true }).click();
  await (await archiveChoice).setFiles(hostFile(source.archive));
  const keyChoice = page.waitForEvent('filechooser');
  await preparation.getByLabel('Separate recovery key', { exact: true }).click();
  await (await keyChoice).setFiles(hostFile(source.keyFile));
  await preparation.getByRole('button', { name: 'Verify and prepare', exact: true }).click();
  await expect(restore.getByRole('button', { name: 'Review restore', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await capture(page, 'prepared-source');
  await restore.getByRole('button', { name: 'Review restore', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Restore this workspace?', exact: true });
  await expect(confirmation.getByText(source.sha256, { exact: true })).toBeVisible();
  await capture(page, 'loss-confirmation');
  await confirmation.getByRole('checkbox').check();
  stage = 'confirming-and-restoring';
  await confirmation
    .getByRole('button', { name: 'Verify and restore workspace', exact: true })
    .click();
  const terminal = await poll(
    () => privateJson<{ outcome: string; phase: string; sourceSha256: string }>('status.json'),
    (value) => value.outcome === 'candidate-committed' && value.phase === 'running',
    140_000,
  );
  if (terminal.sourceSha256 !== source.sha256) throw new Error('Unexpected committed source.');
  stage = 'authenticating-after-session-reset';
  await page.goto(`${origin}/admin#health`);
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible();
  await page.goto(`${origin}/admin#health`);
  await expect(restore.getByText(/^Backup restored\./)).toBeVisible();
  await expect(restore.getByText(source.sha256, { exact: true })).toBeVisible();
  await capture(page, 'restored-after-sign-in');
  if (pageErrors) throw new Error('Browser reported an application exception.');
  stage = 'closing-and-checking-content';
  await shutdown();
  const proof = await privateJson<{
    committed: boolean;
    restoredContent: boolean;
    originalSessionExcluded: boolean;
    counter: number;
    memoryLimitBytes: number | null;
    memoryPeakBytes: number | null;
  }>('closed-proof.json');
  if (
    !proof.committed ||
    !proof.restoredContent ||
    !proof.originalSessionExcluded ||
    containerExit !== 0 ||
    !Number.isSafeInteger(proof.counter) ||
    proof.counter < 4 ||
    proof.memoryLimitBytes !== 1800 * 1024 * 1024 ||
    !Number.isSafeInteger(proof.memoryPeakBytes) ||
    proof.memoryPeakBytes === null ||
    proof.memoryPeakBytes <= 0
  )
    throw new Error('Closed workspace proof did not pass.');
  for (const [path, expected] of Object.entries(sourceHashes))
    if (hash(await readFile(path)) !== expected)
      throw new Error('Source changed during browser acceptance.');
  artifact.closedProof = proof;
  artifact.pageErrors = pageErrors;
  succeeded = true;
  stage = 'passed';
} catch {
  // Never print raw Playwright call logs, file chooser paths, cookies or keys.
  await failurePage
    ?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' })
    .catch(() => {});
  console.error(`Restore browser acceptance failed during ${stage}.`);
  process.exitCode = 1;
} finally {
  await shutdown();
  if (succeeded) {
    try {
      volumeDisposition = 'cleanup-unconfirmed';
      await run('docker', ['volume', 'rm', volume], { timeout: 15_000, maxBuffer: 4096 });
      volumeDisposition = 'removed';
    } catch {
      succeeded = false;
      stage = 'volume-cleanup-incomplete';
      process.exitCode = 1;
    }
  }
  artifact.stage = stage;
  artifact.passed = succeeded;
  artifact.captures = captures;
  artifact.completedAt = new Date().toISOString();
  artifact.privateFixtureRetained = !succeeded;
  artifact.privateVolumeDisposition = volumeDisposition;
  await writeFile(join(output, 'evidence.json'), JSON.stringify(artifact, null, 2));
  if (succeeded) await rm(directory, { recursive: true, force: true });
}
