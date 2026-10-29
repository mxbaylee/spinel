import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { hashTouched, materialize } from '@spinel/sync-server';
import type { NativeSnapshot, Touched } from '@spinel/sync-server';
import type { IWorkbookData } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { Profiles } from '../auth/profile.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { LinkAccess } from '../workspace/links.ts';
import type {
  MaintenanceAdminStatus,
  MaintenanceBridge,
  MaintenancePublicStatus,
} from '../../shared/maintenance.ts';
import { publicMaintenance } from '../../shared/maintenance.ts';

vi.setConfig({ testTimeout: 30_000 });
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
type Frame = {
  type: string;
  version?: number;
  unitId?: string;
  revision?: number;
  fromRevision?: number;
  edits?: Frame[];
  mutationId?: string;
  duplicate?: boolean;
  reason?: string;
  snapshot?: NativeSnapshot;
  mutations?: Mutation[];
  hash?: string;
  touched?: Touched;
  selfId?: string;
  members?: { id: string; name: string; avatar: string; selection?: string }[];
};
const presence = (frames: Frame[]) => frames.filter((frame) => frame.type === 'presence').at(-1);

async function fixture(maintenance?: MaintenanceBridge) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-own-transport-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const filename = join(directory, 'app.sqlite');
  const origin = 'http://localhost:3000';
  const app = await createApp({
    databasePath: filename,
    staticDirectory: directory,
    origin,
    maintenance,
  });
  const db = openDatabase(filename);
  cleanup.push(() => db.close());
  cleanup.push(() => app.close());
  const sockets: WebSocket[] = [];
  cleanup.push(() => {
    for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Private owner'),
    editor = auth.createUser('Editor'),
    viewer = auth.createUser('Viewer'),
    operator = auth.createUser('Operator', true);
  const sheet = workspace.create(owner.id, {
    kind: 'sheet',
    name: 'Private workbook title',
    parentId: null,
  });
  workspace.share(owner.id, sheet.id, editor.id, 'editor');
  workspace.share(owner.id, sheet.id, viewer.id, 'viewer');
  const sessions = new Map(
    [owner, editor, viewer, operator].map((user) => [user.id, auth.createSession(user.id)]),
  );
  const cookie = (id = owner.id) => `${COOKIE_NAME}=${sessions.get(id)!.token}`;
  const send = (
    path: string,
    credential = cookie(),
    method = 'GET',
    body?: unknown,
    suppliedOrigin = origin,
    extraHeaders: Record<string, string> = {},
  ) =>
    fetch(root + path, {
      method,
      headers: {
        Cookie: credential,
        Origin: suppliedOrigin,
        ...(maintenance && { 'X-Spinel-Epoch': maintenance.status().epoch }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const prefix = `/sync-api/items/${sheet.id}`;
  const ticket = async (base = prefix, id = sheet.id, credential = cookie()) => {
    const response = await send(`${base}/ticket?unitId=${id}`, credential, 'POST');
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return (await response.json()).ticket as string;
  };
  const connect = async (
    base = prefix,
    id = sheet.id,
    credential = cookie(),
    existing?: string,
    afterRevision?: number,
    autoPong = true,
  ) => {
    const token = existing ?? (await ticket(base, id, credential));
    const socket = new WebSocket(
      `${root.replace('http:', 'ws:')}${base}/socket?unitId=${id}&ticket=${token}${afterRevision === undefined ? '' : `&afterRevision=${afterRevision}`}${maintenance ? `&epoch=${encodeURIComponent(maintenance.status().epoch)}` : ''}`,
      { headers: { Cookie: credential, Origin: origin }, autoPong },
    );
    sockets.push(socket);
    const frames: Frame[] = [];
    socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await expect
      .poll(() => frames.some((frame) => ['snapshot', 'resume', 'resync'].includes(frame.type)))
      .toBe(true);
    await expect.poll(() => presence(frames)?.selfId).toBeTruthy();
    return { socket, frames };
  };
  const rejectedSocket = async (
    token: string,
    base = prefix,
    id = sheet.id,
    credential = cookie(),
    suppliedOrigin = origin,
    afterRevision?: string,
  ) => {
    const socket = new WebSocket(
      `${root.replace('http:', 'ws:')}${base}/socket?unitId=${id}&ticket=${token}${afterRevision === undefined ? '' : `&afterRevision=${afterRevision}`}${maintenance ? `&epoch=${encodeURIComponent(maintenance.status().epoch)}` : ''}`,
      { headers: { Cookie: credential, Origin: suppliedOrigin } },
    );
    sockets.push(socket);
    socket.on('error', () => {});
    await expect.poll(() => socket.readyState).toBe(WebSocket.CLOSED);
  };
  const prepare = async () => {
    const response = await send(`/api/items/${sheet.id}/collaboration`, cookie(), 'POST', {});
    expect(response.status).toBe(200);
    const prepared = await response.json();
    expect(prepared.syncVersion).toBe(1);
    return prepared;
  };
  const mutation = (value: unknown, column = 0, unitId = sheet.id): Mutation => ({
    id: 'sheet.mutation.set-range-values',
    params: { unitId, subUnitId: 'first', cellValue: { 0: { [column]: { v: value } } } },
  });
  return {
    app,
    db,
    auth,
    workspace,
    spaces,
    owner,
    editor,
    viewer,
    operator,
    sheet,
    cookie,
    sessions,
    send,
    prefix,
    ticket,
    connect,
    rejectedSocket,
    prepare,
    mutation,
  };
}

test('the native protocol is available by default and the old protocol is retired', async () => {
  const f = await fixture();
  await f.prepare();
  expect((await f.send(`${f.prefix}/ticket?unitId=${f.sheet.id}`, f.cookie(), 'POST')).status).toBe(
    200,
  );
  expect(
    (await f.send(`/universer-api/snapshot/2/unit/${f.sheet.id}/rev/0`, f.cookie())).status,
  ).toBe(404);
  expect(
    f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='spinel_sync_units'").get(),
  ).toBeTruthy();
});

test('offline replay sends an atomic head fence through the authorized native socket', async () => {
  const f = await fixture();
  await f.prepare();
  const connection = await f.connect();
  const original = {
    type: 'submit',
    mutationId: randomUUID(),
    baseRevision: 1,
    mutations: [f.mutation('Offline once')],
  };
  connection.socket.send(JSON.stringify({ ...original, expectedRevision: 1 }));
  await expect.poll(() => connection.frames.filter((frame) => frame.type === 'ack').length).toBe(1);
  connection.socket.send(JSON.stringify({ ...original, expectedRevision: 1 }));
  await expect
    .poll(() => connection.frames.find((frame) => frame.type === 'resync')?.reason)
    .toBe('stale');
  connection.socket.send(JSON.stringify(original));
  await expect.poll(() => connection.frames.filter((frame) => frame.type === 'ack').length).toBe(2);
  expect(connection.frames.filter((frame) => frame.type === 'ack').at(-1)?.duplicate).toBe(true);
  const stale = {
    ...original,
    mutationId: randomUUID(),
    expectedRevision: 1,
    mutations: [f.mutation('Must not overwrite')],
  };
  connection.socket.send(JSON.stringify(stale));
  await expect
    .poll(
      () =>
        connection.frames.find(
          (frame) => frame.type === 'resync' && frame.mutationId === stale.mutationId,
        )?.reason,
    )
    .toBe('stale');
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(1);
  expect(
    (await (await f.send(`${f.prefix}/snapshot?unitId=${f.sheet.id}`)).json()).snapshot,
  ).toMatchObject({
    sheets: { first: { cellData: { 0: { 0: { v: 'Offline once' } } } } },
  });
});

test('offline account headers fence refresh, preparation and socket tickets before document access', async () => {
  const f = await fixture();
  await f.prepare();
  const bound = { 'X-Spinel-Offline-Account': f.owner.id };
  for (const [path, method] of [
    [`/api/items/${f.sheet.id}/offline-bundle`, 'GET'],
    [`/api/items/${f.sheet.id}/collaboration`, 'POST'],
    [`${f.prefix}/snapshot?unitId=${f.sheet.id}`, 'GET'],
    [`${f.prefix}/ticket?unitId=${f.sheet.id}`, 'POST'],
  ] as const) {
    const original = await f.send(
      path,
      f.cookie(),
      method,
      method === 'POST' ? {} : undefined,
      undefined,
      bound,
    );
    expect(original.status, await original.text()).toBe(200);
    // The second user can edit this same item. Merely checking its access
    // would let it accidentally replay private work from the first account.
    const switched = await f.send(
      path,
      f.cookie(f.editor.id),
      method,
      method === 'POST' ? {} : undefined,
      undefined,
      bound,
    );
    const privateTransport = path.startsWith('/sync-api/');
    // The native transport deliberately normalizes access failures, while the
    // application refresh route reports the account mismatch explicitly.
    expect(switched.status).toBe(privateTransport ? 403 : 409);
    expect(await switched.json()).toMatchObject({
      error: privateTransport
        ? 'This document is not available.'
        : 'The signed-in account changed. Reopen Spinel.',
    });
    // An Operator cookie is still a different identity, not evidence that the
    // downloading account lost access to its clean copy.
    const operator = await f.send(
      path,
      f.cookie(f.operator.id),
      method,
      method === 'POST' ? {} : undefined,
      undefined,
      bound,
    );
    expect(operator.status).toBe(privateTransport ? 403 : 409);
  }
  const unrelated = f.auth.createUser('Other account without this item');
  const session = f.auth.createSession(unrelated.id);
  const missing = await f.send(
    `/api/items/${f.sheet.id}/offline-bundle`,
    `${COOKIE_NAME}=${session.token}`,
    'GET',
    undefined,
    undefined,
    bound,
  );
  // A cross-account 404 must never be mistaken for revocation/removal of the
  // downloading account's clean copy.
  expect(missing.status).toBe(409);
});

test('ordinary offline preparation reports revoked and trashed access as a denial', async () => {
  const f = await fixture();
  await f.prepare();
  const path = `/api/items/${f.sheet.id}`;
  const bound = { 'X-Spinel-Offline-Account': f.editor.id };
  const prepare = () =>
    f.send(`${path}/collaboration`, f.cookie(f.editor.id), 'POST', {}, undefined, bound);
  expect((await prepare()).status).toBe(200);
  f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, null);
  const denied = await prepare();
  // A generic 400 looks like a retryable outage and strands durable offline
  // edits. A confirmed 403 freezes the original and enables copy recovery.
  expect(denied.status).toBe(403);
  expect(denied.headers.get('cache-control')).toBe('no-store');
  expect(await denied.json()).toEqual({ error: 'This document is not available.' });
  f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, 'editor');
  expect((await prepare()).status).toBe(200);
  expect((await f.send(`${path}/trash`, f.cookie(), 'POST', {})).status).toBe(200);
  const trashed = await prepare();
  expect(trashed.status).toBe(403);
  expect(trashed.headers.get('cache-control')).toBe('no-store');
  expect(await trashed.json()).toEqual({ error: 'This document is not available.' });
  const switched = await f.send(`${path}/collaboration`, f.cookie(), 'POST', {}, undefined, bound);
  expect(switched.status).toBe(409);
  expect(await switched.json()).toEqual({
    error: 'The signed-in account changed. Reopen Spinel.',
  });
});

test('two real sockets converge through durable ordering, retry, divergence resync and no duplicate broadcasts', async () => {
  const f = await fixture();
  await f.prepare();
  const a = await f.connect(),
    b = await f.connect(f.prefix, f.sheet.id, f.cookie(f.editor.id));
  const one = {
    type: 'submit',
    mutationId: randomUUID(),
    baseRevision: 1,
    mutations: [f.mutation('First accepted')],
  };
  const two = {
    type: 'submit',
    mutationId: randomUUID(),
    baseRevision: 1,
    mutations: [f.mutation('Other column', 1)],
  };
  a.socket.send(JSON.stringify(one));
  b.socket.send(JSON.stringify(two));
  await expect.poll(() => a.frames.filter((frame) => frame.type === 'edit').length).toBe(2);
  await expect.poll(() => b.frames.filter((frame) => frame.type === 'edit').length).toBe(2);
  const replay = (frames: Frame[]) =>
    frames
      .filter((frame) => frame.type === 'edit')
      .reduce(
        (snapshot, edit) => materialize(snapshot, 'sheet', edit.mutations!),
        frames[0].snapshot!,
      );
  expect(replay(a.frames)).toEqual(replay(b.frames));
  for (const frames of [a.frames, b.frames]) {
    expect(frames.filter((frame) => frame.type === 'edit').map((frame) => frame.revision)).toEqual([
      2, 3,
    ]);
    expect(JSON.stringify(frames)).not.toContain('requestHash');
    expect(JSON.stringify(frames)).not.toContain('beforeCells');
    expect(JSON.stringify(frames)).not.toContain(f.owner.id);
  }
  await expect.poll(() => a.frames.some((frame) => frame.type === 'ack')).toBe(true);
  const receipt = f.db
    .prepare('SELECT revision,mutations FROM spinel_sync_revisions WHERE mutation_id=?')
    .get(one.mutationId)!;
  expect(receipt.revision).toBeGreaterThan(1); // The acknowledgement is observed only after SQLite commit.
  const original = a.frames.find((frame) => frame.type === 'ack')!;
  a.socket.send(JSON.stringify(one));
  await expect.poll(() => a.frames.filter((frame) => frame.type === 'ack').length).toBe(2);
  expect(a.frames.filter((frame) => frame.type === 'ack')[1]).toEqual({
    ...original,
    duplicate: true,
  });
  expect(a.frames.filter((frame) => frame.type === 'edit')).toHaveLength(2);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(2);

  const last = a.frames.filter((frame) => frame.type === 'edit').at(-1)!;
  const hash = hashTouched(replay(a.frames), last.touched!);
  expect(hash).toBe(last.hash);
  a.socket.send(JSON.stringify({ type: 'verify', revision: 3, hash }));
  await expect.poll(() => a.frames.some((frame) => frame.type === 'verified')).toBe(true);
  const divergent = structuredClone(replay(a.frames)) as IWorkbookData;
  const address = last.touched!.kind === 'sheet' ? last.touched!.cells[0] : undefined;
  expect(address).toBeDefined();
  divergent.sheets[address!.sheetId].cellData![address!.row]![address!.column] = {
    v: 'Divergent private client value',
  };
  a.socket.send(
    JSON.stringify({ type: 'verify', revision: 3, hash: hashTouched(divergent, last.touched!) }),
  );
  await expect
    .poll(() => a.frames.find((frame) => frame.type === 'resync')?.reason)
    .toBe('divergence');
  const current = await f.send(`${f.prefix}/snapshot?unitId=${f.sheet.id}`);
  expect((await current.json()).revision).toBe(3);
  a.socket.close();
  await expect.poll(() => a.socket.readyState).toBe(WebSocket.CLOSED);
  const reconnected = await f.connect();
  reconnected.socket.send(JSON.stringify(one));
  await expect
    .poll(() => reconnected.frames.find((frame) => frame.type === 'ack')?.duplicate)
    .toBe(true);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(2);
});

test('resume replays exact missing edits before live edits and an unchanged retry returns its original receipt', async () => {
  const f = await fixture();
  await f.prepare();
  const original = await f.connect();
  const sent = {
    type: 'submit',
    mutationId: randomUUID(),
    baseRevision: 1,
    mutations: [f.mutation('Accepted before disconnect')],
  };
  original.socket.send(JSON.stringify(sent));
  await expect.poll(() => original.frames.find((frame) => frame.type === 'ack')?.revision).toBe(2);
  original.socket.close();
  await expect.poll(() => original.socket.readyState).toBe(WebSocket.CLOSED);
  const editor = await f.connect(f.prefix, f.sheet.id, f.cookie(f.editor.id));
  editor.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 2,
      mutations: [f.mutation('Edited while away', 1)],
    }),
  );
  await expect.poll(() => editor.frames.find((frame) => frame.type === 'ack')?.revision).toBe(3);
  const resumed = await f.connect(f.prefix, f.sheet.id, f.cookie(), undefined, 1);
  expect(resumed.frames[0]).toMatchObject({
    type: 'resume',
    version: 1,
    unitId: f.sheet.id,
    fromRevision: 1,
    revision: 3,
  });
  expect(resumed.frames[0].edits?.map((frame) => frame.revision)).toEqual([2, 3]);
  const originalEdit = original.frames.find((frame) => frame.type === 'edit')!;
  expect(resumed.frames[0].edits?.[0]).toEqual({
    revision: originalEdit.revision,
    mutations: originalEdit.mutations,
    touched: originalEdit.touched,
    hash: originalEdit.hash,
  });
  for (const privateField of ['actorId', 'mutationId', 'requestHash', 'beforeCells'])
    expect(JSON.stringify(resumed.frames[0])).not.toContain(privateField);
  resumed.socket.send(JSON.stringify(sent));
  await expect
    .poll(() => resumed.frames.find((frame) => frame.type === 'ack')?.duplicate)
    .toBe(true);
  expect(resumed.frames.find((frame) => frame.type === 'ack')).toMatchObject({
    mutationId: sent.mutationId,
    revision: 2,
  });
  editor.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 3,
      mutations: [f.mutation('Live after resume', 2)],
    }),
  );
  await expect
    .poll(() =>
      resumed.frames.filter((frame) => frame.type === 'edit').map((frame) => frame.revision),
    )
    .toEqual([4]);
  const atHead = await f.connect(f.prefix, f.sheet.id, f.cookie(), undefined, 4);
  expect(atHead.frames[0]).toMatchObject({
    type: 'resume',
    fromRevision: 4,
    revision: 4,
    edits: [],
  });
  const ticket = await f.ticket();
  const joining = f.connect(f.prefix, f.sheet.id, f.cookie(), ticket, 4);
  editor.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 4,
      mutations: [f.mutation('Committed during resume', 3)],
    }),
  );
  const concurrent = await joining;
  await expect
    .poll(() =>
      [
        ...(concurrent.frames[0].edits ?? []),
        ...concurrent.frames.filter((frame) => frame.type === 'edit'),
      ].map((frame) => frame.revision),
    )
    .toEqual([5]);
});

