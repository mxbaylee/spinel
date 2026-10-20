import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { afterEach, expect, test, vi } from 'vitest';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { assistantOAuthRoutes } from '../auth/oauthRoutes.ts';
import { AssistantOAuth, MCP_SCOPES } from '../auth/oauth.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { authRoutes } from '../auth/routes.ts';
import { AccessTokens } from '../auth/tokens.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SheetStore } from '../workspace/sheets.ts';
import { DocumentStore } from '../workspace/documents.ts';
import { CollaborationStore } from '../collaboration/service.ts';
import { attachCollaboration } from '../collaboration/transport.ts';
import { mcpRoutes } from './routes.ts';
import { McpDocuments } from './documents.ts';
import { docFormulas, formulaBody } from '@spinel/doc-formulas';

vi.setConfig({ testTimeout: 30000 });
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'spinel-mcp-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const filename = join(dir, 'app.sqlite'),
    db = openDatabase(filename);
  cleanup.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    tokens = new AccessTokens(auth);
  const owner = auth.createUser('Owner'),
    editor = auth.createUser('Editor'),
    viewer = auth.createUser('Viewer'),
    stranger = auth.createUser('Stranger'),
    admin = auth.createUser('Operator', true);
  const sheet = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null }),
    doc = workspace.create(owner.id, { name: 'Notes', kind: 'doc', parentId: null });
  new SheetStore(workspace).save(owner.id, sheet.id, {
    snapshot: {
      id: sheet.id,
      name: 'Budget',
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      sheetOrder: ['first'],
      styles: { red: { cl: { rgb: '#ff0000' } } },
      sheets: {
        first: {
          id: 'first',
          name: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          cellData: {
            0: { 0: { v: 42, s: 'red' }, 1: { v: 84, f: '=A1*2', si: 'shared' } },
            1: { 1: { v: 0, si: 'shared', s: 'red' } },
          },
        },
      },
    } as IWorkbookData,
    revision: 0,
    writeId: randomUUID(),
  });
  new DocumentStore(workspace).save(owner.id, doc.id, {
    snapshot: {
      ...getDocsEmptySnapshot(doc.id),
      body: { dataStream: 'Hello world\r\n', textRuns: [{ st: 0, ed: 5, ts: { bl: 1 } }] },
    },
    revision: 0,
    writeId: randomUUID(),
  });
  for (const item of [sheet, doc]) {
    workspace.share(owner.id, item.id, editor.id, 'editor');
    workspace.share(owner.id, item.id, viewer.id, 'viewer');
  }
  const issued = tokens.create(owner.id, 'Assistant'),
    identity = tokens.authenticate(issued.token);
  const collab = new CollaborationStore(workspace, filename);
  cleanup.push(() => collab.close());
  const documents = new McpDocuments(workspace, collab);
  const credentials = (id: string) => tokens.authenticate(tokens.create(id, 'Other').token);
  const sheetEdit = async (who = identity) => {
    const read = await documents.readSheet(who, { id: sheet.id });
    return {
      id: sheet.id,
      unitId: read.unitId,
      revision: read.revision,
      requestId: randomUUID(),
      sheetId: 'first',
      cells: [{ row: 0, column: 0, value: 99 }],
    };
  };
  return {
    auth,
    db,
    workspace,
    tokens,
    owner,
    editor,
    viewer,
    stranger,
    admin,
    sheet,
    doc,
    issued,
    identity,
    collab,
    documents,
    credentials,
    sheetEdit,
  };
}

