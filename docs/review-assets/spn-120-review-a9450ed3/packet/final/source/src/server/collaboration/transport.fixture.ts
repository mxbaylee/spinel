import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterEach, expect, vi } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';

export interface Frame {
  type: string;
  mutationId?: string;
  revision?: number;
  reason?: string;
  [key: string]: unknown;
}
export interface SocketClient {
  socket: WebSocket;
  messages: Frame[];
  status: number;
}

/** Capture the native handshake and frames; the caller owns socket cleanup. */
export async function openSyncSocket(
  url: string,
  credential: string,
  origin: string,
  sockets: WebSocket[],
): Promise<SocketClient> {
  const socket = new WebSocket(url, { headers: { Cookie: credential, Origin: origin } });
  sockets.push(socket);
  const messages: Frame[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  const status = await new Promise<number>((resolve, reject) => {
    socket.once('open', () => resolve(101));
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
    });
  });
  return { socket, messages, status };
}

interface ConnectionOptions {
  id?: string;
  unitId?: string;
  credential?: string;
  prefix?: string;
  ticket?: string;
  origin?: string;
  afterRevision?: number;
}
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

/** Real HTTP, SQLite and WebSocket fixture shared by the cutover regression suites. */
export async function transportFixture(
  options: {
    space?: boolean;
    spacesEnabled?: boolean;
    role?: 'editor' | 'admin';
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-native-transport-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const filename = join(directory, 'app.sqlite');
  const origin = 'http://localhost:3000';
  const spaceReview = options.spacesEnabled ?? true;
  const app = await createApp({
    databasePath: filename,
    staticDirectory: directory,
    origin,
    spaceReview,
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
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: spaceReview });
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Private Person Name');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const outsider = auth.createUser('Outsider');
  const operator = auth.createUser('Operator', true);
  const folder = workspace.create(owner.id, {
    kind: 'folder',
    name: 'Outside project',
    parentId: null,
  });
  const space = options.space
    ? spaces.createRoot(owner.id, { name: 'Review Space', parentId: folder.id }).space
    : undefined;
  const sheet = space
    ? spaces.createChild(owner.id, space.id, {
        kind: 'sheet',
        name: 'Private sheet',
        parentId: space.id,
      }).item
    : workspace.create(owner.id, { kind: 'sheet', name: 'Private sheet', parentId: null });
  const doc = space
    ? spaces.createChild(owner.id, space.id, {
        kind: 'doc',
        name: 'Private doc',
        parentId: sheet.id,
      }).item
    : workspace.create(owner.id, { kind: 'doc', name: 'Private doc', parentId: null });
  for (const [user, role] of [
    [editor, options.role ?? 'editor'],
    [viewer, 'viewer'],
  ] as const) {
    if (space) spaces.share(owner.id, space.id, user.id, role);
    else for (const item of [sheet, doc]) workspace.share(owner.id, item.id, user.id, role);
  }
  const sessions = new Map(
    [owner, editor, viewer, outsider, operator].map((user) => [
      user.id,
      auth.createSession(user.id),
    ]),
  );
  const cookie = (user = owner.id) => `${COOKIE_NAME}=${sessions.get(user)!.token}`;
  const base = (id = sheet.id, spaceId = space?.id) =>
    spaceId ? `/sync-api/spaces/${spaceId}/items/${id}` : `/sync-api/items/${id}`;
  const api = (id = sheet.id) =>
    space ? `/api/spaces/${space.id}/items/${id}` : `/api/items/${id}`;
  const send = (
    path: string,
    credential = cookie(),
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    suppliedOrigin = origin,
  ) =>
    fetch(root + path, {
      method,
      headers: {
        Cookie: credential,
        Origin: suppliedOrigin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const prepare = async (id = sheet.id, credential = cookie(), prefix = api(id)) => {
    const response = await send(prefix + '/collaboration', credential, {});
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.syncVersion).toBe(1);
    return result as { unitId: string; revisionOffset: number; access: string };
  };
  const snapshot = (id = sheet.id, credential = cookie(), unitId = id, prefix = base(id)) =>
    send(`${prefix}/snapshot?unitId=${unitId}`, credential);
  const ticket = async ({
    id = sheet.id,
    unitId = id,
    credential = cookie(),
    prefix = base(id),
  }: ConnectionOptions = {}) => {
    const response = await send(`${prefix}/ticket?unitId=${unitId}`, credential, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return (await response.json()).ticket as string;
  };
  const open = async (settings: ConnectionOptions = {}): Promise<SocketClient> => {
    const {
      id = sheet.id,
      unitId = id,
      credential = cookie(),
      prefix = base(id),
      origin: suppliedOrigin = origin,
      afterRevision,
    } = settings;
    const token = settings.ticket ?? (await ticket(settings));
    return openSyncSocket(
      `${root.replace('http:', 'ws:')}${prefix}/socket?unitId=${unitId}&ticket=${encodeURIComponent(token)}${afterRevision === undefined ? '' : `&afterRevision=${afterRevision}`}`,
      credential,
      suppliedOrigin,
      sockets,
    );
  };
  const connect = async (settings: ConnectionOptions = {}) => {
    const client = await open(settings);
    expect(client.status).toBe(101);
    await expect
      .poll(() =>
        client.messages.some((frame) => ['snapshot', 'resume', 'resync'].includes(frame.type)),
      )
      .toBe(true);
    await expect.poll(() => client.messages.some((frame) => frame.type === 'presence')).toBe(true);
    return client;
  };
  const submit = async (
    client: SocketClient,
    value: string,
    baseRevision = 1,
    unitId = sheet.id,
    extra: Record<string, unknown> = {},
  ) => {
    const mutationId = randomUUID();
    client.socket.send(
      JSON.stringify({
        type: 'submit',
        mutationId,
        baseRevision,
        mutations: [
          {
            id: 'sheet.mutation.set-range-values',
            params: { unitId, subUnitId: 'first', cellValue: { 0: { 0: { v: value } } } },
          },
        ],
        ...extra,
      }),
    );
    await expect
      .poll(
        () =>
          client.messages.some(
            (frame) => frame.mutationId === mutationId && ['ack', 'resync'].includes(frame.type),
          ) || client.socket.readyState === WebSocket.CLOSED,
      )
      .toBe(true);
    return client.messages.find(
      (frame) => frame.mutationId === mutationId && ['ack', 'resync'].includes(frame.type),
    );
  };
  return {
    app,
    root,
    origin,
    db,
    auth,
    workspace,
    spaces,
    space,
    folder,
    sheet,
    doc,
    owner,
    editor,
    viewer,
    outsider,
    operator,
    sessions,
    cookie,
    base,
    api,
    send,
    prepare,
    snapshot,
    ticket,
    open,
    connect,
    submit,
  };
}