test('a stale initial resume leaves the socket open to recover an old immutable receipt', async () => {
  const f = await fixture();
  await f.prepare();
  const first = await f.connect();
  const sent = {
    type: 'submit',
    mutationId: randomUUID(),
    baseRevision: 1,
    mutations: [f.mutation('Acknowledgement was lost')],
  };
  first.socket.send(JSON.stringify(sent));
  await expect.poll(() => first.frames.some((frame) => frame.type === 'ack')).toBe(true);
  first.socket.close();
  await expect.poll(() => first.socket.readyState).toBe(WebSocket.CLOSED);
  f.db.prepare('UPDATE spinel_sync_units SET retained_from=2 WHERE unit_id=?').run(f.sheet.id);
  f.db
    .prepare('UPDATE spinel_sync_revisions SET before_cells=NULL,retained_bytes=0 WHERE unit_id=?')
    .run(f.sheet.id);
  const retry = await f.connect(f.prefix, f.sheet.id, f.cookie(), undefined, 1);
  expect(retry.frames[0]).toEqual({ type: 'resync', reason: 'stale' });
  expect(retry.socket.readyState).toBe(WebSocket.OPEN);
  retry.socket.send(JSON.stringify(sent));
  await expect.poll(() => retry.frames.find((frame) => frame.type === 'ack')?.duplicate).toBe(true);
  expect(retry.frames.find((frame) => frame.type === 'ack')).toMatchObject({
    mutationId: sent.mutationId,
    revision: 2,
  });
  expect(retry.frames.filter((frame) => frame.type === 'edit')).toHaveLength(0);
  const refusedId = randomUUID();
  retry.socket.send(JSON.stringify({ ...sent, mutationId: refusedId }));
  await expect
    .poll(() => retry.frames.find((frame) => frame.mutationId === refusedId))
    .toEqual({
      type: 'resync',
      reason: 'stale',
      mutationId: refusedId,
    });
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(1);
});

