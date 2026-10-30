import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { captureRestoreAuthority } from '../maintenance/restore-authority.ts';
import type { RestoreJobRecord } from '../maintenance/restore-jobs.ts';
import type { RestoreJobIntent } from '../maintenance/restore-job-intent.ts';
import { restoreIntentHash } from '../maintenance/restore-job-intent.ts';
import { BackupService } from './service.ts';
import { RestoreRegistry } from './restore-registry.ts';
import { RecoveryResourceError } from './resource-error.ts';
import type { RestoreController, ConfirmedRestoreAdmission } from './restore-control.ts';
import * as verification from './verification.ts';
import * as journal from '../maintenance/journal.ts';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const image = `sha256:${'a'.repeat(64)}`;
const origin = 'https://spinel.example';
const report = {
  credentials: { currentAccounts: 2, currentPasskeys: 3 },
  grants: { copied: 1, removed: 4, downgraded: 2 },
  ownership: {
    currentItems: 3,
    isolatedItems: 5,
    isolatedGroups: 1,
    detachedRoots: 2,
    heldTrashBatches: 3,
  },
  receipts: { copied: 0, matched: 0 },
  operations: { copied: 0, defaulted: 0 },
  generations: { rotated: 1, initialized: 0, revisionOffset: 1 },
};
async function fixture() {
  const identity = { pid: process.pid, start: '12345', boot: randomUUID(), token: '' };
  const identityReader = vi
    .spyOn(journal, 'processIdentity')
    .mockImplementation((pid) => (pid === process.pid ? { ...identity } : null));
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-registry-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'application.sqlite'),
    db = openDatabase(databasePath);
  cleanups.push(() => db.close());
  let now = Date.now();
  const auth = new AuthStore(db, () => now),
    actor = auth.createUser('Operator', true);
  db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    'passkey',
    actor.id,
    Buffer.from([1]),
    0,
    '[]',
    'Browser',
    'Passkey',
    now,
    null,
    0,
    'singleDevice',
  );
  const session = auth.createSession(actor.id, undefined, 'passkey').session;
  auth.markVerified(session, 'passkey');
  const proof = () =>
    captureRestoreAuthority(
      db,
      { actorId: actor.id, sessionHash: session.token_hash, expiresAt: now + 60_000 },
      () => now,
    );
  const target = { generationId: randomUUID(), epoch: randomUUID() };
  const estimate = vi.fn<RestoreController['estimate']>().mockResolvedValue({
    target,
    resources: {
      provisional: true,
      checkedAt: now,
      requiredAdditionalBytes: 512 * 1024 ** 2,
      availableBytes: 1024 ** 3,
      sufficient: true,
      filesystems: [
        {
          purposes: ['application', 'preparation', 'recovery'],
          requiredAdditionalBytes: 512 * 1024 ** 2,
          availableBytes: 1024 ** 3,
          sufficient: true,
        },
      ],
    },
  });
  const admit = vi.fn<RestoreController['admit']>();
  const begin = vi.fn<RestoreController['begin']>();
  const observe = vi
    .fn<RestoreController['observe']>()
    .mockResolvedValue({ target, record: null, pending: false });
  const controller: RestoreController = { target: () => target, admit, begin, observe, estimate };
  const service = new BackupService(db, {
    databasePath,
    image,
    origin,
    now: () => now,
    restoreController: controller,
  });
  cleanups.push(() => service.close());
  // These tests isolate custody/authority orchestration. Actual archive/worker
  // semantics are tested by verification + the complete supervisor fixture.
  const prepare = vi
    .spyOn(verification, 'prepareRestoreArchive')
    .mockImplementation(async (options) => {
      const staging = await mkdtemp(join(options.stagingRoot, 'verified-'));
      const databasePath = join(staging, 'candidate.sqlite'),
        archive = join(staging, 'source.spinel');
      await writeFile(databasePath, Buffer.alloc(4096));
      await copyFile(options.archive, archive);
      return {
        tables: 1,
        rows: 1,
        snapshots: 0,
        images: 0,
        databasePath,
        databaseBytes: 4096,
        databaseSha256: 'b'.repeat(64),
        logicalFingerprint: 'd'.repeat(64),
        archive: { path: archive, ...options.expectedArchive },
        recovery: { createdAt: new Date(now).toISOString(), origin, image },
        dispose: () => rm(staging, { recursive: true, force: true }),
      };
    });
  const preview = vi
    .spyOn(verification, 'reconcilePreparedRestore')
    .mockImplementation(async (options) => ({
      ...options.candidate,
      tables: 1,
      rows: 1,
      snapshots: 0,
      images: 0,
      logicalFingerprint: 'e'.repeat(64),
      reconciliation: report,
      dispose: async () => {},
    }));
  const create = (id = randomUUID(), key = randomBytes(32)) =>
    service.restores.create(id, proof(), { kind: 'upload', key });
  const upload = async (id: string, bytes = Buffer.from('encrypted-source-boundary-fixture')) => {
    async function* chunks() {
      yield bytes;
    }
    return service.restores.upload(id, actor.id, session.token_hash, chunks(), bytes.length);
  };
  function acknowledge(request: ConfirmedRestoreAdmission) {
    const continuationToken = randomBytes(32).toString('base64url');
    const intent: RestoreJobIntent = {
      version: 1,
      id: request.id,
      target: {
        ...target,
        instanceId: randomUUID(),
        databasePath,
        identity: { device: '1', inode: '2' },
      },
      source: {
        version: 1,
        id: request.id,
        archive: { bytes: request.source.archive.bytes, sha256: request.source.archive.sha256 },
        candidate: { bytes: request.source.databaseBytes, sha256: request.source.databaseSha256 },
        recovery: request.source.recovery,
      },
      policy: {
        origin,
        image,
        spacesEnabled: true,
        staticDirectory: directory,
        consequencesVersion: 1,
      },
      authority: request.authority,
      confirmedAt: request.confirmedAt,
      previewDatabaseBytes: request.previewDatabaseBytes,
      preview: request.preview,
      consequenceEnvelope: 1,
      continuationHash: createHash('sha256').update(continuationToken).digest('hex'),
    };
    const record: RestoreJobRecord = {
      version: 1,
      revision: 1,
      intent,
      intentHash: restoreIntentHash(intent),
      phase: 'source-retained',
      updatedAt: now,
    };
    begin.mockImplementation(async () => ({
      record: { ...record, execution: {} as NonNullable<RestoreJobRecord['execution']> },
    }));
    return { record, custody: true, continuationToken };
  }
  return {
    identity,
    identityReader,
    directory,
    db,
    auth,
    actor,
    session,
    service,
    target,
    estimate,
    prepare,
    preview,
    admit,
    begin,
    observe,
    proof,
    create,
    upload,
    acknowledge,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('manual encrypted upload needs no destination/config and erases its private key before ready', async () => {
  const f = await fixture(),
    key = randomBytes(32),
    sourceKey = Buffer.from(key);
  const created = await f.create(randomUUID(), key);
  expect(key.equals(Buffer.alloc(32))).toBe(true);
  const directory = join(
    f.directory,
    (await readdir(f.directory)).find((name) => name.startsWith('.restore-preparation-'))!,
  );
  expect(await readFile(join(directory, 'upload.key'))).toEqual(sourceKey);
  expect((await stat(join(directory, 'upload.key'))).mode & 0o777).toBe(0o600);
  const ready = await f.upload(created.id);
  expect(ready.state).toBe('ready');
  expect(ready.verification).toEqual({
    applicationCompatible: true,
    sourceCompatible: true,
    databaseVerified: true,
    tables: 1,
    rows: 1,
    snapshots: 0,
    images: 0,
  });
  expect(ready.resources?.sufficient).toBe(true);
  expect(f.estimate).toHaveBeenCalledWith({
    ...f.target,
    archiveBytes: Buffer.byteLength('encrypted-source-boundary-fixture'),
    databaseBytes: 4096,
    previewDatabaseBytes: 4096,
  });
  expect(ready.preview).toMatchObject({
    provisional: true,
    sharingRemoved: 4,
    sharingDowngraded: 2,
    isolatedItems: 5,
  });
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.preview).toHaveBeenCalledOnce();
  await expect(stat(join(directory, 'upload.key'))).rejects.toHaveProperty('code', 'ENOENT');
  expect(JSON.stringify(ready)).not.toContain(f.directory);
  expect(JSON.stringify(ready)).not.toContain(sourceKey.toString('base64'));
  expect(f.service.state().job).toBe('restore');
  await f.service.restores.cancel(created.id, f.actor.id, f.session.token_hash);
  expect(f.service.state().owner).toBeNull();
});

