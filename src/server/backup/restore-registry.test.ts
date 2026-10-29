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
  const admit = vi.fn<RestoreController['admit']>();
  const begin = vi.fn<RestoreController['begin']>();
  const controller: RestoreController = { target: () => target, admit, begin };
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
    directory,
    db,
    auth,
    actor,
    session,
    service,
    target,
    prepare,
    preview,
    admit,
    begin,
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

test('a mismatched custody ACK cannot erase source or start maintenance', async () => {
  const f = await fixture(),
    created = await f.create(),
    ready = await f.upload(created.id);
  f.admit.mockImplementation(async (request) => {
    const ack = f.acknowledge(request);
    ack.record.intent.source.archive.sha256 = '0'.repeat(64);
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
});

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
  'dead preparation cleanup preserves uncertain handoff evidence: %s',
  async (handoff) => {
    const f = await fixture();
    const stale = join(f.directory, `${f.service.restores.namespace}2147483647-Abc123`);
    await mkdir(stale, { mode: 0o700 });
    await writeFile(join(stale, 'upload.key'), randomBytes(32), { mode: 0o600 });
    if (handoff) await writeFile(join(stale, 'handoff-pending.json'), 'partial', { mode: 0o600 });
    f.db
      .prepare("UPDATE backup_state SET owner=?,job='restore',lease=? WHERE id=1")
      .run(`restore:2147483647:${randomUUID()}`, Number.MAX_SAFE_INTEGER);
    if (handoff) {
      await expect(f.create()).rejects.toThrow('Another backup or recovery');
      expect((await stat(join(stale, 'handoff-pending.json'))).isFile()).toBe(true);
    } else {
      expect((await f.create()).state).toBe('uploading');
      await expect(stat(stale)).rejects.toHaveProperty('code', 'ENOENT');
    }
  },
);