test('only safe IDs from submitted requests correlate refusals; unsolicited and malformed frames do not', async () => {
  const f = await fixture();
  await f.prepare();
  const client = await f.connect();
  const mutationId = randomUUID();
  client.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId,
      baseRevision: 1,
      mutations: [{ id: 'unsupported.mutation', params: { unitId: f.sheet.id } }],
    }),
  );
  await expect
    .poll(() => client.frames.find((frame) => frame.type === 'resync'))
    .toEqual({
      type: 'resync',
      reason: 'unsupported',
      mutationId,
    });
  for (const message of [
    { type: 'submit', mutationId: 'unsafe secret id\n', baseRevision: 1, mutations: [] },
    { type: 'verify', revision: 1, hash: '0'.repeat(64), mutationId },
    { type: 'unknown', mutationId },
  ]) {
    const before = client.frames.filter((frame) => frame.type === 'resync').length;
    client.socket.send(JSON.stringify(message));
    await expect
      .poll(() => client.frames.filter((frame) => frame.type === 'resync').length)
      .toBe(before + 1);
    expect(client.frames.filter((frame) => frame.type === 'resync').at(-1)).not.toHaveProperty(
      'mutationId',
    );
  }
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(0);
});

test('same-account tabs keep distinct ephemeral members with saved profiles and remove closed or expired sessions', async () => {
  const f = await fixture();
  await f.prepare();
  new Profiles(f.auth).save(f.owner.id, {
    name: 'Saved owner',
    icon: 'lucide:flower',
    color: 'info-strong',
  });
  const one = await f.connect(),
    two = await f.connect();
  const editor = await f.connect(f.prefix, f.sheet.id, f.cookie(f.editor.id));
  await expect.poll(() => presence(two.frames)?.members?.length).toBe(3);
  const firstId = presence(one.frames)!.selfId!,
    secondId = presence(two.frames)!.selfId!;
  expect(firstId).not.toBe(secondId);
  expect(firstId).not.toBe(f.owner.id);
  expect(presence(two.frames)!.members!.filter((member) => member.name === 'Saved owner')).toEqual([
    { id: firstId, name: 'Saved owner', avatar: '/profile-avatar/flower/info-strong.svg' },
    { id: secondId, name: 'Saved owner', avatar: '/profile-avatar/flower/info-strong.svg' },
  ]);
  one.socket.send(JSON.stringify({ type: 'cursor', selection: 'first!A1:B2' }));
  await expect
    .poll(() => presence(two.frames)?.members?.find((member) => member.id === firstId)?.selection)
    .toBe('first!A1:B2');
  one.socket.send(JSON.stringify({ type: 'cursor', selection: '' }));
  await expect
    .poll(() => presence(two.frames)?.members?.find((member) => member.id === firstId)?.selection)
    .toBeUndefined();
  one.socket.close();
  await expect.poll(() => presence(two.frames)?.members?.length).toBe(2);
  expect(presence(two.frames)!.members!.some((member) => member.id === firstId)).toBe(false);
  const rejoined = await f.connect();
  await expect.poll(() => presence(two.frames)?.members?.length).toBe(3);
  expect(presence(rejoined.frames)!.selfId).not.toBe(firstId);
  const editorId = presence(editor.frames)!.selfId!;
  f.db
    .prepare('UPDATE auth_sessions SET expires_at=0 WHERE token_hash=?')
    .run(f.sessions.get(f.editor.id)!.session.token_hash);
  await expect.poll(() => editor.socket.readyState).toBe(WebSocket.CLOSED);
  await expect.poll(() => presence(two.frames)?.members?.length).toBe(2);
  expect(presence(two.frames)!.members!.some((member) => member.id === editorId)).toBe(false);
});