test('insufficient recovery capacity publishes path-free estimates and releases preparation without admission', async () => {
  const f = await fixture();
  f.estimate.mockResolvedValueOnce({
    target: f.target,
    resources: {
      provisional: true,
      checkedAt: Date.now(),
      requiredAdditionalBytes: 1024 ** 3,
      availableBytes: 2 * 1024 ** 3,
      sufficient: false,
      filesystems: [
        {
          purposes: ['application', 'preparation'],
          requiredAdditionalBytes: 512 * 1024 ** 2,
          availableBytes: 2 * 1024 ** 3,
          sufficient: true,
        },
        {
          purposes: ['recovery'],
          requiredAdditionalBytes: 512 * 1024 ** 2,
          availableBytes: 0,
          sufficient: false,
        },
      ],
    },
  });
  const created = await f.create();
  const failed = await f.upload(created.id);
  expect(failed.state).toBe('failed');
  expect(failed.resources?.sufficient).toBe(false);
  expect(failed.error).toBe(new RecoveryResourceError('disk-space').message);
  expect(failed.confirmation).toBeNull();
  expect(f.admit).not.toHaveBeenCalled();
  expect(f.begin).not.toHaveBeenCalled();
  expect(f.service.state().owner).toBeNull();
  expect(JSON.stringify(failed)).not.toContain(f.directory);
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-preparation-')),
  ).toEqual([]);
  expect((await f.create()).state).toBe('uploading');
});

test.each(['target', 'authority', 'expiry'] as const)(
  'capacity awaits recheck %s before ready publication',
  async (scenario) => {
    const f = await fixture();
    const result = await f.estimate({
      ...f.target,
      archiveBytes: 64,
      databaseBytes: 4096,
      previewDatabaseBytes: 4096,
    });
    f.estimate.mockClear();
    f.estimate.mockImplementationOnce(async () => {
      const response = structuredClone(result);
      if (scenario === 'target') response.target.epoch = randomUUID();
      if (scenario === 'authority')
        f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.actor.id);
      if (scenario === 'expiry') f.advance(60_001);
      return response;
    });
    const created = await f.create();
    const failed = await f.upload(created.id);
    expect(failed.state).toBe('failed');
    expect(failed.confirmation).toBeNull();
    if (scenario === 'expiry')
      expect(failed.error).toBe(new RecoveryResourceError('restore-authority').message);
    expect(f.admit).not.toHaveBeenCalled();
    expect(f.service.state().owner).toBeNull();
  },
);

