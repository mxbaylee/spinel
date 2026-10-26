/** Real HTTP/native overlap probe, isolated from the test runner's module loader. */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import type { ChildProcess, ForkOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { CombCmd, CmdRspCode, ErrorCode, UniverType } from '@univerjs/protocol';
import type { ICollaMsg } from '@univerjs/protocol';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';

type Message = {
  cmd: number;
  code?: number;
  infoRsp?: { memberID: string };
  collaMsg?: ICollaMsg;
};

async function until(check: () => unknown | Promise<unknown>, message: string) {
  const deadline = performance.now() + 5_000;
  do {
    if (await check()) return;
    await delay(10);
  } while (performance.now() < deadline);
  assert.fail(message);
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-pdf-overlap-'));
  const filename = join(directory, 'spinel.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const origin = 'http://localhost:3000';
  const app = await createApp({ databasePath: filename, staticDirectory: directory, origin });
  const db = openDatabase(filename);
  const sockets: WebSocket[] = [];
  const cancelled = new AbortController();
  const originalFork = childProcess.fork;
  let child: ChildProcess | undefined;
  let childClosed: Promise<NodeJS.Signals | null> | undefined;
  const ownerName = 'Private PDF overlap owner';
  const editorName = 'Private PDF overlap editor';
  const ownerValue = 'Confirmed owner value';
  const editorValue = 'Confirmed while PDF is running';
  let recoveredBytes!: Uint8Array;
  let peerEditAndHealthMs!: number;
  let cancelledChildSignal!: NodeJS.Signals | null;
  try {
    await new Promise<void>((accept) => app.server.listen(0, '127.0.0.1', accept));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser(ownerName),
      editor = auth.createUser(editorName);
    const item = workspace.create(owner.id, {
      name: 'Shared PDF overlap',
      kind: 'sheet',
      parentId: null,
    });
    new SheetStore(workspace).save(owner.id, item.id, {
      snapshot: {
        id: item.id,
        name: item.name,
        appVersion: '1.1.0',
        locale: 'enUS',
        styles: {},
        sheetOrder: ['first'],
        sheets: {
          first: {
            id: 'first',
            name: 'Summary',
            rowCount: 100,
            columnCount: 4,
            defaultColumnWidth: 300,
            defaultRowHeight: 24,
            cellData: Object.fromEntries(
              Array.from({ length: 90 }, (_, row) => [
                row,
                { 0: { v: `Confirmed paragraph ${String(row + 1).padStart(3, '0')}` } },
              ]),
            ),
          },
        },
      },
      revision: 0,
      writeId: randomUUID(),
    });
    workspace.share(owner.id, item.id, editor.id, 'editor');
    const headers = (user: string) => ({
      Cookie: `${COOKIE_NAME}=${auth.createSession(user).token}`,
      Origin: origin,
      'Content-Type': 'application/json',
    });
    const ownerHeaders = headers(owner.id),
      editorHeaders = headers(editor.id);
    const post = (path: string, body: unknown, credential = ownerHeaders, signal?: AbortSignal) =>
      fetch(`${root}${path}`, {
        method: 'POST',
        headers: credential,
        body: JSON.stringify(body),
        signal,
      });
    const prepare = await post(`/api/items/${item.id}/collaboration`, {});
    assert.equal(prepare.status, 200);
    const { unitId } = (await prepare.json()) as { unitId: string };
    const connect = async (credential: typeof ownerHeaders) => {
      const ticketResponse = await fetch(
        `${root}/universer-api/user/session-ticket?unitID=${unitId}`,
        { headers: credential },
      );
      assert.equal(ticketResponse.status, 200);
      const { ticket } = (await ticketResponse.json()) as { ticket: string };
      const socket = new WebSocket(
        `${root.replace('http:', 'ws:')}/universer-api/comb/connect?sessionTicket=${encodeURIComponent(ticket)}&unitID=${unitId}`,
        { headers: credential },
      );
      sockets.push(socket);
      const messages: Message[] = [];
      socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
      await new Promise<void>((accept, reject) => {
        socket.once('open', accept);
        socket.once('error', reject);
      });
      socket.send(JSON.stringify({ cmd: CombCmd.HELLO, routeKey: '', routeType: '' }));
      await until(
        () => messages.find((message) => message.cmd === CombCmd.HELLO)?.infoRsp?.memberID,
        'Editor did not receive HELLO.',
      );
      const memberID = messages.find((message) => message.cmd === CombCmd.HELLO)!.infoRsp!.memberID;
      socket.send(
        JSON.stringify({
          cmd: CombCmd.JOIN,
          routeKey: unitId,
          routeType: '',
          joinReq: { rooms: [{ roomID: unitId }] },
        }),
      );
      await until(
        () => messages.find((message) => message.cmd === CombCmd.JOIN)?.code === CmdRspCode.OK,
        'Editor did not join the document.',
      );
      return { socket, messages, memberID, credential };
    };
    const first = await connect(ownerHeaders),
      second = await connect(editorHeaders);
    const submit = (
      client: typeof first,
      user: string,
      baseRev: number,
      row: number,
      value: string,
    ) =>
      post(
        `/universer-api/comb/${UniverType.UNIVER_SHEET}/unit/${unitId}/new_changes`,
        {
          unitID: unitId,
          type: UniverType.UNIVER_SHEET,
          memberID: client.memberID,
          changeset: {
            unitID: unitId,
            type: UniverType.UNIVER_SHEET,
            userID: user,
            memberID: client.memberID,
            sid: `pdf-overlap-${user}`,
            reqId: 1,
            baseRev,
            revision: 0,
            mutations: [
              {
                id: SetRangeValuesMutation.id,
                data: JSON.stringify({
                  unitId,
                  subUnitId: 'first',
                  cellValue: { [row]: { 0: { v: value } } },
                }),
              },
            ],
          },
        },
        client.credential,
      );
    const read = async () => {
      const response = await fetch(`${root}/api/items/${item.id}/sheet`, { headers: ownerHeaders });
      assert.equal(response.status, 200);
      return response.json();
    };
    const firstEdit = await submit(first, owner.id, 1, 0, ownerValue);
    assert.equal(firstEdit.status, 200);
    assert.equal((await firstEdit.json()).error.code, ErrorCode.OK);
    await until(
      () => first.messages.some((message) => message.collaMsg?.csAckEvent?.cs?.revision === 2),
      'Owner edit was not acknowledged.',
    );
    await until(
      async () => (await read()).snapshot.sheets.first.cellData[0][0].v === ownerValue,
      'Owner edit was not saved.',
    );

    // Pause only the actual task-owned PDF process after its real fork. This
    // deterministic admission barrier does not replace native rendering or
    // authorization. It proves concurrent service/cancellation, not CPU-load
    // contention with a running renderer; recovery below renders unmodified.
    const admitted = new Promise<void>((accept, reject) => {
      childProcess.fork = (
        modulePath: string | URL,
        args?: readonly string[] | ForkOptions,
        options?: ForkOptions,
      ) => {
        const worker =
          args !== undefined && !Array.isArray(args)
            ? originalFork(modulePath, args as ForkOptions)
            : originalFork(modulePath, args as readonly string[] | undefined, options);
        if (String(modulePath).endsWith('/src/server/pdf/worker.ts')) {
          child = worker;
          childClosed = new Promise((closed) =>
            worker.once('close', (_code, signal) => closed(signal)),
          );
          worker.once('error', reject);
          worker.once('spawn', () => {
            if (worker.kill('SIGSTOP')) accept();
            else reject(new Error('The PDF process could not be paused.'));
          });
        }
        return worker;
      };
      // Public Node API updates already-imported named builtin bindings too.
      syncBuiltinESMExports();
    });
    let finished = false;
    const pending = post(`/api/items/${item.id}/pdf`, {}, ownerHeaders, cancelled.signal).then(
      (response) => {
        finished = true;
        return { response, error: undefined };
      },
      (error: unknown) => {
        finished = true;
        return { response: undefined, error };
      },
    );
    await Promise.race([
      admitted,
      pending.then(async ({ response }) => {
        const status = response?.status ?? 'network error';
        const diagnostic = response && !response.ok ? await response.text() : '';
        throw new Error(`PDF completed before admission was observed (${status}): ${diagnostic}`);
      }),
    ]);
    childProcess.fork = originalFork;
    syncBuiltinESMExports();
    assert.equal(finished, false);
    const blocked = await post(`/api/items/${item.id}/pdf`, {}, editorHeaders);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), {
      error: 'Another file transfer is running. Try again shortly.',
    });

    const sentAt = performance.now();
    const [edited, health] = await Promise.all([
      submit(second, editor.id, 2, 1, editorValue),
      fetch(`${root}/api/health`, { headers: editorHeaders }),
    ]);
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).error.code, ErrorCode.OK);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    await until(
      () => second.messages.some((message) => message.collaMsg?.csAckEvent?.cs?.revision === 3),
      'Overlapping editor edit was not acknowledged.',
    );
    await until(
      () => first.messages.some((message) => message.collaMsg?.newCsEvent?.cs?.revision === 3),
      'Owner did not receive the overlapping peer edit.',
    );
    const peer = first.messages.find(
      (message) => message.collaMsg?.newCsEvent?.cs?.revision === 3,
    )!;
    assert.ok(JSON.stringify(peer).includes(editorValue));
    peerEditAndHealthMs = performance.now() - sentAt;
    // Keep the existing collaboration.spec.ts one-second responsiveness budget.
    assert.ok(peerEditAndHealthMs < 1000, `Peer edit and health took ${peerEditAndHealthMs} ms.`);
    assert.equal(finished, false);
    assert.equal(child!.exitCode, null);
    assert.equal(child!.signalCode, null);
    const confirmed = await read();
    assert.equal(confirmed.revision, 3);
    assert.equal(confirmed.snapshot.sheets.first.cellData[1][0].v, editorValue);

    cancelled.abort();
    const aborted = await pending;
    assert.equal(aborted.response, undefined);
    assert.equal((aborted.error as Error).name, 'AbortError');
    await until(() => child!.signalCode === 'SIGKILL', 'The cancelled PDF child was not killed.');
    assert.equal(await childClosed, 'SIGKILL');
    cancelledChildSignal = child!.signalCode;
    await until(async () => {
      const response = await fetch(`${root}/api/items/${item.id}/pdf`, { headers: ownerHeaders });
      await response.body?.cancel();
      return response.status === 200;
    }, 'PDF admission did not recover.');

    const recovered = await post(`/api/items/${item.id}/pdf`, {});
    assert.equal(recovered.status, 200, recovered.ok ? 'Recovered PDF' : await recovered.text());
    assert.match(recovered.headers.get('content-type') ?? '', /^application\/pdf(?:;|$)/);
    recoveredBytes = new Uint8Array(await recovered.arrayBuffer());
  } finally {
    childProcess.fork = originalFork;
    syncBuiltinESMExports();
    cancelled.abort();
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const socket of sockets) socket.terminate();
    await childClosed;
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
  // Release the app before PDF.js/Canvas evidence collection, which is not part
  // of the production service's memory footprint.
  const { retainPdf } = await import('../../../lib/print/native-test-support.ts');
  const evidenceDirectory = resolve('output/pdf/spn-075-overlap');
  const pages = await retainPdf('overlap-recovery-export', recoveredBytes, evidenceDirectory);
  assert.ok(pages.length > 1);
  const text = pages.map((page) => page.text).join('\n');
  for (const value of [ownerValue, editorValue, 'Confirmed paragraph 090'])
    assert.ok(text.includes(value), `PDF omitted ${value}.`);
  for (const page of pages)
    assert.ok(
      page.pixels.some((value, index) => index % 4 !== 3 && value < 240),
      'A rendered PDF page was blank.',
    );
  assert.ok(!text.includes(ownerName));
  assert.ok(!text.includes(editorName));
  assert.ok(!text.toLowerCase().includes('watermark'));
  const report = { peerEditAndHealthMs, pages: pages.length, cancelledChildSignal };
  await writeFile(join(evidenceDirectory, 'overlap.json'), JSON.stringify(report, null, 2));
  return report;
}

try {
  const report = await main();
  if (process.send)
    await new Promise<void>((accept, reject) =>
      process.send!(report, (error) => (error ? reject(error) : accept())),
    );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  process.disconnect?.();
}