test('cursor grammar, scope fields, payload size and per-client floods are bounded without persisting presence', async () => {
  const f = await fixture();
  await f.prepare();
  const observer = await f.connect();
  for (const message of [
    { type: 'cursor', selection: 'first!A0' },
    { type: 'cursor', selection: 'x'.repeat(161) },
    { type: 'cursor', selection: '<script>private data</script>' },
    { type: 'cursor', selection: 'first!A1', name: 'Forged name' },
    { type: 'cursor', selection: 'first!A1', unitId: randomUUID() },
    { type: 'cursor', selection: 'first!A1', memberId: 'Forged identity' },
    { type: 'cursor', selection: { private: 'contents' } },
    ' '.repeat(600) + JSON.stringify({ type: 'cursor', selection: 'first!A1' }),
  ]) {
    const client = await f.connect();
    client.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
    await expect.poll(() => presence(observer.frames)?.members?.length).toBe(1);
  }
  expect(JSON.stringify(observer.frames)).not.toContain('Forged');
  expect(JSON.stringify(observer.frames)).not.toContain('private data');
  const flood = await f.connect();
  const before = observer.frames.filter((frame) => frame.type === 'presence').length;
  for (let index = 0; index < 50; index++)
    flood.socket.send(JSON.stringify({ type: 'cursor', selection: `first!A${index + 1}` }));
  await expect.poll(() => flood.socket.readyState).toBe(WebSocket.CLOSED);
  await expect.poll(() => presence(observer.frames)?.members?.length).toBe(1);
  expect(
    observer.frames.filter((frame) => frame.type === 'presence').length - before,
  ).toBeLessThanOrEqual(21);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(0);
  const snapshot = await (await f.send(`${f.prefix}/snapshot?unitId=${f.sheet.id}`)).json();
  expect(snapshot.revision).toBe(1);
  expect(JSON.stringify(snapshot.snapshot)).not.toContain('selection');
});