test('allowlisted resource errors survive preparation while arbitrary errors remain private', async () => {
  const f = await fixture();
  f.prepare.mockRejectedValueOnce(new RecoveryResourceError('memory-headroom'));
  const first = await f.create();
  expect((await f.upload(first.id)).error).toBe(
    new RecoveryResourceError('memory-headroom').message,
  );
  // A key that cannot authenticate the upload is reported once every key is tried.
  f.prepare.mockRejectedValueOnce(new RecoveryResourceError('backup-unreadable'));
  const unreadable = await f.create();
  expect((await f.upload(unreadable.id)).error).toBe(
    new RecoveryResourceError('backup-unreadable').message,
  );
  f.prepare.mockRejectedValueOnce(new Error('private source /secret/data.sqlite'));
  const second = await f.create();
  const failed = await f.upload(second.id);
  expect(failed.state).toBe('failed');
  expect(failed.error).not.toContain('/secret');
});

test('admission binds the observed reconciled preview size rather than the original candidate size', async () => {
  const f = await fixture();
  const preview = f.preview.getMockImplementation()!;
  f.preview.mockImplementation(async (options) => ({
    ...(await preview(options)),
    databaseBytes: 8192,
  }));
  const created = await f.create();
  const ready = await f.upload(created.id);
  f.admit.mockRejectedValueOnce(new Error('Uncertain handoff'));
  await f.service.restores.confirm(
    created.id,
    f.actor.id,
    f.session.token_hash,
    ready.confirmation!,
    f.proof(),
  );
  const request = f.admit.mock.calls[0][0];
  expect(request.source.databaseBytes).toBe(4096);
  expect(request.previewDatabaseBytes).toBe(8192);
  expect(f.estimate.mock.calls[0][0].previewDatabaseBytes).toBe(8192);
  expect(f.acknowledge(request).record.intent.previewDatabaseBytes).toBe(8192);
});

test('same preparation request is idempotent, changed source and another session are refused', async () => {
  const f = await fixture(),
    id = randomUUID(),
    bytes = randomBytes(32);
  const first = await f.create(id, Buffer.from(bytes));
  expect((await f.create(id, Buffer.from(bytes))).id).toBe(first.id);
  await expect(f.create(id)).rejects.toThrow('different source');
  expect(() => f.service.restores.status(first.id, f.actor.id, 'other-session')).toThrow(
    'not found',
  );
  await f.service.restores.cancel(first.id, f.actor.id, f.session.token_hash);
  expect((await f.service.restores.cancel(first.id, f.actor.id, f.session.token_hash)).state).toBe(
    'cancelled',
  );
});

test('concurrent duplicate creation waits for private key initialization before offering upload', async () => {
  const f = await fixture(),
    requestId = randomUUID(),
    key = randomBytes(32);
  const first = f.create(requestId, Buffer.from(key));
  const repeated = await f.create(requestId, Buffer.from(key));
  expect((await f.upload(repeated.id)).state).toBe('ready');
  expect((await first).id).toBe(repeated.id);
  expect(f.prepare).toHaveBeenCalledOnce();
});

test('revocation during upload prevents verification and discards private preparation', async () => {
  const f = await fixture(),
    created = await f.create();
  async function* revoked() {
    yield Buffer.from('first');
    f.auth.revokeSession(f.session.token_hash);
    yield Buffer.from('second');
  }
  const result = await f.service.restores.upload(
    created.id,
    f.actor.id,
    f.session.token_hash,
    revoked(),
    11,
  );
  expect(result.state).toBe('failed');
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.service.state().owner).toBeNull();
});

test('an unpublished handoff copy from an interrupted confirmation does not wedge the retry', async () => {
  const f = await fixture(),
    created = await f.create(),
    ready = await f.upload(created.id);
  const [directory] = (await readdir(f.directory)).filter((name) =>
    name.startsWith('.restore-preparation-'),
  );
  await writeFile(join(f.directory, directory, 'handoff-pending.json'), 'partial', {
    mode: 0o600,
  });
  f.admit.mockImplementation(async (request) => f.acknowledge(request));
  const result = await f.service.restores.confirm(
    created.id,
    f.actor.id,
    f.session.token_hash,
    ready.confirmation!,
    f.proof(),
  );
  expect(result.state).toBe('started');
  expect(result.error).toBeNull();
  expect(f.admit).toHaveBeenCalledOnce();
});

test('uncertain custody retains source and original request; retry releases only after matching ACK', async () => {
  const f = await fixture(),
    created = await f.create(),
    ready = await f.upload(created.id);
  f.admit.mockRejectedValueOnce(new Error('private transport error must never reach HTTP'));
  const authority = f.proof();
  const first = await f.service.restores.confirm(
    created.id,
    f.actor.id,
    f.session.token_hash,
    ready.confirmation!,
    authority,
  );
  expect(first.state).toBe('admitting');
  expect(first.error).not.toContain('private transport');
  const original = f.admit.mock.calls[0][0];
  expect((await stat(original.source.archive.path)).isFile()).toBe(true);
  expect(f.service.state().lease).toBe(Number.MAX_SAFE_INTEGER);
  f.observe.mockResolvedValue({ target: f.target, record: null, pending: true });
  await expect(
    f.service.restores.cancel(created.id, f.actor.id, f.session.token_hash),
  ).rejects.toThrow('confirmed');
  f.admit.mockImplementation(async (request) => f.acknowledge(request));
  const result = await f.service.restores.confirm(
    created.id,
    f.actor.id,
    f.session.token_hash,
    ready.confirmation!,
    { ...authority, expiresAt: authority.expiresAt + 1 },
  );
  expect(f.admit.mock.calls[1][0]).toEqual(original);
  expect(result.state).toBe('started');
  await expect(stat(original.source.archive.path)).rejects.toHaveProperty('code', 'ENOENT');
  expect(f.service.state().owner).toBeNull();
  expect(f.begin).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain('continuationToken');
});

