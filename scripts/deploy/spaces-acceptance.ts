import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addAbortSignal } from 'node:stream';
import type { SpacesConfig } from '../../src/server/backup/config.ts';

interface Credentials {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
type Capability =
  { status: 'ready'; configuration: Credentials } | { status: 'unavailable'; reason: string };
const unavailable = (reason: string): Capability => ({ status: 'unavailable', reason });

/** Inspect known formats only. Callers must never print the ready configuration. */
export function parseSpacesAcceptanceEnvironment(env: NodeJS.ProcessEnv): Capability {
  const access = env.DIGITAL_OCEAN_ACCESS_KEY?.trim();
  const endpoint = env.DIGITAL_OCEAN_ENDPOINT?.trim();
  if (!access) return unavailable('DIGITAL_OCEAN_ACCESS_KEY is missing.');
  if (!endpoint) return unavailable('DIGITAL_OCEAN_ENDPOINT is missing.');
  let accessKeyId: unknown = access;
  let secretAccessKey: unknown = env.DIGITAL_OCEAN_SECRET_KEY?.trim();
  if (access.startsWith('{')) {
    try {
      const value: unknown = JSON.parse(access);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !['accessKeyId', 'secretAccessKey'].includes(key))
      )
        return unavailable(
          'DIGITAL_OCEAN_ACCESS_KEY JSON must contain only accessKeyId and secretAccessKey.',
        );
      ({ accessKeyId, secretAccessKey } = value as Record<string, unknown>);
    } catch {
      return unavailable('DIGITAL_OCEAN_ACCESS_KEY is not valid credential-pair JSON.');
    }
  }
  if (typeof accessKeyId !== 'string' || !/^[A-Za-z0-9_-]{4,256}$/.test(accessKeyId))
    return unavailable('The Spaces accessKeyId is missing or malformed.');
  if (typeof secretAccessKey !== 'string' || !secretAccessKey)
    return unavailable(
      'The Spaces secretAccessKey is missing. Supply it in credential-pair JSON or DIGITAL_OCEAN_SECRET_KEY.',
    );
  if (!/^[\x21-\x7e]{8,512}$/.test(secretAccessKey))
    return unavailable('The Spaces secretAccessKey is malformed.');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return unavailable('DIGITAL_OCEAN_ENDPOINT must be a valid HTTPS Spaces endpoint.');
  }
  if (
    !/^https:\/\/[a-z0-9.-]+\/?$/.test(endpoint) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    return unavailable(
      'DIGITAL_OCEAN_ENDPOINT must be HTTPS without credentials, ports, paths, query or fragment.',
    );
  const host = url.hostname.match(
    /^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.([a-z]{3}[0-9]+)\.digitaloceanspaces\.com$/,
  );
  if (!host) {
    if (/^[a-z]{3}[0-9]+\.digitaloceanspaces\.com$/.test(url.hostname))
      return unavailable(
        'DIGITAL_OCEAN_ENDPOINT is missing the bucket. Use the bucket.region.digitaloceanspaces.com endpoint.',
      );
    return unavailable(
      'DIGITAL_OCEAN_ENDPOINT must name a bucket at its regional digitaloceanspaces.com origin.',
    );
  }
  return {
    status: 'ready',
    configuration: { bucket: host[1], region: host[2], accessKeyId, secretAccessKey },
  };
}

export function assertPrivateResponse(status: number) {
  // The authenticated read already established this exact object's existence.
  // Neither a 200 nor an unrelated redirect/404 proves private-access denial.
  if (status !== 401 && status !== 403) throw new Error('Anonymous access was not denied.');
}
export function assertAcceptanceCatalog(actual: string[], expected: string[]) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort()))
    throw new Error('The complete-artifact catalog did not match this isolated run.');
}

interface Evidence {
  status: 'ready' | 'unavailable' | 'passed' | 'failed';
  reason?: string;
  failedStep?: string;
  sourceCommit: string | null;
  checks: string[];
  cleanup: 'not-needed' | 'complete' | 'failed';
  archiveBytes?: number;
  durationMs?: number;
}
const commit = () =>
  /^[a-f0-9]{40}$/.test(process.env.SPACES_ACCEPTANCE_COMMIT ?? '')
    ? process.env.SPACES_ACCEPTANCE_COMMIT!
    : null;
