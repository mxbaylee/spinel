import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { createServer, request as tlsRequest } from 'node:https';
import type { Server as HttpsServer } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JSONX, TextX, TextXActionType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { NativeSnapshot } from '@spinel/sync-client';
import type { Mutation } from '@spinel/sync-transform';
import WebSocket from 'ws';
import { createApp } from '../../server/app.ts';
import { openDatabase } from '../../server/database.ts';
import type { DatabaseSync } from '../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../../src/server/auth/store.ts';
import { WorkspaceStore } from '../../src/server/workspace/store.ts';
import { docImageSnapshot } from '../../e2e/doc-image-fixture.ts';
import { offlineSheetImages } from '../../e2e/offline-fixture.ts';

export type DesktopSnapshot = { unitId: string; revision: number; snapshot: NativeSnapshot };
export type DesktopItem = {
  id: string;
  name: string;
  kind: 'sheet' | 'doc';
  outcome: 'normal' | 'conflict';
  unitId: string;
  baseline: DesktopSnapshot;
};
type Frame = Record<string, unknown> & { type: string };
type ImageRow = { id: string; mime: string; bytes: string };

async function bounded<T>(work: Promise<T>, label: string, timeout = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeout);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Initial synthetic server seeding only. Browser storage is always created by the product UI. */
export async function createDesktopOfflineFixture(options: {
  directory: string;
  keyPath: string;
  certPath: string;
  staticDirectory?: string;
}) {
  const origin = 'https://localhost:8176';
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true });
  const databasePath = join(directory, 'app.sqlite');
  // A new fixture must not silently reuse a previous acceptance run's server state.
  const created = await open(databasePath, 'wx');
  await created.close();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let db: DatabaseSync | undefined;
  let tls: HttpsServer | undefined;
  let closing: Promise<void> | undefined;
  let offline = false;
  const sockets = new Set<Socket>();
  const controls = new Set<WebSocket>();
  const counts = {
    forwardedRequests: 0,
    blockedRequests: 0,
    forwardedUpgrades: 0,
    blockedUpgrades: 0,
    logins: 0,
  };
  const track = (socket: Socket) => {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  async function setOffline(value: boolean) {
    offline = value;
    if (!value) return;
    for (const socket of sockets) socket.destroy();
    const deadline = Date.now() + 5000;
    while (sockets.size && Date.now() < deadline) await delay(20);
    assert.equal(sockets.size, 0, 'Closing browser transports timed out.');
  }
  function close() {
    closing ??= (async () => {
      const errors: unknown[] = [];
      try {
        await setOffline(true);
      } catch (error) {
        errors.push(error);
      }
      for (const socket of controls) socket.terminate();
      if (tls?.listening) {
        try {
          await bounded(
            new Promise<void>((resolveClose, reject) => {
              tls!.close((error) => (error ? reject(error) : resolveClose()));
              tls!.closeAllConnections();
            }),
            'Closing HTTPS listener',
            5000,
          );
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        if (app) await bounded(app.close(), 'Closing native application', 30_000);
      } catch (error) {
        errors.push(error);
      } finally {
        try {
          db?.close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Desktop fixture teardown failed.');
    })();
    return closing;
  }
  try {
    const starting = createApp({
      origin,
      databasePath,
      staticDirectory: options.staticDirectory ?? resolve('dist'),
    });
    try {
      app = await bounded(starting, 'Starting native application', 60_000);
    } catch (error) {
      // A timed-out initialization cannot later publish an unowned live fixture.
      void starting.then((late) => late.close()).catch(() => {});
      throw error;
    }
    db = openDatabase(databasePath);
    const database = db;
    const auth = new AuthStore(database);
    const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
    const owner = auth.createUser('Desktop offline owner');
    const actor = auth.createUser('Desktop offline collaborator');
    const ownerSession = auth.createSession(owner.id);
    const actorSession = auth.createSession(actor.id);
    const credentials = {
      owner: `${COOKIE_NAME}=${ownerSession.token}`,
      actor: `${COOKIE_NAME}=${actorSession.token}`,
    };
    await bounded(
      new Promise<void>((resolveListen, reject) => {
        const failed = (error: Error) => reject(error);
        app!.server.once('error', failed);
        app!.server.listen(0, '127.0.0.1', () => {
          app!.server.off('error', failed);
          resolveListen();
        });
      }),
      'Starting loopback control listener',
      5000,
    );
    const controlOrigin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    async function api<T>(
      path: string,
      method = 'GET',
      body?: unknown,
      account: keyof typeof credentials = 'owner',
    ): Promise<T> {
      const response = await fetch(controlOrigin + path, {
        method,
        headers: {
          Cookie: credentials[account],
          Origin: origin,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new Error(
          `Fixture ${method} ${path} failed: ${response.status} ${(await response.text()).slice(0, 1000)}`,
        );
      return (await response.json()) as T;
    }
    const read = (itemId: string, unitId: string) =>
      api<DesktopSnapshot>(
        `/sync-api/items/${encodeURIComponent(itemId)}/snapshot?unitId=${encodeURIComponent(unitId)}`,
        'GET',
        undefined,
        'actor',
      );
    async function readRecovered(copyId: string) {
      const prepared = await api<{ unitId: string; syncVersion: number }>(
        `/api/items/${encodeURIComponent(copyId)}/collaboration`,
        'POST',
        {},
        'actor',
      );
      assert.equal(prepared.syncVersion, 1);
      const recovered = await read(copyId, prepared.unitId);
      assert.equal(recovered.unitId, prepared.unitId);
      return recovered;
    }
    const recoveryMetadata = (copyId: string) => {
      const item = database
        .prepare('SELECT id,owner_id,parent_id,space_id FROM workspace_items WHERE id=?')
        .get(copyId);
      assert.ok(item, 'The recovered item must exist.');
      return item;
    };
    const imageRows = (itemId: string) =>
      database
        .prepare('SELECT id,mime,hex(data) AS bytes FROM doc_images WHERE item_id=? ORDER BY id')
        .all(itemId) as ImageRow[];
    const originalState = (item: Pick<DesktopItem, 'id' | 'unitId'>) => {
      const savedItem = database.prepare('SELECT * FROM workspace_items WHERE id=?').get(item.id);
      const unit = database
        .prepare('SELECT unit_id,revision,snapshot FROM spinel_sync_units WHERE unit_id=?')
        .get(item.unitId);
      assert.ok(savedItem && unit, 'The original item and native generation must still exist.');
      return { item: savedItem, unit, images: imageRows(item.id) };
    };
    const items: DesktopItem[] = [];
    const seeds = { sheet: await offlineSheetImages(), doc: await docImageSnapshot() };
    for (const kind of ['sheet', 'doc'] as const) {
      for (const outcome of ['normal', 'conflict'] as const) {
        const name = `Desktop ${outcome} ${kind}`;
        const imported = await api<{ item: { id: string; name: string } }>(
          '/api/items/import',
          'POST',
          {
            filename: `${name}.univer.json`,
            parentId: null,
            snapshot: seeds[kind],
          },
        );
        assert.equal(imported.item.name, name);
        workspace.share(owner.id, imported.item.id, actor.id, 'editor');
        const prepared = await api<{ unitId: string; syncVersion: number }>(
          `/api/items/${imported.item.id}/collaboration`,
          'POST',
          {},
        );
        assert.equal(prepared.syncVersion, 1);
        const baseline = await read(imported.item.id, prepared.unitId);
        assert.equal(baseline.unitId, prepared.unitId);
        assert.ok(
          imageRows(imported.item.id).length > 0,
          'Every desktop acceptance item must contain real image bytes.',
        );
        items.push({ ...imported.item, kind, outcome, unitId: prepared.unitId, baseline });
      }
    }

    const loginPath = `/_desktop-login/${randomBytes(32).toString('hex')}`;
    const loginURL = origin + loginPath;
    const certificate = await readFile(options.certPath);
    tls = createServer({ key: await readFile(options.keyPath), cert: certificate });
    tls.on('connection', track);
    tls.on('secureConnection', track);
    tls.on('request', (request, response) => {
      if (offline) {
        counts.blockedRequests++;
        request.socket.destroy();
        return;
      }
      if (request.url === loginPath) {
        if (
          counts.logins ||
          request.method !== 'GET' ||
          request.headers.host !== new URL(origin).host
        ) {
          response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
          return;
        }
        counts.logins++;
        response
          .writeHead(302, {
            'Set-Cookie': `${COOKIE_NAME}=${actorSession.token}; Secure; HttpOnly; SameSite=Strict; Path=/; Expires=${new Date(actorSession.session.expires_at).toUTCString()}`,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            Location: '/',
          })
          .end();
        return;
      }
      counts.forwardedRequests++;
      app!.server.emit('request', request, response);
    });
    tls.on('upgrade', (request, socket, head) => {
      if (offline) {
        counts.blockedUpgrades++;
        socket.destroy();
        return;
      }
      counts.forwardedUpgrades++;
      app!.server.emit('upgrade', request, socket, head);
    });
    await bounded(
      new Promise<void>((resolveListen, reject) => {
        const failed = (error: Error) => reject(error);
        tls!.once('error', failed);
        tls!.listen(8176, '127.0.0.1', () => {
          tls!.off('error', failed);
          resolveListen();
        });
      }),
      'Starting browser HTTPS listener',
      5000,
    );

    async function verifyDisconnected() {
      assert.equal(offline, true, 'Enable the real transport outage first.');
      const before = { ...counts };
      async function probe(upgrade: boolean) {
        return bounded(
          new Promise<void>((resolveProbe, reject) => {
            const outgoing = tlsRequest(
              {
                hostname: '127.0.0.1',
                port: 8176,
                servername: 'localhost',
                ca: certificate,
                agent: false,
                path: upgrade
                  ? `/sync-api/items/${items[0].id}/socket?unitId=${items[0].unitId}&ticket=outage-probe`
                  : '/api/health',
                headers: {
                  Host: new URL(origin).host,
                  Origin: origin,
                  ...(upgrade
                    ? {
                        Connection: 'Upgrade',
                        Upgrade: 'websocket',
                        'Sec-WebSocket-Version': '13',
                        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
                      }
                    : {}),
                },
              },
              (response) => {
                response.resume();
                reject(new Error(`Offline HTTPS unexpectedly returned ${response.statusCode}.`));
              },
            );
            outgoing.once('upgrade', (_response, socket) => {
              socket.destroy();
              reject(new Error('Offline WebSocket unexpectedly upgraded.'));
            });
            outgoing.once('error', () => resolveProbe());
            outgoing.setTimeout(4000, () => outgoing.destroy(new Error('Outage probe timed out.')));
            outgoing.end();
          }),
          'Verifying the real TLS outage',
          5000,
        );
      }
      await probe(false);
      await probe(true);
      assert.equal(counts.forwardedRequests, before.forwardedRequests);
      assert.equal(counts.forwardedUpgrades, before.forwardedUpgrades);
      assert.ok(
        counts.blockedRequests > before.blockedRequests,
        'The raw HTTPS request did not reach the outage gate.',
      );
      assert.ok(
        counts.blockedUpgrades > before.blockedUpgrades,
        'The raw upgrade did not reach the outage gate.',
      );
      return { ...counts, offline, activeBrowserSockets: sockets.size };
    }

    async function remoteEdit(item: DesktopItem) {
      assert.equal(offline, true, 'The conflicting live edit belongs inside the browser outage.');
      assert.equal(item.outcome, 'conflict');
      const before = await read(item.id, item.unitId);
      const images = imageRows(item.id);
      const path = `/sync-api/items/${item.id}`;
      const ticket = await api<{ ticket: string }>(
        `${path}/ticket?unitId=${encodeURIComponent(item.unitId)}`,
        'POST',
        {},
      );
      const socket = new WebSocket(
        `${controlOrigin.replace('http:', 'ws:')}${path}/socket?unitId=${encodeURIComponent(item.unitId)}&ticket=${encodeURIComponent(ticket.ticket)}`,
        {
          headers: { Cookie: credentials.owner, Origin: origin },
          handshakeTimeout: 10_000,
        },
      );
      controls.add(socket);
      socket.once('close', () => controls.delete(socket));
      const frames: Frame[] = [];
      let socketError: unknown;
      socket.on('error', (error) => {
        socketError = error;
      });
      socket.on('message', (data) => {
        try {
          assert.ok(frames.length < 128, 'Unexpected remote-edit frame volume.');
          frames.push(JSON.parse(data.toString()) as Frame);
        } catch (error) {
          socketError = error;
          socket.terminate();
        }
      });
      async function frame(predicate: (value: Frame) => boolean) {
        const deadline = Date.now() + 15_000;
        do {
          const found = frames.find(predicate);
          if (found) return found;
          if (socketError) throw socketError;
          assert.notEqual(
            socket.readyState,
            WebSocket.CLOSED,
            'The remote-edit socket closed before acknowledgement.',
          );
          await delay(20);
        } while (Date.now() < deadline);
        throw new Error('Waiting for native remote-edit evidence timed out.');
      }
      try {
        const initial = await frame((value) => ['snapshot', 'resync'].includes(value.type));
        assert.equal(initial.type, 'snapshot');
        assert.equal(initial.revision, before.revision);
        assert.deepEqual(initial.snapshot, before.snapshot);
        let mutation: Mutation;
        let replacement: IDocumentData['body'];
        if (item.kind === 'sheet') {
          const snapshot = before.snapshot as IWorkbookData;
          mutation = {
            id: 'sheet.mutation.set-range-values',
            params: {
              unitId: item.unitId,
              subUnitId: snapshot.sheetOrder[0],
              cellValue: { 0: { 3: { v: 824 } } },
            },
          };
        } else {
          const body = (before.snapshot as IDocumentData).body;
          assert.ok(body);
          const text = 'Live version 824 ';
          // Native TextX shifts paragraph/image/range anchors before the public
          // body replacement is submitted; no hand-written offset repair.
          replacement = TextX.apply(structuredClone(body), [
            { t: TextXActionType.INSERT, len: text.length, body: { dataStream: text } },
          ]);
          assert.equal(replacement.dataStream, text + body.dataStream);
          mutation = {
            id: 'doc.mutation.rich-text-editing',
            params: {
              unitId: item.unitId,
              textRanges: [],
              actions: new JSONX().replaceOp(['body'], body, replacement),
            },
          };
        }
        const mutationId = randomUUID();
        socket.send(
          JSON.stringify({
            type: 'submit',
            mutationId,
            baseRevision: before.revision,
            expectedRevision: before.revision,
            mutations: [mutation],
          }),
        );
        const acknowledgement = await frame(
          (value) => value.mutationId === mutationId && ['ack', 'resync'].includes(value.type),
        );
        assert.equal(acknowledgement.type, 'ack', JSON.stringify(acknowledgement));
        const after = await read(item.id, item.unitId);
        assert.equal(after.revision, before.revision + 1);
        assert.equal(acknowledgement.revision, after.revision);
        assert.deepEqual(imageRows(item.id), images);
        if (item.kind === 'sheet') {
          const snapshot = after.snapshot as IWorkbookData;
          assert.equal(snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[0]?.[3]?.v, 824);
        } else {
          const snapshot = after.snapshot as IDocumentData;
          assert.deepEqual(snapshot.body, replacement);
          for (const key of [
            'drawings',
            'drawingsOrder',
            'headers',
            'footers',
            'resources',
          ] as const) {
            assert.deepEqual(snapshot[key], (before.snapshot as IDocumentData)[key]);
          }
        }
        return { mutationId, beforeRevision: before.revision, after, acknowledgement };
      } finally {
        if (socket.readyState !== WebSocket.CLOSED) {
          const ended = new Promise<void>((resolveClosed) => socket.once('close', resolveClosed));
          socket.close(1000, 'Remote edit complete');
          try {
            await bounded(ended, 'Closing remote-edit socket', 5000);
          } finally {
            // terminate is a no-op once close completed, and bounds a failed close.
            socket.terminate();
          }
        }
      }
    }
    return {
      origin,
      loginURL,
      actor,
      owner,
      items,
      db: database,
      read,
      readRecovered,
      recoveryMetadata,
      originalState,
      imageRows,
      setOffline,
      verifyDisconnected,
      remoteEdit,
      close,
      get transport() {
        return { ...counts, offline, activeBrowserSockets: sockets.size };
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (teardown) {
      throw new AggregateError([error, teardown], 'Desktop fixture startup and teardown failed.');
    }
    throw error;
  }
}