test.each(['source', 'preview-size'] as const)(
  'a mismatched %s custody ACK cannot erase source or start maintenance',
  async (scenario) => {
    const f = await fixture(),
      created = await f.create(),
      ready = await f.upload(created.id);
    f.admit.mockImplementation(async (request) => {
      const ack = f.acknowledge(request);
      if (scenario === 'source') ack.record.intent.source.archive.sha256 = '0'.repeat(64);
      if (scenario === 'preview-size') ack.record.intent.previewDatabaseBytes += 4096;
      ack.record.intentHash = restoreIntentHash(ack.record.intent);
      return ack;
    });
    const result = await f.service.restores.confirm(
      created.id,
      f.actor.id,
      f.session.token_hash,
      ready.confirmation!,
      f.proof(),
    );
    expect(result.state).toBe('admitting');
    expect(f.begin).not.toHaveBeenCalled();
    expect((await stat(f.admit.mock.calls[0][0].source.archive.path)).isFile()).toBe(true);
    expect(f.service.state().owner).not.toBeNull();
  },
);

test('target changes during preview fail closed before a confirmation exists', async () => {
  const f = await fixture(),
    created = await f.create();
  f.preview.mockImplementation(async (options) => {
    f.target.epoch = randomUUID();
    return {
      ...options.candidate,
      tables: 1,
      rows: 1,
      snapshots: 0,
      images: 0,
      logicalFingerprint: 'e'.repeat(64),
      reconciliation: report,
      dispose: async () => {},
    };
  });
  expect((await f.upload(created.id)).state).toBe('failed');
  expect(
    f.service.restores.status(created.id, f.actor.id, f.session.token_hash).confirmation,
  ).toBeNull();
  expect(f.admit).not.toHaveBeenCalled();
});

test.each(['current', 'retained', 'resource'] as const)(
  'catalog uses the common verifier and held source with %s key outcome',
  async (outcome) => {
    const f = await fixture();
    const keyFile = join(f.directory, 'deployment.key'),
      env = join(f.directory, 'runtime.env');
    await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
    const retainedKey = join(f.directory, 'retained.key');
    await writeFile(retainedKey, randomBytes(32), { mode: 0o600 });
    await writeFile(env, 'PRIVATE_RUNTIME=value\n', { mode: 0o600 });
    const info = await stat(f.directory, { bigint: true });
    const configPath = join(f.directory, 'backup.json');
    await writeFile(
      configPath,
      JSON.stringify({
        type: 'filesystem',
        root: f.directory,
        rootDevice: String(info.dev),
        rootInode: String(info.ino),
        prefix: 'workspace',
        keyFile,
        runtimeEnvironmentFile: env,
        automatic: false,
        manualDownload: false,
        retainedKeyFiles: { retained: retainedKey },
      }),
      { mode: 0o600 },
    );
    f.service.options.configPath = configPath;
    const verified = f.prepare.getMockImplementation()!;
    f.prepare.mockImplementation(async (options) => {
      if (outcome === 'resource') throw new RecoveryResourceError('disk-space');
      return {
        ...(await verified(options)),
        keyId: outcome === 'retained' ? 'retained' : 'default',
      };
    });
    const published = `workspace/2026-10-29T01-02-03.000Z-${randomUUID()}.spinel`;
    const ciphertext = Buffer.from('held-catalog-ciphertext-fixture');
    f.service.restores.options.remote = () => ({
      put: async () => {},
      remove: async () => {},
      list: async () => [published, 'workspace/incomplete.tmp', 'other/not-a-source.spinel'],
      download: async (key, path) => {
        expect(key).toBe(published);
        expect(f.service.state().job).toBe('restore');
        await writeFile(path, ciphertext, { mode: 0o600 });
        return 'remote-return-is-not-trusted-as-the-observed-digest';
      },
    });
    const catalog = await f.service.restores.catalog();
    expect(catalog.entries).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toContain(published);
    const prepared = await f.service.restores.create(randomUUID(), f.proof(), {
      kind: 'catalog',
      artifactId: catalog.entries[0].id,
    });
    await expect
      .poll(() => f.service.restores.status(prepared.id, f.actor.id, f.session.token_hash).state)
      .not.toBe('preparing');
    expect(f.service.restores.status(prepared.id, f.actor.id, f.session.token_hash).state).toBe(
      outcome === 'resource' ? 'failed' : 'ready',
    );
    expect(f.prepare).toHaveBeenCalledTimes(outcome === 'retained' ? 2 : 1);
    expect(f.prepare.mock.calls[0][0]).toMatchObject({
      keyFile,
      expectedArchive: {
        bytes: ciphertext.length,
        sha256: createHash('sha256').update(ciphertext).digest('hex'),
      },
    });
    expect(f.service.state().job).toBe(outcome === 'resource' ? null : 'restore');
    if (outcome === 'retained') expect(f.prepare.mock.calls[1][0].keyFile).toBe(retainedKey);
  },
);