async function report(evidence: Evidence) {
  // Only aggregate evidence is persisted; never endpoint, credential, object key,
  // plaintext fixture, recovery key, provider exception or request headers.
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/spaces-acceptance.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(
    `Spaces acceptance: ${evidence.status}.${evidence.reason ? ` ${evidence.reason}` : ''}`,
  );
  if (evidence.failedStep)
    console.log(`Failed step: ${evidence.failedStep}. Cleanup: ${evidence.cleanup}.`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### DigitalOcean Spaces acceptance\n\nStatus: **${evidence.status}**. ${evidence.reason ?? ''}\n\n${evidence.failedStep ? `Failed step: ${evidence.failedStep}. ` : ''}Cleanup: ${evidence.cleanup}.\n\nChecks: ${evidence.checks.join(', ') || 'None completed'}.\n\nSource commit: ${evidence.sourceCommit ?? 'local run'}.\n`,
    );
}

export async function runSpacesAcceptance(configuration: Credentials): Promise<Evidence> {
  const started = Date.now();
  const evidence: Evidence = {
    status: 'failed',
    sourceCommit: commit(),
    checks: [],
    cleanup: 'not-needed',
  };
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timeout = setTimeout(stop, 3 * 60_000);
  const signal = controller.signal;
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  let step = 'prepare-synthetic-archive';
  let directory: string | undefined;
  let remote: import('../../src/server/backup/spaces.ts').SpacesStore | undefined;
  let archive:
    | Awaited<ReturnType<typeof import('../../src/server/backup/archive.ts').makeArchive>>
    | undefined;
  let source: import('../../server/database.ts').DatabaseSync | undefined;
  let recoveryKey: Buffer | undefined;
  const owned = new Set<string>();
  try {
    // Probe mode imports no package dependencies, so CI discovers missing
    // external capability before installation and without exposing secrets.
    const { DatabaseSync } = await import('../../server/database.ts');
    const { makeArchive, restoreArchive } = await import('../../src/server/backup/archive.ts');
    const { SpacesStore, expiredBackups } = await import('../../src/server/backup/spaces.ts');
    const { PutObjectCommand, HeadObjectCommand, GetBucketVersioningCommand } =
      await import('@aws-sdk/client-s3');
    directory = await mkdtemp(join(tmpdir(), 'spinel-spaces-acceptance-'));
    source = new DatabaseSync(join(directory, 'synthetic.sqlite'));
    source.exec(
      'CREATE TABLE provider_fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT',
    );
    source
      .prepare('INSERT INTO provider_fixture VALUES (1, ?)')
      .run('Synthetic provider recovery acceptance');
    recoveryKey = randomBytes(32);
    const now = new Date();
    archive = await makeArchive(
      source,
      directory,
      recoveryKey,
      {
        format: 1,
        createdAt: now.toISOString(),
        origin: 'https://spinel-acceptance.invalid',
        image: `sha256:${'0'.repeat(64)}`,
        runtimeEnvironment: 'SYNTHETIC_ACCEPTANCE=1\n',
      },
      { signal, maxArchiveBytes: 1024 * 1024 },
    );
    source.close();
    source = undefined;
    evidence.archiveBytes = (await stat(archive.archive)).size;
    const prefix = `acceptance-${randomUUID()}`;
    const config: SpacesConfig = {
      ...configuration,
      type: 'spaces',
      prefix,
      keyFile: 'unused-ephemeral-key',
      runtimeEnvironmentFile: 'unused-synthetic-runtime',
    };
    remote = new SpacesStore(config);
    step = 'bucket-retention-policy';
    const versioning = await remote.client.send(
      new GetBucketVersioningCommand({ Bucket: config.bucket }),
      { abortSignal: signal },
    );
    if (versioning.Status !== undefined)
      throw new Error('Versioned buckets need an independent version retention policy.');
    evidence.checks.push(step);
    const keyAt = (daysAgo: number) =>
      `${prefix}/${new Date(now.getTime() - daysAgo * 86_400_000).toISOString().replaceAll(':', '-')}-${randomUUID()}.spinel`;
    const newest = keyAt(0),
      old = [keyAt(400), keyAt(500)],
      pending = `${keyAt(0)}.pending`;
    for (const key of [newest, ...old]) {
      owned.add(key);
      owned.add(`${key}.pending`);
    }
    owned.add(pending);
    let listPages = 0;
    remote.client.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'ListObjectsV2Command') {
          // Exercise the production pagination loop with four tiny objects rather
          // than creating over one thousand paid provider objects.
          listPages++;
          return next({ ...args, input: { ...args.input, MaxKeys: 1 } });
        }
        return next(args);
      },
      { step: 'initialize', name: 'boundedAcceptancePagination' },
    );
    step = 'private-publication-and-readback';
    await remote.put(newest, archive.archive, archive.sha256, signal);
    assertAcceptanceCatalog(await remote.list(signal), [newest]);
    evidence.checks.push(step);
    step = 'anonymous-access-denial';
    const anonymous = await fetch(
      `https://${configuration.bucket}.${configuration.region}.digitaloceanspaces.com/${newest}`,
      {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      },
    );
    try {
      assertPrivateResponse(anonymous.status);
    } finally {
      await anonymous.body?.cancel();
    }
    evidence.checks.push(step);
    step = 'authenticated-download-and-encrypted-restore';
    const download = join(directory, 'download.spinel');
    if ((await remote.download(newest, download, signal)) !== archive.sha256)
      throw new Error('Digest mismatch');
    const restored = join(directory, 'restored');
    await restoreArchive(download, recoveryKey, directory, restored, {
      signal,
      requireInventory: true,
      maxDatabaseBytes: 1024 * 1024,
    });
    const database = new DatabaseSync(join(restored, 'spinel.sqlite'), { readOnly: true });
    try {
      if (
        database.prepare('SELECT value FROM provider_fixture WHERE id=1').get()?.value !==
        'Synthetic provider recovery acceptance'
      )
        throw new Error('Restored fixture mismatch');
    } finally {
      database.close();
    }
    recoveryKey.fill(0);
    evidence.checks.push(step);
    step = 'paginated-complete-catalog-and-pending-cleanup';
    for (const key of old) await remote.put(key, archive.archive, archive.sha256, signal);
    const body = addAbortSignal(signal, createReadStream(archive.archive));
    try {
      await remote.client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: pending,
          Body: body,
          ContentLength: evidence.archiveBytes,
          ContentType: 'application/octet-stream',
          ACL: 'private',
        }),
        { abortSignal: signal },
      );
    } finally {
      body.destroy();
    }
    const beforePages = listPages;
    assertAcceptanceCatalog(await remote.list(signal), [newest, ...old]);
    if (listPages - beforePages < 4) throw new Error('Provider did not exercise pagination');
    // This generated namespace has no other publisher or live workspace lease.
    await remote.cleanup(signal);
    let missing = false;
    try {
      await remote.client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: pending }), {
        abortSignal: signal,
      });
    } catch (error) {
      missing =
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
    }
    if (!missing) throw new Error('Pending object cleanup was not confirmed');
    evidence.checks.push(step);
    step = 'retention-and-deletion';
    const expired = expiredBackups(await remote.list(signal), prefix, now);
    assertAcceptanceCatalog(expired, old);
    for (const key of expired) await remote.remove(key, signal);
    assertAcceptanceCatalog(await remote.list(signal), [newest]);
    evidence.checks.push(step);
    evidence.status = 'passed';
  } catch {
    evidence.failedStep = step;
  } finally {
    clearTimeout(timeout);
    // Independent cleanup stays live after cancellation, and never discovers
    // deletions from a bucket-wide list: only this invocation's generated keys.
    if (remote) {
      const cleanupSignal = AbortSignal.timeout(45_000);
      let clean = true;
      for (const key of owned) {
        try {
          await remote.remove(key, cleanupSignal);
        } catch {
          clean = false;
        }
      }
      try {
        if ((await remote.list(cleanupSignal)).length) clean = false;
      } catch {
        clean = false;
      }
      remote.close();
      evidence.cleanup = clean ? 'complete' : 'failed';
    }
    try {
      source?.close();
      await archive?.dispose();
      if (directory) await rm(directory, { recursive: true, force: true });
    } catch {
      evidence.cleanup = 'failed';
    }
    recoveryKey?.fill(0);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    if (evidence.cleanup === 'failed') {
      evidence.status = 'failed';
      evidence.failedStep ??= 'cleanup';
    }
    evidence.durationMs = Date.now() - started;
  }
  return evidence;
}

if (import.meta.main) {
  try {
    const capability = parseSpacesAcceptanceEnvironment(process.env);
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `ready=${capability.status === 'ready'}\n`);
    if (capability.status === 'unavailable') {
      await report({
        status: 'unavailable',
        reason: capability.reason,
        sourceCommit: commit(),
        checks: [],
        cleanup: 'not-needed',
      });
    } else if (process.argv.length === 3 && process.argv[2] === '--probe') {
      await report({
        status: 'ready',
        reason:
          'Credential pair and bucket endpoint are present; provider behavior has not yet been tested.',
        sourceCommit: commit(),
        checks: [],
        cleanup: 'not-needed',
      });
    } else if (process.argv.length === 2) {
      const evidence = await runSpacesAcceptance(capability.configuration);
      await report(evidence);
      if (evidence.status !== 'passed') process.exitCode = 1;
    } else {
      console.error('Use spaces-acceptance.ts with no arguments or --probe.');
      process.exitCode = 1;
    }
  } catch {
    console.error(
      'Spaces acceptance could not complete or write its safe evidence. No provider pass is recorded.',
    );
    process.exitCode = 1;
  }
}