test('heartbeat removes a dead tab while a responding tab keeps its presence', async () => {
  const f = await fixture();
  await f.prepare();
  const observer = await f.connect();
  const dead = await f.connect(f.prefix, f.sheet.id, f.cookie(), undefined, undefined, false);
  await expect.poll(() => presence(observer.frames)?.members?.length).toBe(2);
  const deadId = presence(dead.frames)!.selfId!;
  let pings = 0;
  dead.socket.on('ping', () => pings++);
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  now += 15_001;
  await expect.poll(() => pings).toBe(1);
  now += 15_001;
  await expect.poll(() => dead.socket.readyState).toBe(WebSocket.CLOSED);
  await expect.poll(() => presence(observer.frames)?.members?.length).toBe(1);
  expect(presence(observer.frames)!.members!.some((member) => member.id === deadId)).toBe(false);
  expect(observer.socket.readyState).toBe(WebSocket.OPEN);
});

test('an active guest link anonymizes profiles for every recipient and expiry removes the guest before the next cursor', async () => {
  const f = await fixture();
  await f.prepare();
  new Profiles(f.auth).save(f.owner.id, {
    name: f.owner.name,
    icon: 'lucide:flower',
    color: 'info-strong',
  });
  const link = await (
    await f.send(`/api/items/${f.sheet.id}/link`, f.cookie(), 'PUT', { role: 'editor' })
  ).json();
  const entered = await f.send(`/api/guest/${f.sheet.id}/session`, '', 'POST', {
    token: new URL(link.url).hash.slice(1),
  });
  const guestCookie = entered.headers.get('set-cookie')!.split(';')[0];
  const prepared = await (
    await f.send(`/api/guest/${f.sheet.id}/collaboration`, guestCookie, 'POST', {})
  ).json();
  expect(prepared).toMatchObject({ syncVersion: 1, user: { name: 'Guest' } });
  const owner = await f.connect();
  await expect
    .poll(() => presence(owner.frames)?.members)
    .toEqual([{ id: presence(owner.frames)?.selfId, name: 'Collaborator', avatar: '' }]);
  const viewer = await f.connect(f.prefix, f.sheet.id, f.cookie(f.viewer.id));
  const guest = await f.connect(`/sync-api/guest/${f.sheet.id}`, f.sheet.id, guestCookie);
  await expect.poll(() => presence(owner.frames)?.members?.length).toBe(3);
  for (const client of [owner, viewer, guest]) {
    await expect.poll(() => presence(client.frames)?.members?.length).toBe(3);
    expect(presence(client.frames)!.members!.map((member) => [member.name, member.avatar])).toEqual(
      [
        ['Collaborator', ''],
        ['Collaborator', ''],
        ['Guest', ''],
      ],
    );
    expect(
      JSON.stringify(client.frames.filter((frame) => frame.type === 'presence')),
    ).not.toContain(f.owner.name);
    expect(JSON.stringify(client.frames)).not.toContain('/profile-avatar/');
  }
  guest.socket.send(JSON.stringify({ type: 'cursor', selection: 'first!C4' }));
  await expect
    .poll(
      () => presence(owner.frames)?.members?.find((member) => member.name === 'Guest')?.selection,
    )
    .toBe('first!C4');
  f.db.prepare('UPDATE workspace_guest_sessions SET expires_at=0 WHERE item_id=?').run(f.sheet.id);
  const before = guest.frames.length;
  owner.socket.send(JSON.stringify({ type: 'cursor', selection: 'first!E8' }));
  await expect.poll(() => guest.socket.readyState).toBe(WebSocket.CLOSED);
  await expect.poll(() => presence(owner.frames)?.members?.length).toBe(2);
  expect(
    guest.frames
      .slice(before)
      .some((frame) => frame.members?.some((member) => member.selection === 'first!E8')),
  ).toBe(false);
  expect(
    presence(owner.frames)!.members!.every(
      (member) => member.name === 'Collaborator' && member.avatar === '',
    ),
  ).toBe(true);
});

test('guest ticket failures distinguish root revocation from Origin, generation and backend errors', async () => {
  const f = await fixture();
  await f.prepare();
  const link = await (
    await f.send(`/api/items/${f.sheet.id}/link`, f.cookie(), 'PUT', { role: 'editor' })
  ).json();
  const entered = await f.send(`/api/guest/${f.sheet.id}/session`, '', 'POST', {
    token: new URL(link.url).hash.slice(1),
  });
  const guestCookie = entered.headers.get('set-cookie')!.split(';')[0];
  const base = `/sync-api/guest/${f.sheet.id}`;
  const url = `${base}/ticket?unitId=${f.sheet.id}`;
  await f.ticket(base, f.sheet.id, guestCookie);
  const stale = await f.send(`${base}/ticket?unitId=${randomUUID()}`, guestCookie, 'POST');
  expect(stale.status).toBe(403);
  expect(await stale.json()).toEqual({ error: 'This document is not available.' });
  const hostile = await f.send(url, guestCookie, 'POST', undefined, 'https://hostile.example');
  expect(hostile.status).toBe(403);
  expect(await hostile.json()).toEqual({ error: 'Open Spinel at its configured address.' });
  const principal = vi.spyOn(LinkAccess.prototype, 'principal').mockImplementation(() => {
    throw new Error('Private backend detail');
  });
  try {
    const failed = await f.send(url, guestCookie, 'POST');
    expect(failed.status).toBe(403);
    expect(await failed.json()).toEqual({ error: 'This document is not available.' });
  } finally {
    principal.mockRestore();
  }
  expect((await f.send(url, guestCookie, 'POST')).status).toBe(200);
  const disabled = await f.send(`/api/items/${f.sheet.id}/link`, f.cookie(), 'PUT', { role: null });
  expect(disabled.status).toBe(200);
  const revoked = await f.send(url, guestCookie, 'POST');
  expect(revoked.status).toBe(403);
  expect(await revoked.json()).toEqual({
    error: 'This document is not available.',
    code: 'guest-link-revoked',
  });
});