test('registry startup and close without explicit preparation remain inert under a startup write guard', async () => {
  const f = await fixture(),
    before = await readdir(f.directory);
  const interval = vi.spyOn(globalThis, 'setInterval');
  f.db.setWriteGuard(() => {
    throw new Error('Startup must remain read-only');
  });
  const registry = new RestoreRegistry(f.db, f.service.restores.options);
  registry.start();
  await registry.close();
  expect(interval).not.toHaveBeenCalled();
  expect(await readdir(f.directory)).toEqual(before);
  f.db.setWriteGuard(() => {});
});

test.each([false, true])(
  'proven dead logical lease can be reclaimed without erasing source/handoff evidence: %s',
  async (handoff) => {
    const f = await fixture();
    const stale = join(f.directory, `${f.service.restores.namespace}2147483647-Abc123`);
    await mkdir(stale, { mode: 0o700 });
    await writeFile(join(stale, 'upload.key'), randomBytes(32), { mode: 0o600 });
    if (handoff) await writeFile(join(stale, 'handoff-pending.json'), 'partial', { mode: 0o600 });
    const id = randomUUID();
    f.db
      .prepare("UPDATE backup_state SET owner=?,job='restore',lease=? WHERE id=1")
      .run(`restore:2147483647:${id}`, Number.MAX_SAFE_INTEGER);
    expect((await f.create()).state).toBe('uploading');
    expect(f.observe).toHaveBeenCalledWith({ id });
    expect((await stat(join(stale, 'upload.key'))).isFile()).toBe(true);
    if (handoff) expect((await stat(join(stale, 'handoff-pending.json'))).isFile()).toBe(true);
  },
);

async function retainedRecord(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await f.create(),
    ready = await f.upload(created.id);
  f.admit.mockRejectedValue(new Error('Uncertain private transport'));
  await f.service.restores.confirm(
    created.id,
    f.actor.id,
    f.session.token_hash,
    ready.confirmation!,
    f.proof(),
  );
  return f.acknowledge(f.admit.mock.calls[0][0]).record;
}

test('a fresh Operator session observes durable failure without renewing expired original proof', async () => {
  const f = await fixture(),
    record = await retainedRecord(f);
  record.phase = 'failed';
  f.observe.mockResolvedValue({ target: f.target, record, pending: false });
  f.advance(120_000);
  const session = f.auth.createSession(f.actor.id, undefined, 'passkey').session;
  const result = await f.service.restores.summary(f.actor.id, session.token_hash);
  expect(result.job).toBeNull();
  expect(result.outcome).toEqual({
    id: record.intent.id,
    state: 'did-not-start',
    updatedAt: record.updatedAt,
    source: {
      bytes: record.intent.source.archive.bytes,
      sha256: record.intent.source.archive.sha256,
    },
  });
  expect(Object.keys(result.outcome!).sort()).toEqual(['id', 'source', 'state', 'updatedAt']);
  expect(JSON.stringify(result).includes(f.directory)).toBe(false);
  expect(JSON.stringify(result).includes(record.intent.authority.sessionHash)).toBe(false);
  expect(JSON.stringify(result).includes(record.intent.continuationHash)).toBe(false);
  expect(f.auth.sessionByHash(session.token_hash)?.verified_at).toBeNull();
});

test('status preserves uncertainty and rechecks Operator authority after parent observation', async () => {
  const f = await fixture(),
    record = await retainedRecord(f);
  f.observe.mockResolvedValue({ target: f.target, record, pending: true });
  expect((await f.service.restores.summary(f.actor.id, f.session.token_hash)).outcome?.state).toBe(
    'unresolved',
  );
  f.observe.mockImplementation(async () => {
    f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.actor.id);
    return { target: f.target, record, pending: true };
  });
  await expect(f.service.restores.summary(f.actor.id, f.session.token_hash)).rejects.toThrow(
    'Operator access',
  );
});

test.each([
  'pending',
  'unavailable',
  'invalid',
  'target-changed',
  'live-owner',
  'owner-changed',
] as const)('unproven orphan lease is retained: %s', async (scenario) => {
  const f = await fixture(),
    id = randomUUID(),
    owner = `restore:${scenario === 'live-owner' ? process.pid : 2147483647}:${id}`;
  f.db
    .prepare("UPDATE backup_state SET owner=?,job='restore',lease=? WHERE id=1")
    .run(owner, Number.MAX_SAFE_INTEGER);
  if (scenario === 'pending')
    f.observe.mockResolvedValue({ target: f.target, record: null, pending: true });
  if (scenario === 'unavailable')
    f.observe.mockRejectedValue(new Error('Private unavailable diagnostic'));
  if (scenario === 'invalid')
    f.observe.mockResolvedValue({
      target: f.target,
      record: {} as RestoreJobRecord,
      pending: false,
    });
  if (scenario === 'target-changed')
    f.observe.mockResolvedValue({
      target: { ...f.target, epoch: randomUUID() },
      record: null,
      pending: false,
    });
  const replacement = `restore:2147483647:${randomUUID()}`;
  if (scenario === 'owner-changed')
    f.observe.mockImplementation(async () => {
      f.db.prepare('UPDATE backup_state SET owner=? WHERE id=1').run(replacement);
      return { target: f.target, record: null, pending: false };
    });
  await f.service.restores.summary(f.actor.id, f.session.token_hash).catch(() => {});
  expect(f.service.state().owner).toBe(scenario === 'owner-changed' ? replacement : owner);
  expect(f.service.state().lease).toBe(Number.MAX_SAFE_INTEGER);
});

