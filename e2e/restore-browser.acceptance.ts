/** Explicit, bounded acceptance: current production build, Linux supervisor and
 * local Chromium over HTTPS. No API mocks, seeded sessions or physical-device claim.
 * Run under the owner watchdog with the immutable current Dockerfile image ID. */
import { execFile, execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { validRestoreJobRecord } from '../src/server/maintenance/restore-jobs.ts';
import type { RestoreRichMetadata } from '../src/server/maintenance/restore-rich-fixture.ts';
import {
  prepareRichRestoreBoundary,
  verifyRestoredRichWorkspace,
} from './restore-rich-acceptance.ts';
import { expectNativeSheetValue } from './native-sheet-value.ts';
import { textPoint } from './doc-touch.ts';

const run = promisify(execFile);
const configuredImage = process.env.SPINEL_RESTORE_BROWSER_IMAGE;
if (!configuredImage || !/^sha256:[a-f0-9]{64}$/.test(configuredImage))
  throw new Error(
    'Set SPINEL_RESTORE_BROWSER_IMAGE to the immutable ID of the current production Dockerfile build.',
  );
// Preserve the validated string type across helper closures.
const image = configuredImage;
const project = resolve('.');
const output = resolve(
  process.env.SPINEL_RESTORE_BROWSER_EVIDENCE ?? 'test-results/spn112-real-browser',
);
const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-browser-'));
const container = `spinel-restore-browser-${randomUUID()}`;
const volume = `${container}-state`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const startedAt = Date.now();
let stage = 'initializing';
const stageTimings = [{ stage, elapsedMs: 0 }];
const setStage = (value: string) => {
  stage = value;
  stageTimings.push({ stage, elapsedMs: Date.now() - startedAt });
};
let browser: Browser | undefined;
let failurePage: Page | undefined;
let child: ChildProcess | undefined;
let exit: Promise<number | null> | undefined;
let succeeded = false;
let shutdownPromise: Promise<void> | undefined;
let containerExit: number | null | undefined;
let servingDeadline: ReturnType<typeof setTimeout> | undefined;
let deadlineExpired = false;
let interrupted = false;
let abortPromise: Promise<void> | undefined;
let servingCreated = false;
const helperNames = new Set<string>();
const profile = ['--memory=1024m', '--memory-swap=1024m', '--cpus=0.75', '--pids-limit=128'];
const fixtureUser = `${process.getuid!()}:${process.getgid!()}`;
let pageErrors = 0;
const browserTraffic: Array<{ kind: string; route: string; status?: number }> = [];
const routeClass = (address: string) => {
  const path = new URL(address).pathname;
  if (['/', '/sign-in', '/admin', '/api/auth/session', '/api/maintenance'].includes(path))
    return path;
  if (path.startsWith('/api/auth/')) return 'authentication';
  if (path.startsWith('/api/items/')) return 'workspace-item';
  if (path.startsWith('/assets/')) return 'public-asset';
  return 'other';
};
const observeTraffic = (value: (typeof browserTraffic)[number]) => {
  browserTraffic.push(value);
  if (browserTraffic.length > 80) browserTraffic.shift();
};
let volumeDisposition:
  'not-created' | 'creation-unconfirmed' | 'retained' | 'cleanup-unconfirmed' | 'removed' =
  'not-created';
const sockets = new Set<Socket>();
const captures: Array<{ state: string; variant: string; filename: string }> = [];
const proxy = httpsServer();
const artifact: Record<string, unknown> = {
  scope:
    'Real production Admin browser flow with synthetic CDP passkey, Linux controller and disposable HTTPS proxy; not physical-device or remote-provider acceptance',
  startedAt: new Date(startedAt).toISOString(),
  image,
  containerMemoryMiB: 1024,
  containerCpus: 0.75,
  containerPids: 128,
  supervisorOldSpaceMiB: 64,
  persistentServingFixtureProcesses: 0,
  bootstrapOldSpaceMiB: 256,
  coldProbeOldSpaceMiB: 128,
  observation: 'Host CLI and bounded file reads; shipped supervisor is container PID 1',
  volume,
  storage:
    'Durable Linux named volume for workspace/recovery; private host bind for source exchange and evidence only',
};

// These are the only source-tree exceptions. They are also literal build-context
// exclusions, pinned below; runtime fixtures and *.test.ts elsewhere are NOT exempt.
const imageException = (path: string) =>
  path.startsWith('docs/') || path.startsWith('e2e/') || /^lib\/[^/]+\/tests(?:\/|$)/.test(path);
const boundSource = (path: string) => !imageException(path) || path.startsWith('e2e/');
const dockerIgnoreRules = [
  '.git',
  'node_modules',
  'dist',
  'data',
  'test-results',
  'storybook-static',
  'playwright-report',
  '.env',
  '.env.*',
  '*.sqlite',
  '*.sqlite-*',
  '*.log',
  '*.pem',
  '*.key',
  'docs',
  'e2e',
  'lib/*/tests',
];
function knownDockerExclusion(path: string) {
  const first = path.split('/')[0];
  return (
    [
      '.git',
      'node_modules',
      'dist',
      'data',
      'test-results',
      'storybook-static',
      'playwright-report',
      'docs',
    ].includes(first) ||
    /^lib\/[^/]+\/tests(?:\/|$)/.test(path) ||
    // Root-only matching is deliberately conservative for ignored inventories.
    (!path.includes('/') &&
      (/^\.env(?:\..*)?$/.test(path) || /(?:\.sqlite(?:-.*)?|\.log|\.pem|\.key)$/.test(path)))
  );
}
type SourceEntry = { mode: string; oid: string };
function sourceTree(revision: string) {
  const records = execFileSync('git', ['ls-tree', '-r', '-z', revision], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const entries = new Map<string, SourceEntry>();
  for (const record of records) {
    const match = /^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(record);
    if (!match || match[4].startsWith('/') || match[4].split('/').includes('..'))
      throw new Error('Unsupported source tree entry.');
    if (!boundSource(match[4])) continue;
    if (match[2] !== 'blob' || !['100644', '100755'].includes(match[1]))
      throw new Error('Source manifest refuses symlinks and submodules.');
    entries.set(match[4], { mode: match[1], oid: match[3] });
  }
  return entries;
}
async function verifySourceIdentity(head: string, imageRevision: string) {
  const current = sourceTree(head),
    built = sourceTree(imageRevision);
  const production = (tree: Map<string, SourceEntry>) =>
    [...tree].filter(([path]) => !imageException(path));
  if (JSON.stringify(production(current)) !== JSON.stringify(production(built)))
    throw new Error('Production input tree differs from the immutable image revision.');
  const rules = (await readFile('.dockerignore', 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (JSON.stringify(rules) !== JSON.stringify(dockerIgnoreRules))
    throw new Error('Docker context exclusions changed; source policy requires review.');
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z', head], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  if (staged.some(boundSource)) throw new Error('Staged source differs from the reviewed head.');
  for (const ignored of [false, true]) {
    const inventory = execFileSync(
      'git',
      [
        'ls-files',
        '--others',
        ...(ignored ? ['--ignored'] : []),
        '--exclude-standard',
        '--directory',
        '-z',
      ],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    )
      .split('\0')
      .filter(Boolean);
    // In particular output/ and baseline-callback-source/ are gitignored but
    // NOT Dockerignored. Reject them rather than attest to a tracked-only context.
    if (inventory.some((path) => !knownDockerExclusion(path)))
      throw new Error(
        'Untracked Docker-context or host-acceptance inputs require a clean snapshot.',
      );
  }
  const hashes: Record<string, string> = {};
  const installedLibraryHashes: Record<string, string> = {};
  const packages = new Map<string, string>();
  for (const [path, entry] of current) {
    const info = await lstat(path);
    if (!info.isFile() || (info.mode & 0o111 ? '100755' : '100644') !== entry.mode)
      throw new Error('Working source type or mode differs from the reviewed tree.');
    const bytes = await readFile(path);
    const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (oid !== entry.oid) throw new Error('Working source bytes differ from the reviewed tree.');
    hashes[path] = hash(bytes);
    const library = /^lib\/([^/]+)\/(.+)$/.exec(path);
    if (library) {
      let name = packages.get(library[1]);
      if (!name) {
        const manifest = JSON.parse(await readFile(`lib/${library[1]}/package.json`, 'utf8'));
        if (typeof manifest.name !== 'string' || !/^@spinel\/[a-z0-9-]+$/.test(manifest.name))
          throw new Error('Unexpected installed workspace package identity.');
        name = manifest.name as string;
        packages.set(library[1], name);
      }
      const installed = join('node_modules', name, library[2]);
      const installedInfo = await lstat(installed);
      if (
        !installedInfo.isFile() ||
        (installedInfo.mode & 0o111 ? '100755' : '100644') !== entry.mode ||
        hash(await readFile(installed)) !== hashes[path]
      )
        throw new Error('Installed workspace source differs from the reviewed tree.');
      installedLibraryHashes[path] = hashes[path];
    }
  }
  return {
    hashes,
    installedLibraryHashes,
    productionEntries: production(current).length,
    productionManifestSha256: hash(Buffer.from(JSON.stringify(production(current)))),
    exceptions: ['docs/', 'e2e/ (host files separately pinned)', 'lib/<workspace>/tests/'],
    ignoredInventory: 'Checked with --directory; non-Dockerignored drift refused',
  };
}

async function poll<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  ms = 60_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (value !== null && accept(value)) return value;
    if (child && child.exitCode !== null)
      throw new Error('Shipped supervisor exited before acceptance.');
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
async function capture(page: Page, state: string, restoreRegion = true) {
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
    if (restoreRegion && !(await modal.count()))
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
type ContainerState = { running: boolean; pid: number; exitCode: number; oomKilled: boolean };
async function containerState(name: string): Promise<ContainerState> {
  const { stdout } = await run('docker', ['inspect', '--format', '{{json .State}}', name], {
    timeout: 10_000,
    maxBuffer: 16_384,
  });
  const value = JSON.parse(stdout);
  if (
    typeof value.Running !== 'boolean' ||
    !Number.isInteger(value.Pid) ||
    !Number.isInteger(value.ExitCode) ||
    typeof value.OOMKilled !== 'boolean'
  )
    throw new Error('Invalid container ownership observation.');
  return {
    running: value.Running,
    pid: value.Pid,
    exitCode: value.ExitCode,
    oomKilled: value.OOMKilled,
  };
}
async function removeOwnedContainer(name: string, force: boolean) {
  await run('docker', ['rm', ...(force ? ['--force'] : []), name], {
    timeout: 10_000,
    maxBuffer: 4096,
  }).catch(() => {});
  const absent = await run(
    'docker',
    ['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'],
    { timeout: 10_000, maxBuffer: 4096 },
  ).then(
    (result) => result.stdout.trim() === '',
    () => false,
  );
  const cleanup = (artifact.containerCleanup ??= {}) as Record<string, string>;
  cleanup[name] = absent ? 'confirmed-absent' : 'unconfirmed';
  return absent;
}
async function helper(mode: 'bootstrap' | 'cold') {
  if (interrupted || deadlineExpired) throw new Error('Acceptance was interrupted.');
  const name = `${container}-${mode}`;
  const runId = randomUUID();
  artifact[`${mode}RunId`] = runId;
  helperNames.add(name); // Include uncertain launches in bounded failure containment.
  try {
    await run(
      'docker',
      [
        'run',
        '--pull=never',
        '--name',
        name,
        ...profile,
        '--network=none',
        '--user',
        fixtureUser,
        '-v',
        `${join(project, 'e2e/restore-browser-fixture.ts')}:/app/e2e/restore-browser-fixture.ts:ro`,
        '-v',
        `${directory}:/fixture`,
        '-v',
        `${volume}:/state${mode === 'cold' ? ':ro' : ''}`,
        '-e',
        `SPINEL_IMAGE=${image}`,
        '-e',
        `SPINEL_RESTORE_HELPER_RUN=${runId}`,
        '-w',
        '/app',
        image,
        'node',
        `--process-timeout=${mode === 'bootstrap' ? 40 : 15}s`,
        `--max-old-space-size=${mode === 'bootstrap' ? 256 : 128}`,
        '--max-semi-space-size=8',
        'e2e/restore-browser-fixture.ts',
        `--${mode}`,
      ],
      { timeout: mode === 'bootstrap' ? 45_000 : 20_000, maxBuffer: 4096 },
    );
  } catch (error) {
    // execFile can reject before the usual inspection. Preserve bounded typed
    // evidence before finally removes the exact owned container.
    artifact[`${mode}Closure`] = await containerState(name).catch(() => null);
    const failed = error as { code?: unknown; signal?: unknown; stderr?: unknown };
    const stderr = typeof failed.stderr === 'string' ? failed.stderr.slice(-4096) : '';
    const sourceLine = /restore-browser-fixture\.ts:(\d+):\d+/.exec(stderr)?.[1];
    const code =
      /\b(SQLITE_(?:READONLY|CANTOPEN|IOERR|BUSY|LOCKED|NOTADB|CORRUPT|ERROR|MISUSE)(?:_[A-Z]{1,24})?|EROFS|ENOENT|EACCES)\b/.exec(
        stderr,
      )?.[1] ?? null;
    const raw =
      mode === 'cold'
        ? await privateJson<Record<string, unknown>>('cold-diagnostic.json').catch(() => null)
        : null;
    const diagnostic = raw?.runId === runId ? raw : null;
    const failure = diagnostic?.failure as Record<string, unknown> | null | undefined;
    const stages = [
      'closure',
      'canonical-record',
      'source-group',
      'copy-group',
      'copy-verification',
      'database-open',
      'content-query',
      'sidecar-observation',
      'session-query',
      'counter-query',
      'assertions',
      'database-close',
      'source-recheck',
      'complete',
    ];
    const diagnosticCode = failure?.code;
    artifact.helperFailure = {
      mode,
      runId,
      exitCode:
        typeof failed.code === 'number' && Number.isSafeInteger(failed.code) ? failed.code : null,
      signal: failed.signal === 'SIGTERM' || failed.signal === 'SIGKILL' ? failed.signal : null,
      sourceLine: sourceLine ? Number(sourceLine) : null,
      code,
      cold: diagnostic
        ? {
            stage:
              typeof diagnostic.stage === 'string' && stages.includes(diagnostic.stage)
                ? diagnostic.stage
                : null,
            sourceUnchanged: diagnostic.sourceUnchanged === true,
            sourceLine:
              typeof failure?.sourceLine === 'number' &&
              Number.isSafeInteger(failure.sourceLine) &&
              failure.sourceLine > 0
                ? failure.sourceLine
                : null,
            code:
              typeof diagnosticCode === 'string' &&
              /^(?:SQLITE_(?:READONLY|CANTOPEN|IOERR|BUSY|LOCKED|NOTADB|CORRUPT|ERROR|MISUSE)(?:_[A-Z]{1,24})?|EROFS|ENOENT|EACCES)$/.test(
                diagnosticCode,
              )
                ? diagnosticCode
                : typeof diagnosticCode === 'number' && Number.isSafeInteger(diagnosticCode)
                  ? diagnosticCode
                  : null,
          }
        : null,
    };
    throw new Error('Acceptance helper failed; bounded diagnostics retained.');
  }
  const state = await containerState(name);
  artifact[`${mode}Closure`] = state;
  if (state.running || state.pid !== 0 || state.exitCode !== 0 || state.oomKilled)
    throw new Error('Acceptance helper did not close successfully.');
  if (!(await removeOwnedContainer(name, false)))
    throw new Error('Helper removal remains unconfirmed.');
  helperNames.delete(name);
}
async function servingRead(path: string, maxBuffer = 32_768) {
  const { stdout } = await run('docker', ['exec', container, 'cat', path], {
    timeout: 5000,
    maxBuffer,
  });
  return stdout;
}
async function observeOutcome() {
  const { stdout } = await run(
    'docker',
    ['exec', container, 'ls', '-1', '/state/recovery/restore-jobs'],
    {
      timeout: 5000,
      maxBuffer: 4096,
    },
  );
  const names = stdout.trim().split('\n').filter(Boolean);
  if (names.length !== 1 || !/^[a-f0-9-]{36}$/.test(names[0])) return null;
  const value: unknown = JSON.parse(
    await servingRead(`/state/recovery/restore-jobs/${names[0]}/state.json`, 1024 * 1024),
  );
  if (!validRestoreJobRecord(value, names[0]))
    throw new Error('Invalid canonical outcome evidence.');
  const journal = JSON.parse(await servingRead('/state/recovery/journal.json'));
  const trial = value.execution?.trial;
  return {
    outcome: value.phase,
    phase: journal.phase,
    sourceSha256: value.intent.source.archive.sha256,
    selected:
      !!trial &&
      trial.generationId === journal.generationId &&
      trial.epoch === journal.epoch &&
      journal.restoreJob == null &&
      ['pid', 'start', 'boot', 'token'].every(
        (key) => journal.child?.[key] === trial.child[key as keyof typeof trial.child],
      ),
  };
}
async function servingResources() {
  const number = async (path: string) => {
    const text = (await servingRead(path)).trim();
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
      throw new Error('Invalid serving resource measurement.');
    return Number(text);
  };
  // Sequential tiny cat processes do not load another Node/SDK in the serving cgroup.
  return {
    memoryLimitBytes: await number('/sys/fs/cgroup/memory.max'),
    swapLimitBytes: await number('/sys/fs/cgroup/memory.swap.max'),
    cpuMax: (await servingRead('/sys/fs/cgroup/cpu.max')).trim(),
    pidsMax: await number('/sys/fs/cgroup/pids.max'),
    memoryPeakBytes: await number('/sys/fs/cgroup/memory.peak'),
    memoryCurrentBytes: await number('/sys/fs/cgroup/memory.current'),
    peakScope: 'Serving cgroup through pre-shutdown observation; excludes later cold helper',
  };
}
async function shutdown() {
  return (shutdownPromise ??= (async () => {
    if (servingDeadline) clearTimeout(servingDeadline);
    await browser?.close().catch(() => {});
    browser = undefined;
    // A timed-out Docker client can leave its owned helper container alive.
    for (const name of [`${container}-init`, ...helperNames])
      await removeOwnedContainer(name, true);
    if (servingCreated) {
      artifact.servingResources = await servingResources().catch(() => null);
      await run('docker', ['stop', '--time', '30', container], {
        timeout: 40_000,
        maxBuffer: 4096,
      }).catch(() => {});
      if (exit) {
        const completed = await Promise.race([
          exit,
          new Promise<null>((resolveWait) => {
            const timer = setTimeout(() => resolveWait(null), 5000);
            timer.unref();
          }),
        ]);
        artifact.attachedDockerExit = completed;
      }
      let state = await containerState(container).catch(() => null);
      if (!state || state.running || state.pid !== 0) {
        await run('docker', ['kill', container], { timeout: 10_000, maxBuffer: 4096 }).catch(
          () => {},
        );
        state = await containerState(container).catch(() => null);
      }
      artifact.supervisorClosure = state;
      const logs = await run('docker', ['logs', '--tail', '30', container], {
        timeout: 5000,
        maxBuffer: 16_384,
      }).catch(() => null);
      if (logs) {
        const tail = (logs.stderr + logs.stdout).slice(-16_384);
        const errno = /errno:\s*(-?\d{1,8})/.exec(tail)?.[1];
        artifact.serviceDiagnostic = {
          errorCode: /code:\s*['"](E[A-Z0-9_]{1,63})['"]/.exec(tail)?.[1] ?? null,
          errno: errno === undefined ? null : Number(errno),
          syscall:
            /syscall:\s*['"](listen|bind|open|chmod|stat|read|unlink)['"]/.exec(tail)?.[1] ?? null,
        };
      } // Raw process logs, paths and source material are never persisted.

      if (
        state &&
        !state.running &&
        state.pid === 0 &&
        state.exitCode === 0 &&
        !state.oomKilled &&
        artifact.attachedDockerExit === 0
      ) {
        containerExit = state.exitCode;
        await writeFile(
          join(directory, 'supervisor-closed.json'),
          JSON.stringify({
            image,
            container,
            ...state,
            confirmedAt: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
      }
    }
    for (const socket of sockets) socket.destroy();
    proxy.closeAllConnections();
    if (proxy.listening)
      await new Promise<void>((resolveClose) => proxy.close(() => resolveClose()));
  })());
}

function interrupt(signal: 'SIGTERM' | 'SIGINT') {
  interrupted = true;
  deadlineExpired = true;
  process.exitCode = 1;
  // The owner watchdog allows only five seconds before SIGKILL. Immediately
  // contain exact registered containers; do not spend that grace on a normal
  // application drain. Interrupted evidence/volumes are always retained.
  abortPromise ??= (async () => {
    artifact.interrupted = signal;
    await Promise.all(
      [...(servingCreated ? [container] : []), ...helperNames, `${container}-init`].map((name) =>
        run('docker', ['kill', name], {
          timeout: 3000,
          maxBuffer: 4096,
        }).catch(() => {}),
      ),
    );
    await writeFile(
      join(directory, 'interrupted.json'),
      JSON.stringify({ signal, stage, container, volume }),
      { mode: 0o600 },
    );
    await shutdown();
  })();
  void abortPromise.catch(() => {});
}
process.once('SIGTERM', () => interrupt('SIGTERM'));
process.once('SIGINT', () => interrupt('SIGINT'));

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
  const sourceIdentity = await verifySourceIdentity(
    artifact.sourceBase as string,
    productionSource,
  );
  const { hashes: sourceHashes, ...identitySummary } = sourceIdentity;
  artifact.sourceHashes = sourceHashes;
  artifact.productionInputIdentity = identitySummary;
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
  const makeCredential = () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = pair.publicKey.export({ format: 'jwk' });
    return {
      credentialId: randomBytes(32).toString('base64url'),
      publicKey: Buffer.concat([
        Buffer.from([0xa5, 1, 2, 3, 0x26, 0x20, 1, 0x21, 0x58, 32]),
        Buffer.from(jwk.x!, 'base64url'),
        Buffer.from([0x22, 0x58, 32]),
        Buffer.from(jwk.y!, 'base64url'),
      ]).toString('base64url'),
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    };
  };
  const credentials = {
    operator: makeCredential(),
    owner: makeCredential(),
    reader: makeCredential(),
  };
  const publicCredential = (value: ReturnType<typeof makeCredential>) => ({
    credentialId: value.credentialId,
    publicKey: value.publicKey,
  });
  await writeFile(
    join(directory, 'bootstrap.json'),
    JSON.stringify({
      origin,
      ...publicCredential(credentials.operator),
      owner: publicCredential(credentials.owner),
      reader: publicCredential(credentials.reader),
    }),
    { mode: 0o600 },
  );
  setStage('starting-linux-supervisor');
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
      '--memory=1024m',
      '--memory-swap=1024m',
      '--cpus=0.75',
      '--pids-limit=128',
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
  setStage('bootstrapping-closed-workspace');
  await helper('bootstrap');
  setStage('starting-shipped-supervisor');
  if (interrupted) throw new Error('Acceptance was interrupted.');
  servingCreated = true;
  child = spawn(
    'docker',
    [
      'run',
      '--pull=never',
      '--name',
      container,
      ...profile,
      '--user',
      fixtureUser,
      '-p',
      `127.0.0.1:${httpPort}:3199`,
      '-v',
      `${volume}:/state`,
      '-e',
      `SPINEL_IMAGE=${image}`,
      '-e',
      'DATABASE_PATH=/state/data/workspace.sqlite',
      '-e',
      `APP_ORIGIN=${origin}`,
      '-e',
      'SPINEL_MAINTENANCE_ROOT=/state/recovery',
      '-e',
      'SPINEL_MAINTENANCE_PORT=0',
      '-e',
      'SPINEL_STATIC_DIRECTORY=/app/dist',
      '-e',
      'PORT=3199',
      '-e',
      'HOST=0.0.0.0',
      '-e',
      'BACKUP_CONFIG_PATH=/state/data/absent-backup-config',
      '-w',
      '/app',
      image,
      'node',
      '--max-old-space-size=64',
      '/app/server/supervisor.ts',
    ],
    { stdio: 'ignore' },
  );
  exit = new Promise((resolveExit) => child!.once('close', resolveExit));
  child.on('error', () => {});
  const control = async (action: string, operationId?: string) => {
    if (interrupted) throw new Error('Acceptance was interrupted.');
    const result = await run(
      'docker',
      [
        'exec',
        container,
        'node',
        '--max-old-space-size=64',
        '/app/scripts/deploy/maintenance.ts',
        action,
        ...(operationId ? ['--operation', operationId] : []),
      ],
      { timeout: 70_000, maxBuffer: 32_768 },
    );
    return JSON.parse(result.stdout) as { phase: string };
  };
  const initial = await poll(
    () => control('status'),
    (value) => typeof value.phase === 'string',
    30_000,
  );
  const command = (await servingRead('/proc/1/cmdline', 4096)).split('\0').filter(Boolean);
  if (
    command.length !== 3 ||
    !/^(?:.*\/)?node$/.test(command[0]) ||
    command[1] !== '--max-old-space-size=64' ||
    command[2] !== '/app/server/supervisor.ts'
  )
    throw new Error('Shipped supervisor is not the expected container PID 1.');
  const pid1Status = await servingRead('/proc/1/status', 16_384);
  const parentPid = Number(/^PPid:\s+(\d+)$/m.exec(pid1Status)?.[1]);
  const userIds = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m.exec(pid1Status)?.slice(1).map(Number);
  if (parentPid !== 0 || !userIds || userIds.some((uid) => uid !== process.getuid!()))
    throw new Error('Unexpected shipped supervisor process ownership.');
  artifact.servingPid1 = { pid: 1, parentPid, userIds, command };
  const operationId = randomUUID();
  setStage('cli-verify');
  await control('verify', operationId);
  setStage('cli-start');
  await control('start', operationId);
  setStage('cli-resume');
  const resumed = await control('resume', operationId);
  if (resumed.phase !== 'running') throw new Error('Shipped CLI did not resume workspace.');
  artifact.shippedCli = {
    initial: initial.phase,
    verify: true,
    start: true,
    resume: resumed.phase,
  };
  servingDeadline = setTimeout(() => {
    deadlineExpired = true;
    void shutdown();
  }, 5 * 60_000);
  const source = await poll(
    () =>
      privateJson<{
        operatorId: string;
        archive: string;
        keyFile: string;
        sha256: string;
        rich: RestoreRichMetadata;
      }>('ready.json'),
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
  artifact.fixtureUid = process.getuid!();
  setStage('authenticating-browser');
  browser = await chromium.launch();
  const createActor = async (credential: ReturnType<typeof makeCredential>, userId: string) => {
    const context = await browser!.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 1000 },
      reducedMotion: 'reduce',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', () => pageErrors++);
    page.on('response', (response) =>
      observeTraffic({
        kind: 'response',
        route: routeClass(response.url()),
        status: response.status(),
      }),
    );
    page.on('requestfailed', (request) =>
      observeTraffic({ kind: 'failed', route: routeClass(request.url()) }),
    );
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame())
        observeTraffic({ kind: 'navigation', route: routeClass(frame.url()) });
    });
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
        credentialId: Buffer.from(credential.credentialId, 'base64url').toString('base64'),
        isResidentCredential: true,
        rpId: 'localhost',
        privateKey: credential.privateKey,
        userHandle: Buffer.from(userId).toString('base64'),
        signCount: 0,
      },
    });
    const signIn = async () => {
      failurePage = page;
      await page.goto(origin);
      await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
      await expect
        .poll(async () => {
          const response = await context.request.get(`${origin}/api/auth/session`);
          return response.status() === 200 ? (await response.json()).user?.id : null;
        })
        .toBe(userId);
      // A verified cookie and disappeared passkey button can precede the
      // authentication redirect and everyday-account runtime admission.
      // Do not navigate away until the real destination has settled.
      await expect(page.getByRole('region', { name: 'Your files', exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('status').filter({ hasText: /^Loading…$/ })).toHaveCount(0, {
        timeout: 30_000,
      });
    };
    return { context, page, signIn };
  };
  const operator = await createActor(credentials.operator, source.operatorId);
  const { page } = operator;
  failurePage = page;
  await page.goto(origin);
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible();
  await page.goto(`${origin}/admin#health`);
  const restore = page.getByRole('region', { name: 'Restore workspace', exact: true });
  await expect(restore.getByRole('button', { name: 'Prepare restore', exact: true })).toBeEnabled();
  setStage('authenticating-current-owner');
  const owner = await createActor(credentials.owner, source.rich.ownerId);
  await owner.signIn();
  const boundary = await prepareRichRestoreBoundary(source.rich, owner.context.request, origin);
  // Keep this real passkey and cookie alive across the restore without an open editor.
  await owner.page.goto('about:blank');
  failurePage = page;
  await page.bringToFront();
  setStage('preparing-through-admin');
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
  setStage('confirming-and-restoring');
  await confirmation
    .getByRole('button', { name: 'Verify and restore workspace', exact: true })
    .click();
  const terminal = await poll(
    observeOutcome,
    (value) =>
      value !== null &&
      value.outcome === 'candidate-committed' &&
      value.phase === 'running' &&
      value.selected,
    140_000,
  );
  if (!terminal || terminal.sourceSha256 !== source.sha256)
    throw new Error('Unexpected committed source.');
  setStage('checking-owner-session-reset');
  expect((await owner.context.request.get(`${origin}/api/auth/session`)).status()).toBe(401);
  setStage('authenticating-after-session-reset');
  await page.goto(`${origin}/admin#health`);
  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible();
  await page.goto(`${origin}/admin#health`);
  await expect(restore.getByText(/^Backup restored\./)).toBeVisible();
  await expect(restore.getByText(source.sha256, { exact: true })).toBeVisible();
  await capture(page, 'restored-after-sign-in');
  setStage('checking-rich-restored-workspace');
  await page.goto('about:blank');
  await owner.signIn();
  const reader = await createActor(credentials.reader, source.rich.readerId);
  await reader.signIn();
  await reader.page.goto('about:blank');
  artifact.richWorkspace = await verifyRestoredRichWorkspace(
    source.rich,
    { owner: owner.context.request, reader: reader.context.request },
    origin,
    boundary,
  );
  failurePage = owner.page;
  setStage('rendering-restored-document');
  await owner.page.goto(`${origin}/?item=${source.rich.docId}`);
  const doc = owner.page.getByRole('region', { name: 'Doc document', exact: true });
  await expect(doc.getByLabel('Document canvas', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(doc.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
    timeout: 30_000,
  });
  // Real raster evidence: visible text glyphs and the archived purple image, not just a mounted canvas.
  const ink = await textPoint(owner.page);
  const purplePixels = () =>
    doc.locator('canvas').evaluateAll((canvases) => {
      let count = 0;
      for (const node of canvases) {
        const canvas = node as HTMLCanvasElement;
        if (!canvas.width || !canvas.height) continue;
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (data)
          for (let i = 0; i < data.length; i += 4)
            if (data[i] === 116 && data[i + 1] === 56 && data[i + 2] === 174 && data[i + 3] === 255)
              count++;
      }
      return count;
    });
  await expect.poll(purplePixels).toBeGreaterThan(24);
  await capture(owner.page, 'restored-owner-document', false);
  // Select through the visible native text, then read its real Copy action.
  // This proves the expected text reached the editor rather than only its API.
  await owner.page.bringToFront();
  await owner.page.evaluate(
    (value) => navigator.clipboard.writeText(value),
    `not-copied-${randomUUID()}`,
  );
  const copyPoint = await textPoint(owner.page);
  await owner.page.mouse.click(copyPoint.x, copyPoint.y);
  await expect(doc.locator('[contenteditable="true"][data-u-comp="editor"]').first()).toBeFocused();
  await owner.page.keyboard.press('ControlOrMeta+a');
  await owner.page.keyboard.press('ControlOrMeta+c');
  await expect
    .poll(() => owner.page.evaluate(() => navigator.clipboard.readText()))
    .toContain(source.rich.expectedDocText.replace(/[\b\r\n]/g, ''));
  await owner.page.keyboard.press('Escape');
  setStage('rendering-restored-sheet');
  await owner.page.goto(`${origin}/?item=${source.rich.sheetId}`);
  const sheet = owner.page.getByRole('region', { name: 'Sheet document', exact: true });
  await expect(sheet.getByLabel('Spreadsheet grid', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(sheet.getByRole('status', { name: 'Save status' })).toHaveText(
    'All changes saved.',
    { timeout: 30_000 },
  );
  await expectNativeSheetValue(owner.page, 'A1', source.rich.expectedSheetValue, 'ControlOrMeta+c');
  await capture(owner.page, 'restored-owner-sheet', false);
  await owner.page.goto('about:blank');
  setStage('rendering-restored-reader');
  failurePage = reader.page;
  await reader.page.goto(`${origin}/?item=${source.rich.docId}`);
  const readerDoc = reader.page.getByRole('region', { name: 'Doc document', exact: true });
  await expect(readerDoc.getByLabel('Document canvas', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(readerDoc.getByRole('status', { name: 'Save status' })).toHaveText(
    'View only — reload after your access changes.',
    { timeout: 30_000 },
  );
  await textPoint(reader.page);
  await capture(reader.page, 'restored-reader-document', false);
  artifact.nativeRendering = {
    ownerDoc: true,
    ownerSheet: true,
    readerDoc: true,
    visibleDocumentInkPixels: ink.pixels,
    archivedImageRendered: true,
    documentNativeCopy: true,
    sheetA1NativeCopy: source.rich.expectedSheetValue,
    originalOwnerSessionExcluded: true,
  };
  if (pageErrors) throw new Error('Browser reported an application exception.');
  setStage('closing-and-checking-content');
  await shutdown();
  if (containerExit !== 0 || deadlineExpired)
    throw new Error('Confirmed clean supervisor closure required.');
  await helper('cold');
  const coldProof = await privateJson<{
    committed: boolean;
    helperRunId: string;
    sourceUnchanged: boolean;
    restoredContent: boolean;
    originalSessionExcluded: boolean;
    counter: number;
  }>('closed-proof.json');
  const proof = {
    ...coldProof,
    ...(artifact.servingResources as Awaited<ReturnType<typeof servingResources>>),
  };
  if (
    !proof.committed ||
    proof.helperRunId !== artifact.coldRunId ||
    !proof.sourceUnchanged ||
    !proof.restoredContent ||
    !proof.originalSessionExcluded ||
    containerExit !== 0 ||
    !Number.isSafeInteger(proof.counter) ||
    proof.counter < 4 ||
    proof.memoryLimitBytes !== 1024 * 1024 * 1024 ||
    proof.swapLimitBytes !== 0 ||
    proof.cpuMax !== '75000 100000' ||
    proof.pidsMax !== 128 ||
    !Number.isSafeInteger(proof.memoryPeakBytes) ||
    proof.memoryPeakBytes === null ||
    proof.memoryPeakBytes <= 0
  )
    throw new Error('Closed workspace proof did not pass.');
  if (
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== artifact.sourceBase
  )
    throw new Error('Reviewed head changed during acceptance.');
  const finalIdentity = await verifySourceIdentity(artifact.sourceBase as string, productionSource);
  if (JSON.stringify(finalIdentity) !== JSON.stringify(sourceIdentity))
    throw new Error('Source or installed library identity changed during acceptance.');
  artifact.sourceIdentityRechecked = true;
  if (interrupted || deadlineExpired) throw new Error('Acceptance was interrupted.');
  artifact.closedProof = proof;
  artifact.pageErrors = pageErrors;
  succeeded = true;
  setStage('passed');
} catch (error) {
  // The reviewed source location helps diagnose a failed assertion without
  // persisting its message/expected/actual payload, which could contain secrets.
  const location =
    error instanceof Error
      ? /(?:^|\/)(restore-(?:browser\.acceptance|rich-acceptance)\.ts):(\d+):(\d+)/m.exec(
          error.stack ?? '',
        )
      : null;
  if (location)
    artifact.failureSource = {
      file: location[1],
      line: Number(location[2]),
      column: Number(location[3]),
    };
  artifact.pageErrors = pageErrors;
  artifact.browserTraffic = browserTraffic;
  let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    artifact.browserBootstrap = await Promise.race([
      failurePage?.evaluate(async () => {
        const keys = Object.keys(localStorage);
        const active = keys.filter((key) => key.startsWith('spinel.auth.active:'));
        const phases = { network: 0, prompt: 0, unknown: 0 };
        for (const key of active) {
          try {
            const phase: unknown = JSON.parse(localStorage.getItem(key) ?? '{}').phase;
            if (phase === 'network' || phase === 'prompt') phases[phase]++;
            else phases.unknown++;
          } catch {
            phases.unknown++;
          }
        }
        const locks = await navigator.locks.query();
        return {
          readyState: document.readyState,
          visible: document.visibilityState === 'visible',
          authMarkerPhases: phases,
          heldLocks: locks.held?.length ?? 0,
          pendingLocks: locks.pending?.length ?? 0,
          heldAuthLocks:
            locks.held?.filter((lock) => lock.name === 'spinel-auth-transition').length ?? 0,
          pendingAuthLocks:
            locks.pending?.filter((lock) => lock.name === 'spinel-auth-transition').length ?? 0,
          pendingExit: localStorage.getItem('spinel.offline.sign-out') !== null,
          serviceWorkerControlled: Boolean(navigator.serviceWorker.controller),
        };
      }),
      new Promise<null>((resolveTimeout) => {
        diagnosticTimer = setTimeout(() => resolveTimeout(null), 5000);
      }),
    ]);
  } catch {
    artifact.browserBootstrap = null;
  } finally {
    if (diagnosticTimer) clearTimeout(diagnosticTimer);
  }
  // Never print raw Playwright call logs, file chooser paths, cookies or keys.
  await failurePage
    ?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' })
    .catch(() => {});
  console.error(`Restore browser acceptance failed during ${stage}.`);
  process.exitCode = 1;
} finally {
  await shutdown();
  // Cold helper may fail after shutdown's initial containment. Keep all volumes
  // and private evidence on any failure; remove only exact task-owned containers.
  for (const name of helperNames) await removeOwnedContainer(name, true);
  if (servingCreated && !(await removeOwnedContainer(container, containerExit !== 0))) {
    succeeded = false;
    process.exitCode = 1;
  }
  if (interrupted) succeeded = false;
  if (succeeded) {
    try {
      volumeDisposition = 'cleanup-unconfirmed';
      await run('docker', ['volume', 'rm', volume], { timeout: 15_000, maxBuffer: 4096 });
      volumeDisposition = 'removed';
    } catch {
      succeeded = false;
      setStage('volume-cleanup-incomplete');
      process.exitCode = 1;
    }
  }
  artifact.stage = stage;
  artifact.stageTimings = stageTimings;
  artifact.elapsedMs = Date.now() - startedAt;
  artifact.finalStageElapsedMs = Date.now() - startedAt - stageTimings.at(-1)!.elapsedMs;
  artifact.passed = succeeded;
  artifact.captures = captures;
  artifact.completedAt = new Date().toISOString();
  artifact.privateFixtureRetained = !succeeded;
  artifact.privateVolumeDisposition = volumeDisposition;
  await writeFile(join(output, 'evidence.json'), JSON.stringify(artifact, null, 2));
  if (succeeded) await rm(directory, { recursive: true, force: true });
}