test('tokens store only hashes, isolate owners, bound active keys and stop disabled accounts', async () => {
  const f = await fixture();
  expect(JSON.stringify(f.db.prepare('SELECT * FROM auth_access_tokens').all())).not.toContain(
    f.issued.token,
  );
  expect(f.tokens.list(f.owner.id)).toMatchObject([
    { id: f.issued.id, name: 'Assistant', revoked: false },
  ]);
  expect(f.tokens.list(f.stranger.id)).toEqual([]);
  expect(() => f.tokens.revoke(f.stranger.id, f.issued.id)).toThrow('not found');
  expect(() => f.tokens.create(f.admin.id, 'No')).toThrow('everyday account');
  expect(() => f.tokens.create('guest:any', 'No')).toThrow('everyday account');
  expect(() => f.tokens.adminList(f.owner.id)).toThrow('Not found');
  expect(JSON.stringify(f.tokens.adminList(f.admin.id))).not.toMatch(
    /spinel_|token_hash|Budget|Notes/,
  );
  for (let i = 0; i < 9; i++) f.tokens.create(f.owner.id, `Assistant ${i}`);
  expect(() => f.tokens.create(f.owner.id, 'Eleventh')).toThrow('limit 10');
  f.tokens.revoke(f.owner.id, f.issued.id);
  expect(() => f.tokens.authenticate(f.issued.token)).toThrow('no longer');
  const next = f.tokens.create(f.owner.id, 'Replacement');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  expect(() => f.tokens.authenticate(next.token)).toThrow('no longer');
});

test('list/read are permission-scoped and viewers cannot write', async () => {
  const f = await fixture(),
    viewer = f.credentials(f.viewer.id),
    stranger = f.credentials(f.stranger.id);
  expect(
    f.documents
      .list(viewer, {})
      .documents.map((d) => d.id)
      .sort(),
  ).toEqual([f.sheet.id, f.doc.id].sort());
  expect(f.documents.list(stranger, {}).documents).toEqual([]);
  await expect(f.documents.readSheet(stranger, { id: f.sheet.id })).rejects.toThrow();
  const read = await f.documents.readSheet(viewer, { id: f.sheet.id, rows: 1, columns: 2 });
  expect(read.cells).toMatchObject([{ value: 42 }, { value: 84, formula: '=A1*2' }]);
  await expect(f.documents.edit(viewer, 'sheet', await f.sheetEdit(viewer))).rejects.toThrow();
  f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null);
  await expect(f.documents.readSheet(viewer, { id: f.sheet.id })).rejects.toThrow();
  await expect(
    f.documents.readSheet(f.identity, { id: f.sheet.id, rows: 100, columns: 26 }),
  ).rejects.toThrow('Invalid');
});