test('dead lease with no staging directory clears only from complete no-pending evidence', async () => {
  const f = await fixture(),
    id = randomUUID();
  f.db
    .prepare("UPDATE backup_state SET owner=?,job='restore',lease=? WHERE id=1")
    .run(`restore:2147483647:${id}`, Number.MAX_SAFE_INTEGER);
  await f.service.restores.summary(f.actor.id, f.session.token_hash);
  expect(f.observe).toHaveBeenCalledWith({ id });
  expect(f.service.state().owner).toBeNull();
});

test('failed preexecution lease uses the same generation and fresh observed epoch, not immutable historical epoch', async () => {
  const f = await fixture(),
    record = await retainedRecord(f);
  record.phase = 'failed';
  const owner = `restore:2147483647:${record.intent.id}`;
  f.db.prepare('UPDATE backup_state SET owner=? WHERE id=1').run(owner);
  f.observe.mockResolvedValue({ target: f.target, record, pending: false });
  const oldGeneration = f.target.generationId;
  f.target.generationId = randomUUID();
  f.target.epoch = randomUUID();
  await f.service.restores.summary(f.actor.id, f.session.token_hash);
  expect(f.service.state().owner).toBe(owner);
  f.target.generationId = oldGeneration;
  expect(f.target.epoch).not.toBe(record.intent.target.epoch);
  await f.service.restores.summary(f.actor.id, f.session.token_hash);
  expect(f.service.state().owner).toBeNull();
});

test.each([
  'same',
  'start',
  'boot',
  'missing',
  'unreadable',
  'pending',
  'unavailable',
  'target-changed',
  'invalid',
] as const)(
  'incarnation-bound orphan recovery retains uncertainty and distinguishes PID reuse: %s',
  async (scenario) => {
    const f = await fixture(),
      id = randomUUID();
    const owner = `restore:v2:${process.pid}:${f.identity.boot}:${f.identity.start}:${id}`;
    f.db
      .prepare("UPDATE backup_state SET owner=?,job='restore',lease=? WHERE id=1")
      .run(owner, Number.MAX_SAFE_INTEGER);
    if (scenario !== 'same') f.identity.start = '12346';
    if (scenario === 'boot') {
      f.identity.start = '12345';
      f.identity.boot = randomUUID();
    }
    if (scenario === 'missing') f.identityReader.mockReturnValue(null);
    if (scenario === 'unreadable')
      f.identityReader.mockImplementation(() => {
        throw new Error('Private identity unavailable');
      });
    if (scenario === 'pending')
      f.observe.mockResolvedValue({ target: f.target, record: null, pending: true });
    if (scenario === 'unavailable') f.observe.mockRejectedValue(new Error('Unavailable'));
    if (scenario === 'target-changed')
      f.observe.mockResolvedValue({
        target: { ...f.target, epoch: randomUUID() },
        record: null,
        pending: false,
      });
    if (scenario === 'invalid')
      f.observe.mockResolvedValue({
        target: f.target,
        record: {} as RestoreJobRecord,
        pending: false,
      });
    await f.service.restores.summary(f.actor.id, f.session.token_hash).catch(() => {});
    const released = ['start', 'boot', 'missing'].includes(scenario);
    expect(f.service.state().owner).toBe(released ? null : owner);
    expect(f.service.state().lease).toBe(released ? 0 : Number.MAX_SAFE_INTEGER);
    if (released) expect(f.observe).toHaveBeenCalledWith({ id });
  },
);

test('creation cannot claim a source lease without a readable current process incarnation', async () => {
  const f = await fixture();
  f.identityReader.mockReturnValue(null);
  await expect(f.create()).rejects.toThrow('process ownership');
  expect(f.service.state().owner).toBeNull();
  expect(
    (await readdir(f.directory)).some((name) => name.startsWith(f.service.restores.namespace)),
  ).toBe(false);
});

test('certain own admission failure releases only its logical lease, preserves evidence and permits a new preparation', async () => {
  const f = await fixture(),
    record = await retainedRecord(f);
  const admission = f.admit.mock.calls[0][0];
  const directory = join(
    f.directory,
    (await readdir(f.directory)).find((name) => name.startsWith(f.service.restores.namespace))!,
  );
  const files = [
    admission.source.archive.path,
    admission.source.databasePath,
    join(directory, 'handoff.json'),
  ];
  const hashes = () =>
    Promise.all(
      files.map(async (path) =>
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ),
    );
  const before = await hashes();
  record.phase = 'failed';
  f.observe.mockResolvedValue({ target: f.target, record, pending: false });
  const result = await f.service.restores.summary(f.actor.id, f.session.token_hash);
  expect(result.job?.state).toBe('failed');
  expect(result.outcome?.state).toBe('did-not-start');
  expect(f.service.state().lease).toBe(0);
  const next = await f.create();
  expect(next.state).toBe('uploading');
  expect(next.id).not.toBe(record.intent.id);
  const lease = f.service.state().owner;
  expect(
    (
      await f.service.restores.confirm(
        record.intent.id,
        f.actor.id,
        f.session.token_hash,
        result.job!.confirmation!,
        f.proof(),
      )
    ).state,
  ).toBe('failed');
  expect(
    (await f.service.restores.cancel(record.intent.id, f.actor.id, f.session.token_hash)).state,
  ).toBe('failed');
  expect(f.admit).toHaveBeenCalledTimes(1);
  expect(f.service.state().owner).toBe(lease);
  expect(await hashes()).toEqual(before);
});