test('supervised expiry admits running cleanup, closes paused guests without writes and cleans up after resume', async () => {
  let status: MaintenanceAdminStatus = {
    available: true,
    phase: 'running',
    epoch: 'expiry-before',
    notice: null,
    operationId: randomUUID(),
    authorityExpiresAt: Date.now() + 60_000,
    generationId: randomUUID(),
    lastFailure: null,
    readyToResume: false,
  };
  const listeners = new Set<(status: MaintenancePublicStatus) => void>();
  const update = (patch: Partial<MaintenanceAdminStatus>) => {
    status = { ...status, ...patch };
    for (const listener of listeners) listener(publicMaintenance(status));
  };
  const bridge: MaintenanceBridge = {
    status: () => publicMaintenance(status),
    adminStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async control() {
      return { status };
    },
    drained() {},
    ready() {},
    fail() {
      throw new Error('Fixture drain failed.');
    },
    close() {},
  };
  const f = await fixture(bridge);
  await f.prepare();
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  const beginExpiry = vi.spyOn(LinkAccess.prototype, 'beginExpiry');
  const guestBase = `/sync-api/guest/${f.sheet.id}`;
  const state = () =>
    f.db.prepare('SELECT * FROM workspace_links WHERE item_id=?').get(f.sheet.id)!;
  for (const paused of [false, true]) {
    const linked = await f.send(`/api/items/${f.sheet.id}/link`, f.cookie(), 'PUT', {
      role: 'editor',
      expiryDays: 7,
    });
    expect(linked.status).toBe(200);
    const link = await linked.json();
    const entered = await f.send(`/api/guest/${f.sheet.id}/session`, '', 'POST', {
      token: new URL(link.url).hash.slice(1),
    });
    expect(entered.status).toBe(204);
    const guestCookie = entered.headers.get('set-cookie')!.split(';')[0];
    const guest = await f.connect(guestBase, f.sheet.id, guestCookie);
    const unused = await f.ticket(guestBase, f.sheet.id, guestCookie);
    beginExpiry.mockClear();
    if (paused) {
      update({ phase: 'paused', epoch: 'expiry-after' });
      expect(guest.socket.readyState).toBe(WebSocket.OPEN);
    }
    // Only fixture setup uses this separate connection. The timer's app handle
    // has the real write guard and must acquire its own running admission.
    f.db
      .prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?')
      .run(Date.now(), f.sheet.id);
    const expired = state();
    await expect.poll(() => guest.socket.readyState).toBe(WebSocket.CLOSED);
    expect((await f.send(`/api/guest/${f.sheet.id}`, guestCookie)).status).toBe(404);
    if (paused) {
      expect(beginExpiry).not.toHaveBeenCalled();
      expect(state()).toEqual(expired);
      expect(
        f.db
          .prepare('SELECT count(*) AS n FROM workspace_guest_sessions WHERE item_id=?')
          .get(f.sheet.id)?.n,
      ).toBe(1);
      expect(f.app.maintenance.pending).toBe(0);
      update({ phase: 'running' });
    }
    await expect
      .poll(() => state())
      .toMatchObject({
        epoch: link.epoch + 1,
        state: 'off',
        token_hash: null,
        preview_hash: null,
      });
    expect(beginExpiry).toHaveBeenCalled();
    expect(
      f.db
        .prepare('SELECT count(*) AS n FROM workspace_guest_sessions WHERE item_id=?')
        .get(f.sheet.id)?.n,
    ).toBe(0);
    await f.rejectedSocket(unused, guestBase, f.sheet.id, guestCookie);
    expect(diagnostic).not.toHaveBeenCalled();
  }
});

test.each(['scan', 'fence', 'finish'] as const)(
  'expiry cleanup %s failures stay private, close guests and retry without starving another root',
  async (failure) => {
    const f = await fixture();
    await f.prepare();
    const other = f.workspace.create(f.owner.id, {
      kind: 'doc',
      name: 'Other private root',
      parentId: null,
    });
    const link = await (
      await f.send(`/api/items/${f.sheet.id}/link`, f.cookie(), 'PUT', { role: 'editor' })
    ).json();
    const otherLink = await (
      await f.send(`/api/items/${other.id}/link`, f.cookie(), 'PUT', { role: 'viewer' })
    ).json();
    const entered = await f.send(`/api/guest/${f.sheet.id}/session`, '', 'POST', {
      token: new URL(link.url).hash.slice(1),
    });
    const guestCookie = entered.headers.get('set-cookie')!.split(';')[0];
    await f.send(`/api/guest/${f.sheet.id}/collaboration`, guestCookie, 'POST', {});
    const guestBase = `/sync-api/guest/${f.sheet.id}`;
    const guest = await f.connect(guestBase, f.sheet.id, guestCookie);
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scan =
      failure === 'scan'
        ? vi.spyOn(LinkAccess.prototype, 'expiring').mockImplementation(() => {
            throw new Error('Private title must not reach diagnostics');
          })
        : undefined;
    if (failure !== 'scan')
      f.db.exec(`CREATE TRIGGER fail_guest_expiry BEFORE UPDATE OF state ON workspace_links
      WHEN NEW.item_id='${f.sheet.id}' AND NEW.state='${failure === 'fence' ? 'pending' : 'off'}'
      BEGIN SELECT RAISE(ABORT, 'Private title must not reach diagnostics'); END`);
    f.db
      .prepare('UPDATE workspace_links SET expires_at=? WHERE item_id IN (?,?)')
      .run(Date.now(), f.sheet.id, other.id);
    await expect.poll(() => diagnostic.mock.calls.length).toBe(1);
    await expect.poll(() => guest.socket.readyState).toBe(WebSocket.CLOSED);
    if (failure !== 'scan')
      await expect
        .poll(
          () =>
            f.db.prepare('SELECT state FROM workspace_links WHERE item_id=?').get(other.id)?.state,
        )
        .toBe('off');
    expect(
      f.db.prepare('SELECT state FROM workspace_links WHERE item_id=?').get(f.sheet.id)?.state,
    ).toBe(failure === 'finish' ? 'pending' : 'active');
    const denied = await f.send(`${guestBase}/ticket?unitId=${f.sheet.id}`, guestCookie, 'POST');
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: 'This document is not available.',
      code: 'guest-link-revoked',
    });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(diagnostic.mock.calls).toEqual([
      ['Guest link expiry cleanup failed; access stays closed and cleanup will retry.'],
    ]);
    if (scan) scan.mockRestore();
    else f.db.exec('DROP TRIGGER fail_guest_expiry');
    for (const [id, epoch] of [
      [f.sheet.id, link.epoch],
      [other.id, otherLink.epoch],
    ] as const) {
      await expect
        .poll(() =>
          f.db
            .prepare(
              'SELECT epoch,state,token_hash,preview_hash FROM workspace_links WHERE item_id=?',
            )
            .get(id),
        )
        .toEqual({ epoch: epoch + 1, state: 'off', token_hash: null, preview_hash: null });
      expect(
        f.db.prepare('SELECT count(*) AS n FROM workspace_guest_sessions WHERE item_id=?').get(id)
          ?.n,
      ).toBe(0);
    }
  },
);