test('cell writes commit through the live service, preserve styles and retry exactly once', async () => {
  const f = await fixture(),
    edit = await f.sheetEdit();
  const committed = vi.fn();
  f.collab.service.on('changesetCommitted', committed);
  expect(await f.documents.edit(f.identity, 'sheet', edit)).toMatchObject({
    revision: 2,
    status: 'committed',
  });
  expect(await f.documents.edit(f.identity, 'sheet', edit)).toMatchObject({
    revision: 2,
    status: 'already-committed',
  });
  expect(committed).toHaveBeenCalledTimes(1);
  await expect(
    f.documents.edit(f.identity, 'sheet', { ...edit, cells: [{ row: 0, column: 0, value: 100 }] }),
  ).rejects.toThrow('different edit');
  await expect(
    f.documents.edit(f.identity, 'sheet', { ...edit, requestId: randomUUID() }),
  ).rejects.toThrow('changed');
  const snapshot = (await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData;
  expect(snapshot.sheets.first.cellData?.[0]?.[0]).toMatchObject({ v: 99, s: 'red' });
  expect(snapshot.sheets.first.cellData?.[0]?.[1]?.f).toBe('=A1*2');
});

test('literal replacement detaches a shared-formula follower and preserves its style and source', async () => {
  const f = await fixture();
  await f.documents.edit(f.identity, 'sheet', {
    ...(await f.sheetEdit()),
    cells: [{ row: 1, column: 1, value: 'Literal' }],
  });
  const snapshot = (await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData;
  const follower = snapshot.sheets.first.cellData?.[1]?.[1];
  expect(follower).toMatchObject({ v: 'Literal', s: 'red' });
  for (const key of ['f', 'si', 'ft', 'fd', 'ref', 'xf'] as const)
    expect(follower?.[key] ?? null).toBeNull();
  expect(snapshot.sheets.first.cellData?.[0]?.[1]).toMatchObject({
    f: '=A1*2',
    si: 'shared',
  });
});

test.each(['token', 'account', 'grant'] as const)(
  'production commit rejects %s revocation during asynchronous recipient revalidation',
  async (revoked) => {
    const f = await fixture();
    const identity = f.credentials(f.editor.id),
      edit = await f.sheetEdit(identity);
    f.collab.service.use('commitChangeset', async (_context, next) => {
      // Start the real transport middleware, then revoke while its recipient scan is awaited.
      const pending = next();
      if (revoked === 'token') f.tokens.revoke(f.editor.id, identity.id);
      else if (revoked === 'account')
        f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
      else f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, null);
      await pending;
    });
    const transport = attachCollaboration(
      createServer(),
      f.workspace,
      f.collab,
      'http://localhost',
    );
    cleanup.push(() => transport.close());
    await expect(f.documents.edit(identity, 'sheet', edit)).rejects.toThrow();
    const snapshot = (await f.collab.load(f.owner.id, f.sheet.id)).snapshot as IWorkbookData;
    expect(snapshot.sheets.first.cellData?.[0]?.[0]?.v).toBe(42);
  },
);

test('text mutation preserves surrounding rich text and supports paragraphs, pagination and retries', async () => {
  const f = await fixture();
  const read = await f.documents.readDoc(f.identity, { id: f.doc.id, limit: 5 });
  expect(read).toMatchObject({ text: 'Hello', length: 11, next: 5 });
  const edit = {
    id: f.doc.id,
    unitId: read.unitId,
    revision: read.revision,
    requestId: randomUUID(),
    offset: 6,
    deleteCount: 5,
    text: 'Spinel\nSecond line',
  };
  expect(await f.documents.edit(f.identity, 'doc', edit)).toMatchObject({ revision: 2 });
  expect(await f.documents.edit(f.identity, 'doc', edit)).toMatchObject({
    status: 'already-committed',
    revision: 2,
  });
  const snapshot = (await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData;
  expect(snapshot.body?.dataStream).toBe('Hello Spinel\rSecond line\r\n');
  expect(snapshot.body?.textRuns?.[0]).toMatchObject({ st: 0, ed: 5, ts: { bl: 1 } });
  await expect(
    f.documents.edit(f.identity, 'doc', {
      ...edit,
      revision: 2,
      requestId: randomUUID(),
      offset: 0,
      deleteCount: 100,
      text: '',
    }),
  ).rejects.toThrow('Invalid');
});

test('MCP text edits preserve formula atomicity and remove its annotation on whole replacement', async () => {
  const f = await fixture();
  const expression = '={1,2;3,4}';
  const body = formulaBody('formula', { version: 1, expression, references: [] });
  body.dataStream = `Lead ${expression} tail\r\n`;
  body.customRanges = body.customRanges!.map((range) => ({
    ...range,
    startIndex: range.startIndex + 5,
    endIndex: range.endIndex + 5,
  }));
  new DocumentStore(f.workspace).save(f.owner.id, f.doc.id, {
    snapshot: { ...getDocsEmptySnapshot(f.doc.id), body },
    revision: 1,
    writeId: randomUUID(),
  });
  const read = await f.documents.readDoc(f.identity, { id: f.doc.id });
  expect(read.text).toBe(`Lead ${expression} tail`);
  const edit = {
    id: f.doc.id,
    unitId: read.unitId,
    revision: read.revision,
    requestId: randomUUID(),
    offset: 6,
    deleteCount: 1,
    text: 'X',
  };
  await expect(f.documents.edit(f.identity, 'doc', edit)).rejects.toThrow('entire formula');
  await expect(
    f.documents.edit(f.identity, 'doc', {
      ...edit,
      offset: 7,
      deleteCount: 0,
    }),
  ).rejects.toThrow('entire formula');
  await f.documents.edit(f.identity, 'doc', {
    ...edit,
    offset: 5,
    deleteCount: expression.length,
    text: 'Replacement',
  });
  const snapshot = (await f.collab.load(f.owner.id, f.doc.id)).snapshot as IDocumentData;
  expect(snapshot.body?.dataStream).toBe('Lead Replacement tail\r\n');
  expect(docFormulas(snapshot.body)).toEqual([]);
  expect(snapshot.body?.customRanges ?? []).toEqual([]);
});

for (const revoke of ['token', 'account', 'grant'] as const)
  test(`${revoke} revocation during mutation application prevents durable commit`, async () => {
    const f = await fixture(),
      identity = f.credentials(f.editor.id),
      edit = await f.sheetEdit(identity);
    f.collab.service.use('applyChangeset', async (_context, next) => {
      if (revoke === 'token') f.tokens.revoke(f.editor.id, identity.id);
      if (revoke === 'account')
        f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
      if (revoke === 'grant') f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, null);
      await next();
    });
    await expect(f.documents.edit(identity, 'sheet', edit)).rejects.toThrow();
    const current = await f.collab.load(f.owner.id, f.sheet.id);
    expect(current.revision).toBe(1);
    expect((current.snapshot as IWorkbookData).sheets.first.cellData?.[0]?.[0]?.v).toBe(42);
  });

test('access loss while an asynchronous read is materialized fails closed', async () => {
  const f = await fixture(),
    original = f.collab.load.bind(f.collab);
  vi.spyOn(f.collab, 'load').mockImplementation(async (...args) => {
    const value = await original(...args);
    f.tokens.revoke(f.owner.id, f.issued.id);
    return value;
  });
  await expect(f.documents.readDoc(f.identity, { id: f.doc.id })).rejects.toThrow('no longer');
});

test('restore fences reject stale-generation writes without changing the restored document', async () => {
  const f = await fixture(),
    edit = await f.sheetEdit();
  const job = f.collab.generations.begin(
    f.owner.id,
    f.sheet.id,
    edit.unitId,
    randomUUID(),
    'checkpoint',
  );
  await expect(f.documents.edit(f.identity, 'sheet', edit)).rejects.toThrow('changed');
  f.db.prepare("UPDATE spinel_restore_jobs SET status='cancelled' WHERE id=?").run(job.id);
  f.db.prepare('INSERT INTO spinel_live_units VALUES(?,?,?)').run(f.sheet.id, randomUUID(), 10);
  await expect(f.documents.edit(f.identity, 'sheet', edit)).rejects.toThrow('changed');
});

test('competing edits are rejected at commit rather than silently transformed over a stale base', async () => {
  const f = await fixture(),
    edit = await f.sheetEdit();
  const original = f.collab.service.submitChangeset.bind(f.collab.service);
  let intercepted = false;
  vi.spyOn(f.collab.service, 'submitChangeset').mockImplementation(async (input, context) => {
    if (!intercepted) {
      intercepted = true;
      const competing = await original(
        {
          changeset: {
            ...input.changeset,
            sid: 'other-client',
            mutations: input.changeset.mutations.map((m) => {
              const data = JSON.parse(m.data);
              data.cellValue[0][0].v = 44;
              return { ...m, data: JSON.stringify(data) };
            }),
          },
        },
        context,
      );
      expect(competing.status).toBe('committed');
    }
    return original(input, context);
  });
  await expect(f.documents.edit(f.identity, 'sheet', edit)).rejects.toThrow('changed');
  expect((await f.collab.load(f.owner.id, f.sheet.id)).revision).toBe(2);
});

test('official HTTP MCP client reads and edits both types; token UI APIs enforce session and origin', async () => {
  const f = await fixture();
  const app = express(),
    origin = 'https://spinel.test';
  app.use('/api/auth', authRoutes(f.auth, origin));
  app.use('/mcp', mcpRoutes(f.workspace, f.collab, origin));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const transport = attachCollaboration(server, f.workspace, f.collab, origin);
  cleanup.push(() => transport.close());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  const base = `http://127.0.0.1:${address.port}`;
  const session = f.auth.createSession(f.owner.id),
    cookie = `${COOKIE_NAME}=${session.token}`;
  expect((await fetch(`${base}/api/auth/tokens`)).status).toBe(401);
  expect(
    (
      await fetch(`${base}/api/auth/tokens`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Denied' }),
      })
    ).status,
  ).toBe(403);
  const created = await fetch(`${base}/api/auth/tokens`, {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Client' }),
  });
  expect(created.status).toBe(201);
  const token = await created.json();
  const list = await (await fetch(`${base}/api/auth/tokens`, { headers: { cookie } })).text();
  expect(list).not.toContain(token.token);
  expect((await fetch(`${base}/mcp`, { headers: { cookie } })).status).toBe(401);
  expect(
    (
      await fetch(`${base}/mcp`, {
        headers: { authorization: `Bearer ${token.token}`, origin: 'https://attacker.test' },
      })
    ).status,
  ).toBe(403);
  expect(
    (await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${token.token}` } })).status,
  ).toBe(405);
  const client = new Client({ name: 'integration', version: '1.0.0' });
  cleanup.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token.token}` } },
    }),
  );
  expect((await client.listTools()).tools).toHaveLength(5);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const content = result.content as { type: string; text: string }[];
    return JSON.parse(content[0].text);
  };
  expect((await call('list_documents', {})).documents).toHaveLength(2);
  const read = await call('read_sheet', { id: f.sheet.id });
  expect(
    await call('edit_sheet', {
      id: f.sheet.id,
      unitId: read.unitId,
      revision: read.revision,
      requestId: randomUUID(),
      sheetId: 'first',
      cells: [{ row: 0, column: 0, value: 70 }],
    }),
  ).toMatchObject({ revision: 2 });
  const doc = await call('read_doc', { id: f.doc.id });
  expect(
    await call('edit_doc', {
      id: f.doc.id,
      unitId: doc.unitId,
      revision: doc.revision,
      requestId: randomUUID(),
      offset: 6,
      deleteCount: 5,
      text: 'MCP',
    }),
  ).toMatchObject({ revision: 2 });
  expect((await call('read_doc', { id: f.doc.id })).text).toBe('Hello MCP');
  expect(
    (
      await fetch(`${base}/api/auth/tokens/${token.id}/revoke`, {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(204);
  await expect(client.listTools()).rejects.toThrow();
});

test('SDK OAuth discovery, browser consent, PKCE, refresh and disconnect reach the production commit boundary', async () => {
  const f = await fixture(),
    app = express(),
    server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  const origin = `http://localhost:${address.port}`,
    oauth = new AssistantOAuth(f.auth, origin);
  app.use(assistantOAuthRoutes(oauth));
  app.use('/api/auth', authRoutes(f.auth, origin));
  app.use('/mcp', mcpRoutes(f.workspace, f.collab, origin));
  let disconnectDuringCommit = false,
    revoked = false;
  f.collab.service.use('commitChangeset', async (_context, next) => {
    const pending = next();
    if (disconnectDuringCommit) {
      revoked = true;
      oauth.disconnect(f.owner.id, String(oauth.list(f.owner.id)[0].id));
    }
    await pending;
  });
  const live = attachCollaboration(server, f.workspace, f.collab, origin);
  cleanup.push(() => live.close());
  const metadata = await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json();
  expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none']);
  expect(metadata.revocation_endpoint_auth_methods_supported).toEqual(['none']);
  expect(metadata.authorization_response_iss_parameter_supported).toBeUndefined();
  let registration: OAuthClientInformationMixed | undefined, tokens: OAuthTokens | undefined;
  let authorization: URL | undefined,
    verifier = '';
  const provider: OAuthClientProvider = {
    redirectUrl: 'https://assistant.example/callback',
    clientMetadata: {
      client_name: 'Test assistant',
      redirect_uris: ['https://assistant.example/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    state: () => 'unguessable-client-state',
    clientInformation: () => registration,
    saveClientInformation: (value) => {
      registration = value;
    },
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value;
    },
    redirectToAuthorization: (url) => {
      authorization = url;
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
  };
  const client = new Client({ name: 'oauth-integration', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(oauth.resource), {
    authProvider: provider,
  });
  cleanup.push(() => client.close());
  await expect(client.connect(transport)).rejects.toThrow();
  expect(authorization?.pathname).toBe('/authorize');
  expect(authorization?.searchParams.get('resource')).toBe(oauth.resource);
  const start = await fetch(authorization!, { redirect: 'manual' });
  expect(start.status).toBe(302);
  expect(start.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  expect(start.headers.get('x-frame-options')).toBe('DENY');
  const pending = new URL(start.headers.get('location')!, origin).searchParams.get('request')!;
  const session = f.auth.createSession(f.owner.id),
    cookie = `${COOKIE_NAME}=${session.token}`;
  const consentUrl = `${origin}/api/auth/oauth/pending/${pending}`;
  expect((await fetch(consentUrl)).status).toBe(401);
  const details = await (await fetch(consentUrl, { headers: { cookie } })).json();
  expect(details).toMatchObject({
    name: 'Test assistant',
    redirectOrigin: 'https://assistant.example',
    scopes: MCP_SCOPES,
  });
  expect(
    (
      await fetch(consentUrl, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ allow: true }),
      })
    ).status,
  ).toBe(403);
  const consent = await fetch(consentUrl, {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ allow: true }),
  });
  expect(consent.status).toBe(200);
  const callback = new URL((await consent.json()).redirect),
    code = callback.searchParams.get('code')!;
  expect(callback.origin).toBe('https://assistant.example');
  expect(callback.searchParams.get('state')).toBe('unguessable-client-state');
  const exchange = (values: Record<string, string>) =>
    fetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    });
  const codeArgs = {
    grant_type: 'authorization_code',
    client_id: registration!.client_id,
    code,
    redirect_uri: String(provider.redirectUrl),
    resource: oauth.resource,
  };
  expect((await exchange({ ...codeArgs, code_verifier: 'wrong-verifier' })).status).toBe(400);
  await transport.finishAuth(code);
  expect(tokens?.access_token).toMatch(/^spinel_oauth_/);
  expect((await exchange({ ...codeArgs, code_verifier: verifier })).status).toBe(400);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(oauth.resource), { authProvider: provider }),
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  const read = await call('read_sheet', { id: f.sheet.id });
  const edit = {
    id: f.sheet.id,
    unitId: read.unitId,
    revision: read.revision,
    requestId: randomUUID(),
    sheetId: 'first',
    cells: [{ row: 0, column: 0, value: 73 }],
  };
  expect(await call('edit_sheet', edit)).toMatchObject({ revision: 2 });
  const connection = oauth.list(f.owner.id)[0];
  expect(connection.lastUsedAt).not.toBeNull();
  const oldAccess = tokens!.access_token;
  const refreshed = await exchange({
    grant_type: 'refresh_token',
    client_id: registration!.client_id,
    refresh_token: tokens!.refresh_token!,
    resource: oauth.resource,
  });
  expect(refreshed.status).toBe(200);
  tokens = await refreshed.json();
  expect(tokens!.access_token).not.toBe(oldAccess);
  // Retrying a lost edit response after refresh must preserve the connection's durable identity.
  expect(await call('edit_sheet', edit)).toMatchObject({ revision: 2 });
  expect((await f.collab.load(f.owner.id, f.sheet.id)).revision).toBe(2);
  const doc = await call('read_doc', { id: f.doc.id });
  expect(
    await call('edit_doc', {
      id: f.doc.id,
      unitId: doc.unitId,
      revision: doc.revision,
      requestId: randomUUID(),
      offset: 6,
      deleteCount: 5,
      text: 'OAuth',
    }),
  ).toMatchObject({ revision: 2 });
  // The transport's final async recipient scan must still see a connection revoked after admission.
  const nextEdit = await f.sheetEdit(oauth.authenticate(tokens!.access_token));
  disconnectDuringCommit = true;
  const rejected = await client.callTool({ name: 'edit_sheet', arguments: nextEdit });
  expect(rejected.isError).toBe(true);
  expect(revoked).toBe(true);
  expect((await f.collab.load(f.owner.id, f.sheet.id)).revision).toBe(2);
  expect(
    (await fetch(oauth.resource, { headers: { authorization: `Bearer ${tokens!.access_token}` } }))
      .status,
  ).toBe(401);
});