test('authoritative absent admission releases the live lease for an export and retains source evidence', async () => {
  const f = await fixture(),
    record = await retainedRecord(f);
  const request = f.admit.mock.calls[0][0];
  const before = await readFile(request.source.archive.path);
  f.observe.mockResolvedValue({ target: f.target, record: null, pending: false });
  const result = await f.service.restores.summary(f.actor.id, f.session.token_hash);
  expect(result.job?.state).toBe('failed');
  expect(result.outcome).toBeNull();
  expect(f.service.state().lease).toBe(0);
  const keyFile = join(f.directory, 'export.key'),
    runtimeEnvironmentFile = join(f.directory, 'export.env');
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
  await writeFile(runtimeEnvironmentFile, 'RECOVERY_FIXTURE=1\n', { mode: 0o600 });
  f.service.options.configPath = join(f.directory, 'export.json');
  await writeFile(
    f.service.options.configPath,
    JSON.stringify({
      version: 1,
      type: 'manual',
      prefix: 'workspace',
      keyFile,
      runtimeEnvironmentFile,
      keyId: 'fixture',
    }),
    { mode: 0o600 },
  );
  const download = await f.service.exports.create(f.session.token_hash);
  expect(download.state).toBe('preparing');
  await f.service.exports.cancel(f.session.token_hash, download.id);
  expect(await readFile(request.source.archive.path)).toEqual(before);
  const repeated = await f.service.restores.confirm(
    record.intent.id,
    f.actor.id,
    f.session.token_hash,
    result.job!.confirmation!,
    f.proof(),
  );
  expect(repeated.state).toBe('failed');
  expect(f.admit).toHaveBeenCalledTimes(1);
});

test('an admission retry that fully settles during observation invalidates earlier absence evidence', async () => {
  const f = await fixture(),
    record = await retainedRecord(f);
  const prepared = f.service.restores.status(record.intent.id, f.actor.id, f.session.token_hash);
  const owner = f.service.state().owner;
  f.observe.mockImplementationOnce(async () => {
    // This absent observation was made before a later dispatch whose ACK was lost.
    await f.service.restores.confirm(
      record.intent.id,
      f.actor.id,
      f.session.token_hash,
      prepared.confirmation!,
      f.proof(),
    );
    return { target: f.target, record: null, pending: false };
  });
  await f.service.restores.summary(f.actor.id, f.session.token_hash);
  expect(f.admit).toHaveBeenCalledTimes(2);
  expect(f.service.state().owner).toBe(owner);
  expect(f.service.state().lease).toBe(Number.MAX_SAFE_INTEGER);
  expect(f.service.restores.status(record.intent.id, f.actor.id, f.session.token_hash).state).toBe(
    'admitting',
  );
});

test('absence cannot resolve an admission whose custody ACK was already observed', async () => {
  const f = await fixture(),
    created = await f.create(),
    ready = await f.upload(created.id);
  f.admit.mockImplementation(async (request) => {
    const ack = f.acknowledge(request);
    f.begin.mockRejectedValueOnce(new Error('Uncertain Begin'));
    return ack;
  });
  await f.service.restores.confirm(
    created.id,
    f.actor.id,
    f.session.token_hash,
    ready.confirmation!,
    f.proof(),
  );
  f.observe.mockResolvedValue({ target: f.target, record: null, pending: false });
  const result = await f.service.restores.summary(f.actor.id, f.session.token_hash);
  expect(result.job?.state).toBe('accepted');
  expect(result.outcome).toBeNull();
});

test('absence in a changed original epoch retains the unknown admission hold', async () => {
  const f = await fixture(),
    record = await retainedRecord(f);
  const owner = f.service.state().owner;
  f.target.epoch = randomUUID();
  f.observe.mockResolvedValue({ target: f.target, record: null, pending: false });
  const result = await f.service.restores.summary(f.actor.id, f.session.token_hash);
  expect(result.job?.state).toBe('admitting');
  expect(result.outcome).toBeNull();
  expect(f.service.state().owner).toBe(owner);
  expect(f.service.state().lease).toBe(Number.MAX_SAFE_INTEGER);
  expect(record.intent.target.epoch).not.toBe(f.target.epoch);
});

test('another current Operator can resolve absent admission after revocation without seeing private preparation', async () => {
  const f = await fixture();
  await retainedRecord(f);
  const request = f.admit.mock.calls[0][0],
    bytes = await readFile(request.source.archive.path);
  const other = f.auth.createUser('Another operator', true);
  const session = f.auth.createSession(other.id).session;
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.actor.id);
  f.observe.mockResolvedValue({ target: f.target, record: null, pending: false });
  const result = await f.service.restores.summary(other.id, session.token_hash);
  expect(result.job).toBeNull();
  expect(result.outcome).toBeNull();
  expect(f.service.state().lease).toBe(0);
  expect(await readFile(request.source.archive.path)).toEqual(bytes);
  expect(JSON.stringify(result)).not.toContain(request.source.archive.sha256);
});

test('correlated Begin capacity advice clears a stale estimate without changing confirmed intent or releasing custody', async () => {
  const f = await fixture(),
    created = await f.create(),
    ready = await f.upload(created.id);
  f.admit.mockImplementation(async (request) => {
    const ack = f.acknowledge(request);
    f.begin.mockRejectedValueOnce(new RecoveryResourceError('disk-space'));
    return ack;
  });
  const first = await f.service.restores.confirm(
    created.id,
    f.actor.id,
    f.session.token_hash,
    ready.confirmation!,
    f.proof(),
  );
  expect(first.state).toBe('accepted');
  expect(first.resources).toBeNull();
  expect(first.error).toBe(new RecoveryResourceError('disk-space').message);
  expect(first.confirmation).toBe(ready.confirmation);
  const request = structuredClone(f.admit.mock.calls[0][0]);
  const second = await f.service.restores.confirm(
    created.id,
    f.actor.id,
    f.session.token_hash,
    ready.confirmation!,
    { ...f.proof(), expiresAt: f.proof().expiresAt + 1 },
  );
  expect(second.state).toBe('started');
  expect(f.admit).toHaveBeenCalledTimes(1);
  expect(f.admit.mock.calls[0][0]).toEqual(request);
  expect(f.begin.mock.calls[1]).toEqual(f.begin.mock.calls[0]);
});