test('Origin, one-time tickets, operator/viewer boundaries and revoked recipients are enforced over real ingress', async () => {
  const f = await fixture();
  await f.prepare();
  const url = `${f.prefix}/ticket?unitId=${f.sheet.id}`;
  expect((await f.send(url, '', 'POST')).status).toBe(403);
  expect((await f.send(url, f.cookie(f.operator.id), 'POST')).status).toBe(403);
  expect((await f.send(url, f.cookie(), 'POST', undefined, 'https://hostile.example')).status).toBe(
    403,
  );
  const token = await f.ticket();
  await f.rejectedSocket(token, f.prefix, f.sheet.id, f.cookie(), 'https://hostile.example');
  await f.rejectedSocket(token, f.prefix, f.sheet.id, f.cookie(f.editor.id));
  for (const after of ['0', '-1', '1.5', 'Infinity', '9007199254740992', '1&afterRevision=2'])
    await f.rejectedSocket(token, undefined, undefined, undefined, undefined, after);
  const owner = await f.connect(f.prefix, f.sheet.id, f.cookie(), token);
  await f.rejectedSocket(token);
  const viewer = await f.connect(f.prefix, f.sheet.id, f.cookie(f.viewer.id));
  const deniedAudit = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const deniedId = randomUUID();
  viewer.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: deniedId,
      baseRevision: 1,
      mutations: [f.mutation('forged')],
    }),
  );
  await expect.poll(() => viewer.frames.some((frame) => frame.type === 'resync')).toBe(true);
  expect(viewer.frames.find((frame) => frame.type === 'resync')).toMatchObject({
    mutationId: deniedId,
  });
  const audits = deniedAudit.mock.calls
    .map(([value]) => JSON.parse(String(value)))
    .filter((entry) => entry.event === 'collaboration.edit_denied');
  expect(audits).toEqual([
    {
      event: 'collaboration.edit_denied',
      at: expect.any(String),
      stage: 'submitChangeset',
      userID: f.viewer.id,
      unitID: f.sheet.id,
    },
  ]);
  expect(JSON.stringify(audits)).not.toContain('forged');
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(0);
  const editor = await f.connect(f.prefix, f.sheet.id, f.cookie(f.editor.id));
  f.db
    .prepare('DELETE FROM auth_sessions WHERE token_hash=?')
    .run(f.sessions.get(f.editor.id)!.session.token_hash);
  owner.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 1,
      mutations: [f.mutation('accepted')],
    }),
  );
  await expect.poll(() => owner.frames.some((frame) => frame.type === 'ack')).toBe(true);
  await expect.poll(() => editor.socket.readyState).toBe(WebSocket.CLOSED);
  expect(editor.frames.filter((frame) => frame.type === 'edit')).toHaveLength(0);
  owner.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 2,
      mutations: [f.mutation('cross-document', 0, randomUUID())],
    }),
  );
  await expect.poll(() => owner.frames.some((frame) => frame.type === 'resync')).toBe(true);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()!.n).toBe(1);
});

