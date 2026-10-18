// Disposable SPN-010 harness. Public SDK API only. Never deploy this permissive server.
import express from 'express';
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import { SQLiteDatabaseAdapter } from '@univerjs-pro/collaboration-database-sqlite';
import { UniverCollabService, CollabError } from '@univerjs-pro/collaboration-service';
import { UniverCollabEndpoint } from '@univerjs-pro/collaboration-endpoint';
import { createNodeTransport } from '@univerjs-pro/collaboration-transport-node';
import { UniverType, ErrorCode, type IAllowedRequest } from '@univerjs/protocol';

const record = (event: string, detail: unknown) =>
  appendFileSync(
    'events.jsonl',
    JSON.stringify({ time: new Date().toISOString(), event, detail }) + '\n',
  );
const database = new SQLiteDatabaseAdapter({ filename: 'collaboration.sqlite' });
const service = new UniverCollabService({ dbAdapter: database });
const endpoint = new UniverCollabEndpoint(service);
const transport = createNodeTransport();
transport.use(async (ctx, next) => {
  const id = /(?:^|;\s*)spike-user=(user-\d+)(?:;|$)/.exec(
    ctx.incomingMessage.headers.cookie ?? '',
  )?.[1];
  if (!id) {
    ctx.response.statusCode = 401;
    ctx.response.end('Set a disposable spike-user cookie');
    return;
  }
  ctx.userID = id;
  await next();
});
endpoint.use('connect', async (ctx, next) => {
  ctx.member.name = ctx.session.userID;
  record('connect', { user: ctx.session.userID });
  await next();
});
endpoint.use('joinUnit', async (ctx, next) => {
  record('join', { user: ctx.session.userID, unit: ctx.unitID });
  await next();
});
service.use('submitChangeset', async (ctx, next) => {
  try {
    await next();
    record('submit', { user: ctx.userID, unit: ctx.request.changeset.unitID });
  } catch (error) {
    record('submit-error', { message: String(error) });
    throw error;
  }
});
transport.register(endpoint);
for (let index = 1; index <= 12; index++) {
  for (const kind of ['sheet', 'doc'] as const) {
    const id = `${kind}-${index}`;
    const type = kind === 'sheet' ? UniverType.UNIVER_SHEET : UniverType.UNIVER_DOC;
    try {
      await service.getUnitLoadData({ unitID: id, type, revision: 0 }, { userID: 'user-1' });
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== 'UNIT_NOT_FOUND') throw error;
      if (kind === 'doc')
        await service.createUnitFromData(
          { type: UniverType.UNIVER_DOC, data: { ...getDocsEmptySnapshot(id), rev: 1, title: id } },
          { userID: 'user-1' },
        );
      else
        await service.createUnitFromData(
          {
            type: UniverType.UNIVER_SHEET,
            data: {
              id,
              rev: 1,
              name: id,
              appVersion: '',
              locale: LocaleType.EN_US,
              sheetOrder: ['tab1'],
              sheets: {
                tab1: {
                  id: 'tab1',
                  name: 'Sheet 1',
                  rowCount: 1000,
                  columnCount: 26,
                  cellData: {},
                },
              },
              styles: {},
              resources: [],
            },
          },
          { userID: 'user-1' },
        );
    }
  }
}
const app = express();
app.post('/universer-api/authz/-/object/-/batch_allowed', express.json(), (req, res) => {
  const requests = (req.body.requests ?? []) as IAllowedRequest[];
  res.json({
    error: { code: ErrorCode.OK, message: '' },
    objectActions: requests.map((item) => ({
      unitID: item.unitID,
      objectID: item.objectID,
      actions: item.actions.map((action) => ({ action, allowed: true })),
    })),
  });
});
app.use(express.static('dist'));
const server = createServer(app);
transport.attach(server);
server.listen(3110, '127.0.0.1', () => {
  record('start', { pid: process.pid, license: 'none' });
  console.log('SPN-010 local harness: http://127.0.0.1:3110/?unit=sheet-1');
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await transport.dispose();
    server.close();
    await service.dispose();
    await database.dispose();
    record('stop', {});
  });