test.each([
  'pending',
  'intent-source',
  'intent-authority',
  'preview-size',
  'target',
  'revoked',
  'lease-changed',
] as const)(
  'own admission terminalization refuses nonmatching or changed evidence: %s',
  async (scenario) => {
    const f = await fixture(),
      record = await retainedRecord(f),
      owner = f.service.state().owner;
    record.phase = 'failed';
    if (scenario === 'intent-source') record.intent.source.archive.sha256 = 'f'.repeat(64);
    if (scenario === 'intent-authority') record.intent.authority.expiresAt++;
    if (scenario === 'preview-size') record.intent.previewDatabaseBytes += 4096;
    record.intentHash = restoreIntentHash(record.intent);
    if (scenario === 'target') f.target.generationId = randomUUID();
    f.observe.mockImplementation(async () => {
      if (scenario === 'revoked')
        f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.actor.id);
      if (scenario === 'lease-changed')
        f.db.prepare('UPDATE backup_state SET lease=? WHERE id=1').run(Number.MAX_SAFE_INTEGER - 1);
      return { target: f.target, record, pending: scenario === 'pending' };
    });
    await f.service.restores.summary(f.actor.id, f.session.token_hash).catch(() => {});
    expect(f.service.state().owner).toBe(owner);
    expect(f.service.state().lease).toBe(
      Number.MAX_SAFE_INTEGER - (scenario === 'lease-changed' ? 1 : 0),
    );
    expect(
      f.service.restores.status(record.intent.id, f.actor.id, f.session.token_hash).state,
    ).toBe('admitting');
  },
);

test('an admission retry starting during observation prevents logical terminalization until its task settles', async () => {
  const f = await fixture(),
    record = await retainedRecord(f);
  record.phase = 'failed';
  const prepared = f.service.restores.status(record.intent.id, f.actor.id, f.session.token_hash);
  let reject!: (error: Error) => void;
  f.admit.mockImplementation(
    () =>
      new Promise((_resolve, rejectAdmission) => {
        reject = rejectAdmission;
      }),
  );
  let retry: Promise<unknown> | undefined;
  f.observe
    .mockResolvedValue({ target: f.target, record, pending: false })
    .mockImplementationOnce(async () => {
      retry = f.service.restores.confirm(
        prepared.id,
        f.actor.id,
        f.session.token_hash,
        prepared.confirmation!,
        f.proof(),
      );
      return { target: f.target, record, pending: false };
    });
  try {
    await f.service.restores.summary(f.actor.id, f.session.token_hash);
    expect(f.service.state().lease).toBe(Number.MAX_SAFE_INTEGER);
    expect(f.service.restores.status(prepared.id, f.actor.id, f.session.token_hash).state).toBe(
      'admitting',
    );
  } finally {
    reject(new Error('Admission retry failed without custody'));
    await retry;
  }
  expect((await f.service.restores.summary(f.actor.id, f.session.token_hash)).job?.state).toBe(
    'failed',
  );
});

test.each([false, true])(
  'failed outcome after custody release respects the acknowledged intent and never touches a later lease (conflict=%s)',
  async (conflict) => {
    const f = await fixture(),
      created = await f.create(),
      ready = await f.upload(created.id);
    let acknowledged!: ReturnType<typeof f.acknowledge>;
    f.admit.mockImplementation(async (request) => {
      acknowledged = f.acknowledge(request);
      f.begin.mockRejectedValue(new Error('Begin failed before execution'));
      return acknowledged;
    });
    const accepted = await f.service.restores.confirm(
      created.id,
      f.actor.id,
      f.session.token_hash,
      ready.confirmation!,
      f.proof(),
    );
    expect(accepted.state).toBe('accepted');
    expect(f.service.state().owner).toBeNull();
    const record = structuredClone(acknowledged.record);
    record.phase = 'failed';
    if (conflict) {
      record.intent.policy.staticDirectory = join(f.directory, 'different-assets');
      record.intentHash = restoreIntentHash(record.intent);
    }
    const owner = `verification:${randomUUID()}`,
      lease = Date.now() + 60_000;
    f.db
      .prepare("UPDATE backup_state SET owner=?,job='verify',lease=? WHERE id=1")
      .run(owner, lease);
    f.observe.mockResolvedValue({ target: f.target, record, pending: false });
    f.db.setWriteGuard(() => {
      throw new Error('No backup state writes are authorized');
    });
    try {
      if (conflict)
        await expect(f.service.restores.summary(f.actor.id, f.session.token_hash)).rejects.toThrow(
          'status could not be verified',
        );
      else
        expect(
          (await f.service.restores.summary(f.actor.id, f.session.token_hash)).job?.state,
        ).toBe('failed');
      expect(f.service.state().owner).toBe(owner);
      expect(f.service.state().lease).toBe(lease);
    } finally {
      f.db.setWriteGuard(() => {});
    }
  },
);