test.each(['turn off', 'expire'] as const)(
  'Space sockets bind root plus child and %s fences every child, guest and old ticket',
  async (action) => {
    const f = await fixture();
    const space = f.spaces.createRoot(f.owner.id, { name: 'Private Space', parentId: null }).space;
    const sheet = f.spaces.createChild(f.owner.id, space.id, {
      name: 'Sheet',
      kind: 'sheet',
      parentId: space.id,
    }).item;
    const doc = f.spaces.createChild(f.owner.id, space.id, {
      name: 'Doc',
      kind: 'doc',
      parentId: space.id,
    }).item;
    const otherSpace = f.spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
    f.spaces.share(f.owner.id, space.id, f.editor.id, 'admin');
    const base = (id: string, root = space.id) => `/sync-api/spaces/${root}/items/${id}`;
    for (const item of [sheet, doc]) {
      const response = await f.send(
        `/api/spaces/${space.id}/items/${item.id}/collaboration`,
        f.cookie(),
        'POST',
        {},
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ syncVersion: 1 });
    }
    expect(
      (
        await f.send(
          `${base(sheet.id, otherSpace.id)}/ticket?unitId=${sheet.id}`,
          f.cookie(),
          'POST',
        )
      ).status,
    ).toBe(403);
    expect(
      (await f.send(`/sync-api/items/${sheet.id}/ticket?unitId=${sheet.id}`, f.cookie(), 'POST'))
        .status,
    ).toBe(403);
    const sheetSocket = await f.connect(base(sheet.id), sheet.id, f.cookie(f.editor.id));
    const docSocket = await f.connect(base(doc.id), doc.id, f.cookie(f.editor.id));
    expect(docSocket.frames[0].snapshot).toMatchObject({ drawings: {}, drawingsOrder: [] });
    const oldTicket = await f.ticket(base(doc.id), doc.id);
    const enabled = await f.send(`/api/items/${space.id}/link`, f.cookie(), 'PUT', {
      role: 'editor',
    });
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    await expect.poll(() => sheetSocket.socket.readyState).toBe(WebSocket.CLOSED);
    await expect.poll(() => docSocket.socket.readyState).toBe(WebSocket.CLOSED);
    await f.rejectedSocket(oldTicket, base(doc.id), doc.id);
    const link = await enabled.json();
    const entered = await f.send(`/api/guest/${space.id}/session`, '', 'POST', {
      token: new URL(link.url).hash.slice(1),
    });
    expect(entered.status).toBe(204);
    const guestCookie = entered.headers.get('set-cookie')!.split(';')[0];
    const guestBase = `/sync-api/guest-spaces/${space.id}/items/${sheet.id}`;
    const guestPrepared = await f.send(
      `/api/guest-spaces/${space.id}/items/${sheet.id}/collaboration`,
      guestCookie,
      'POST',
      {},
    );
    expect(await guestPrepared.json()).toMatchObject({ syncVersion: 1, user: { name: 'Guest' } });
    for (const path of [
      `${guestBase}/ticket?unitId=${randomUUID()}`,
      `/sync-api/guest-spaces/${space.id}/items/${randomUUID()}/ticket?unitId=${sheet.id}`,
    ]) {
      const denied = await f.send(path, guestCookie, 'POST');
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: 'This document is not available.' });
    }
    const guest = await f.connect(guestBase, sheet.id, guestCookie);
    const anonymousAccount = await f.connect(base(sheet.id), sheet.id);
    const otherChild = await f.connect(base(doc.id), doc.id);
    await expect.poll(() => presence(guest.frames)?.members?.length).toBe(2);
    for (const client of [guest, anonymousAccount])
      expect(
        presence(client.frames)!.members!.map((member) => [member.name, member.avatar]),
      ).toEqual([
        ['Guest', ''],
        ['Collaborator', ''],
      ]);
    guest.socket.send(JSON.stringify({ type: 'cursor', selection: 'first!D4' }));
    await expect
      .poll(() =>
        presence(anonymousAccount.frames)?.members?.some(
          (member) => member.selection === 'first!D4',
        ),
      )
      .toBe(true);
    expect(presence(otherChild.frames)!.members).toHaveLength(1);
    expect(
      JSON.stringify(otherChild.frames.filter((frame) => frame.type === 'presence')),
    ).not.toContain('first!D4');
    otherChild.socket.send(JSON.stringify({ type: 'cursor', selection: '0:0:0:TEXT::-1' }));
    await expect
      .poll(() => presence(otherChild.frames)?.members?.[0].selection)
      .toBe('0:0:0:TEXT::-1');
    expect(JSON.stringify(guest.frames)).not.toContain(f.owner.name);
    guest.socket.send(
      JSON.stringify({
        type: 'submit',
        mutationId: randomUUID(),
        baseRevision: 1,
        mutations: [f.mutation('guest', 0, sheet.id)],
      }),
    );
    await expect.poll(() => guest.frames.some((frame) => frame.type === 'ack')).toBe(true);
    const pendingGuestTicket = await f.ticket(guestBase, sheet.id, guestCookie);
    if (action === 'turn off') {
      const rotation = await f.send(`/api/items/${space.id}/link`, f.cookie(), 'PUT', {
        role: null,
      });
      expect(rotation.status).toBe(200);
    } else {
      // No incoming request or edit is needed: the existing timer closes idle views.
      f.db
        .prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?')
        .run(Date.now(), space.id);
    }
    await expect.poll(() => guest.socket.readyState).toBe(WebSocket.CLOSED);
    await expect.poll(() => anonymousAccount.socket.readyState).toBe(WebSocket.CLOSED);
    await expect.poll(() => otherChild.socket.readyState).toBe(WebSocket.CLOSED);
    expect((await f.send(`${guestBase}/snapshot?unitId=${sheet.id}`, guestCookie)).status).toBe(
      403,
    );
    await f.rejectedSocket(pendingGuestTicket, guestBase, sheet.id, guestCookie);
    const denied = await f.send(`${guestBase}/ticket?unitId=${sheet.id}`, guestCookie, 'POST');
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: 'This document is not available.',
      code: 'guest-link-revoked',
    });
    expect(
      (
        await f.send(`/api/guest/${space.id}/session`, '', 'POST', {
          token: new URL(link.url).hash.slice(1),
        })
      ).status,
    ).toBe(404);
    expect(
      f.db
        .prepare('SELECT epoch,state,token_hash,preview_hash FROM workspace_links WHERE item_id=?')
        .get(space.id),
    ).toEqual({ epoch: link.epoch + 1, state: 'off', token_hash: null, preview_hash: null });
  },
);

test('a root account downgrade and revocation fence every native child connection and old ticket', async () => {
  const f = await fixture();
  const space = f.spaces.createRoot(f.owner.id, { name: 'Shared Space', parentId: null }).space;
  f.spaces.share(f.owner.id, space.id, f.editor.id, 'editor');
  const sheet = f.spaces.createChild(f.owner.id, space.id, {
    name: 'Sheet',
    kind: 'sheet',
    parentId: space.id,
  }).item;
  const doc = f.spaces.createChild(f.owner.id, space.id, {
    name: 'Doc',
    kind: 'doc',
    parentId: space.id,
  }).item;
  const base = (id: string) => `/sync-api/spaces/${space.id}/items/${id}`;
  for (const item of [sheet, doc])
    expect(
      (
        await f.send(
          `/api/spaces/${space.id}/items/${item.id}/collaboration`,
          f.cookie(),
          'POST',
          {},
        )
      ).status,
    ).toBe(200);
  const sheetEditor = await f.connect(base(sheet.id), sheet.id, f.cookie(f.editor.id));
  const docEditor = await f.connect(base(doc.id), doc.id, f.cookie(f.editor.id));
  const owner = await f.connect(base(sheet.id), sheet.id);
  const oldTicket = await f.ticket(base(doc.id), doc.id, f.cookie(f.editor.id));
  const before = sheetEditor.frames.length;
  f.spaces.share(f.owner.id, space.id, f.editor.id, 'viewer');
  owner.socket.send(JSON.stringify({ type: 'cursor', selection: 'first!Z9' }));
  await expect.poll(() => sheetEditor.socket.readyState).toBe(WebSocket.CLOSED);
  await expect.poll(() => docEditor.socket.readyState).toBe(WebSocket.CLOSED);
  await expect.poll(() => presence(owner.frames)?.members?.length).toBe(1);
  expect(
    sheetEditor.frames
      .slice(before)
      .some((frame) => frame.members?.some((member) => member.selection === 'first!Z9')),
  ).toBe(false);
  await f.rejectedSocket(oldTicket, base(doc.id), doc.id, f.cookie(f.editor.id));
  const viewer = await f.connect(base(sheet.id), sheet.id, f.cookie(f.editor.id));
  const viewerId = presence(viewer.frames)!.selfId;
  f.spaces.share(f.owner.id, space.id, f.editor.id, null);
  owner.socket.send(
    JSON.stringify({
      type: 'submit',
      mutationId: randomUUID(),
      baseRevision: 1,
      mutations: [f.mutation('Only currently authorized recipients see this', 0, sheet.id)],
    }),
  );
  await expect.poll(() => owner.frames.some((frame) => frame.type === 'ack')).toBe(true);
  await expect.poll(() => viewer.socket.readyState).toBe(WebSocket.CLOSED);
  expect(viewer.frames.filter((frame) => frame.type === 'edit')).toHaveLength(0);
  await expect
    .poll(() => presence(owner.frames)?.members?.some((member) => member.id === viewerId))
    .toBe(false);
});
