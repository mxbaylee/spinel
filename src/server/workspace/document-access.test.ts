import type { Response } from 'express';
import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { AssistantOAuth } from '../auth/oauth.ts';
import { AuthError, AuthStore, hashToken, randomToken } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import {
  createHistoryReadContext,
  hasSpaceContext,
  resolveDocument,
  sourceDocumentContext,
  validateDocumentCredentials,
} from './document-access.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { WorkspaceStore } from './store.ts';

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

function fixture() {
  const db = new DatabaseSync(':memory:');
  cleanup.push(() => db.close());
  let now = Date.UTC(2026, 9, 22, 12);
  const auth = new AuthStore(db, () => now);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const stranger = auth.createUser('Other account');
  const admin = auth.createUser('Operator', true);
  const sessions = new Map(
    [owner, editor, viewer, stranger, admin].map((user) => [
      user.id,
      auth.createSession(user.id).session,
    ]),
  );
  const outer = workspace.create(owner.id, {
    name: 'Private folder',
    kind: 'folder',
    parentId: null,
  });
  const ordinary = workspace.create(owner.id, {
    name: 'Ordinary document',
    kind: 'doc',
    parentId: null,
  });
  workspace.share(owner.id, ordinary.id, editor.id, 'editor');
  const spaces = new SpaceStore(workspace);
  const root = spaces.createRoot(owner.id, { name: 'Project', parentId: outer.id }).space;
  const folder = spaces.createChild(owner.id, root.id, {
    name: 'Section',
    kind: 'folder',
    parentId: root.id,
  }).item;
  const child = spaces.createChild(owner.id, root.id, {
    name: 'Notes',
    kind: 'doc',
    parentId: folder.id,
  }).item;
  const sibling = spaces.createChild(owner.id, root.id, {
    name: 'Budget',
    kind: 'sheet',
    parentId: root.id,
  }).item;
  const other = spaces.createRoot(owner.id, { name: 'Another Space', parentId: null }).space;
  const otherChild = spaces.createChild(owner.id, other.id, {
    name: 'Other notes',
    kind: 'doc',
    parentId: other.id,
  }).item;
  spaces.share(owner.id, root.id, editor.id, 'editor');
  spaces.share(owner.id, root.id, viewer.id, 'viewer');
  const tokens = new AccessTokens(auth);
  const oauth = new AssistantOAuth(auth, 'https://spinel.example');
  const scope = { spaceId: root.id, spaceItem: child.id };
  const account = (userId = owner.id) => ({ sessionHash: sessions.get(userId)!.token_hash });
  const scoped = (userId = owner.id) => ({ ...account(userId), ...scope });
  const pat = (userId = owner.id) => {
    const token = tokens.create(userId, 'Credential test');
    return { ...token, custom: { mcpTokenHash: hashToken(token.token), ...scope } };
  };
  const guest = (role: 'viewer' | 'editor' = 'editor', rootId = root.id, childId = child.id) => {
    const link = workspace.links.begin(rootId, role);
    workspace.links.finish(rootId, link.epoch, true);
    const session = workspace.links.exchange(rootId, link.token);
    return {
      ...session,
      custom: {
        guestHash: hashToken(session.token),
        guestItem: rootId,
        spaceId: rootId,
        spaceItem: childId,
      },
    };
  };
  async function connected(userId = owner.id, scopes = ['documents:read', 'documents:write']) {
    const client = oauth.clientsStore.registerClient({
      client_name: 'Credential test assistant',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
    });
    const resource = new URL(oauth.resource);
    let destination = '';
    await oauth.authorize(
      client,
      {
        redirectUri: client.redirect_uris[0],
        codeChallenge: randomToken(),
        scopes,
        resource,
      },
      {
        redirect(_status: number, url: string) {
          destination = url;
        },
      } as unknown as Response,
    );
    const request = new URL(destination, oauth.origin).searchParams.get('request')!;
    const session = sessions.get(userId)!;
    oauth.details(request, session);
    const code = new URL(oauth.consent(request, session, true).redirect).searchParams.get('code')!;
    const issued = await oauth.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      client.redirect_uris[0],
      resource,
    );
    const identity = oauth.authenticate(issued.access_token);
    return {
      client,
      issued,
      identity,
      custom: {
        mcpTokenHash: identity.hash,
        mcpConnectionId: identity.connectionId,
        mcpResource: identity.resource,
        ...scope,
      },
    };
  }
  return {
    db,
    auth,
    workspace,
    owner,
    editor,
    viewer,
    stranger,
    admin,
    sessions,
    outer,
    ordinary,
    spaces,
    root,
    folder,
    child,
    sibling,
    other,
    otherChild,
    tokens,
    oauth,
    scope,
    account,
    scoped,
    pat,
    guest,
    connected,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
const read = (f: Fixture, userId: string, custom: Record<string, unknown>, itemId = f.child.id) =>
  resolveDocument(f.workspace, userId, itemId, 'read', custom);

test('each supported family resolves its own current actor; trusted callers stay ordinary-only', () => {
  const f = fixture();
  const guest = f.guest();
  const pat = f.pat();
  const history = createHistoryReadContext(f.workspace, f.owner.id, f.root.id, f.child.id);
  for (const [family, actor, custom] of [
    ['account', f.owner.id, f.scoped()],
    ['guest', guest.userId, guest.custom],
    ['mcp', f.owner.id, pat.custom],
    ['history', f.owner.id, history],
  ] as const) {
    expect(validateDocumentCredentials(f.workspace, actor, custom)).toBe(family);
    expect(read(f, actor, custom)).toMatchObject({ id: f.child.id, kind: 'doc' });
  }
  expect(validateDocumentCredentials(f.workspace, f.owner.id)).toBe('trusted');
  expect(resolveDocument(f.workspace, f.owner.id, f.ordinary.id).id).toBe(f.ordinary.id);
  expect(() => read(f, f.owner.id, {})).toThrow(AuthError);
  expect(() => read(f, f.owner.id, f.scope)).toThrow(AuthError);
  expect(() => read(f, guest.userId, {})).toThrow(AuthError);
  expect(() => f.workspace.get(f.owner.id, f.child.id)).toThrow(AuthError);
});

test('every mixed credential-family pair fails before ordinary or Space access', () => {
  const f = fixture();
  const guest = f.guest();
  const pat = f.pat();
  const history = createHistoryReadContext(f.workspace, f.owner.id, f.root.id, f.child.id);
  const families = [
    { sessionHash: f.account().sessionHash },
    { guestHash: guest.custom.guestHash, guestItem: f.root.id },
    { mcpTokenHash: pat.custom.mcpTokenHash },
    { historyRead: history.historyRead },
  ];
  for (let first = 0; first < families.length; first++) {
    for (let second = first + 1; second < families.length; second++) {
      const mixed = { ...families[first], ...families[second] };
      for (const actor of [f.owner.id, guest.userId]) {
        expect(() => validateDocumentCredentials(f.workspace, actor, mixed)).toThrow(AuthError);
        expect(() => read(f, actor, mixed, f.ordinary.id)).toThrow(AuthError);
        expect(() => read(f, actor, { ...mixed, ...f.scope })).toThrow(AuthError);
      }
    }
  }
});

test.each([
  'sessionHash',
  'guestHash',
  'guestItem',
  'mcpTokenHash',
  'mcpConnectionId',
  'mcpResource',
  'historyRead',
])('a present-undefined %s cannot disappear into trusted or another credential family', (field) => {
  const f = fixture();
  const guest = f.guest();
  const pat = f.pat();
  for (const [actor, base] of [
    [f.owner.id, {}],
    [f.owner.id, f.scoped()],
    [guest.userId, guest.custom],
    [f.owner.id, pat.custom],
  ] as const) {
    const custom = { ...base, [field]: undefined };
    expect(() => validateDocumentCredentials(f.workspace, actor, custom)).toThrow(AuthError);
    expect(() => read(f, actor, custom, f.ordinary.id)).toThrow(AuthError);
  }
});

const malformedCredentials: [string, (f: Fixture) => Record<string, unknown>][] = [
  ['empty session', () => ({ sessionHash: '' })],
  ['wrong session type', () => ({ sessionHash: 17 })],
  ['guest hash without target', () => ({ guestHash: 'unknown' })],
  ['guest target without hash', (f) => ({ guestItem: f.root.id })],
  ['empty guest hash', (f) => ({ guestHash: '', guestItem: f.root.id })],
  [
    'MCP connection without token',
    () => ({ mcpConnectionId: 'connection', mcpResource: 'https://spinel.example/mcp' }),
  ],
  [
    'MCP connection without resource',
    (f) => ({ ...f.pat().custom, mcpConnectionId: 'connection' }),
  ],
  [
    'MCP resource without connection',
    (f) => ({ ...f.pat().custom, mcpResource: 'https://spinel.example/mcp' }),
  ],
  [
    'empty MCP connection',
    (f) => ({ ...f.pat().custom, mcpConnectionId: '', mcpResource: 'https://spinel.example/mcp' }),
  ],
  [
    'empty MCP resource',
    (f) => ({ ...f.pat().custom, mcpConnectionId: 'connection', mcpResource: '' }),
  ],
  ['fake private history proof', () => ({ historyRead: {} })],
];
test.each(malformedCredentials)('%s is rejected without an ordinary fallback', (_name, build) => {
  const f = fixture();
  const custom = build(f);
  expect(() => validateDocumentCredentials(f.workspace, f.owner.id, custom)).toThrow(AuthError);
  expect(() => read(f, f.owner.id, custom, f.ordinary.id)).toThrow(AuthError);
});

test.each([null, [], false, 17, 'customData'])(
  'non-record credential context %j is rejected',
  (value) => {
    const f = fixture();
    expect(() =>
      validateDocumentCredentials(
        f.workspace,
        f.owner.id,
        value as unknown as Record<string, unknown>,
      ),
    ).toThrow(AuthError);
  },
);

test('partial, empty and present-undefined Space context never becomes ordinary access', () => {
  const f = fixture();
  for (const partial of [
    { spaceId: f.root.id },
    { spaceItem: f.child.id },
    { spaceId: undefined },
    { spaceItem: undefined },
    { spaceId: undefined, spaceItem: undefined },
    { spaceId: '', spaceItem: f.child.id },
    { spaceId: f.root.id, spaceItem: '' },
    { spaceId: null, spaceItem: f.child.id },
    { spaceId: f.root.id, spaceItem: 1 },
  ]) {
    expect(() => hasSpaceContext(partial)).toThrow(AuthError);
    expect(() => read(f, f.owner.id, { ...f.account(), ...partial }, f.ordinary.id)).toThrow(
      AuthError,
    );
  }
  expect(hasSpaceContext(f.account())).toBe(false);
  expect(hasSpaceContext(f.scoped())).toBe(true);
});

test('account credentials bind the actor and exclude challenge sessions, guests and operators', () => {
  const f = fixture();
  expect(() => read(f, f.editor.id, f.scoped())).toThrow(AuthError);
  expect(() => read(f, 'guest:anything', f.scoped())).toThrow(AuthError);
  const challenge = f.auth.createSession(null).session;
  expect(() => read(f, f.owner.id, { ...f.scope, sessionHash: challenge.token_hash })).toThrow(
    AuthError,
  );
  expect(() => read(f, f.admin.id, f.scoped(f.admin.id))).toThrow(AuthError);
});

test.each(['expired', 'revoked'] as const)(
  'an %s account session never falls back to the trusted actor',
  (change) => {
    const f = fixture();
    const context = f.scoped();
    expect(read(f, f.owner.id, context).id).toBe(f.child.id);
    if (change === 'expired') f.advance(f.sessions.get(f.owner.id)!.expires_at - f.auth.now());
    else f.auth.revokeSession(context.sessionHash);
    expect(() => read(f, f.owner.id, context)).toThrow(AuthError);
    expect(() => read(f, f.owner.id, f.account(), f.ordinary.id)).toThrow(AuthError);
  },
);

test('native access requires the exact root, child and route item even for the owner of both Spaces', () => {
  const f = fixture();
  for (const [itemId, context] of [
    [f.sibling.id, f.scoped()],
    [f.child.id, { ...f.scoped(), spaceId: f.other.id }],
    [f.otherChild.id, { ...f.scoped(), spaceItem: f.otherChild.id }],
    [f.ordinary.id, { ...f.scoped(), spaceItem: f.ordinary.id }],
    [f.root.id, { ...f.scoped(), spaceItem: f.root.id }],
    [f.child.id, f.account()],
  ] as const)
    expect(() => read(f, f.owner.id, context, itemId)).toThrow(AuthError);
  const disabled = new WorkspaceStore(f.auth);
  expect(() => resolveDocument(disabled, f.owner.id, f.child.id, 'read', f.scoped())).toThrow(
    AuthError,
  );
});

test('a guest capability binds its session, root and current role without becoming an account', () => {
  const f = fixture();
  const guest = f.guest('viewer');
  expect(read(f, guest.userId, guest.custom).access).toBe('viewer');
  expect(() =>
    resolveDocument(f.workspace, guest.userId, f.child.id, 'edit', guest.custom),
  ).toThrow(AuthError);
  expect(() => read(f, f.owner.id, guest.custom)).toThrow(AuthError);
  expect(() => read(f, 'guest:another-session', guest.custom)).toThrow(AuthError);
  expect(() => read(f, guest.userId, { ...guest.custom, guestHash: 'unknown' })).toThrow(AuthError);
  expect(() => read(f, guest.userId, { ...guest.custom, guestItem: f.other.id })).toThrow(
    AuthError,
  );
  expect(() =>
    read(
      f,
      guest.userId,
      { ...guest.custom, spaceId: f.other.id, spaceItem: f.otherChild.id },
      f.otherChild.id,
    ),
  ).toThrow(AuthError);
  f.db.prepare("UPDATE workspace_links SET role='editor' WHERE item_id=?").run(f.root.id);
  expect(resolveDocument(f.workspace, guest.userId, f.child.id, 'edit', guest.custom).access).toBe(
    'editor',
  );
  f.db.prepare("UPDATE workspace_links SET role='viewer' WHERE item_id=?").run(f.root.id);
  expect(() =>
    resolveDocument(f.workspace, guest.userId, f.child.id, 'edit', guest.custom),
  ).toThrow(AuthError);
});

test.each(['expiry', 'revocation', 'rotation'] as const)(
  'guest %s invalidates the original context',
  (change) => {
    const f = fixture();
    const guest = f.guest();
    expect(read(f, guest.userId, guest.custom).id).toBe(f.child.id);
    if (change === 'expiry') f.advance(guest.expires - f.auth.now());
    else {
      const next = f.workspace.links.begin(f.root.id, change === 'rotation' ? 'editor' : null);
      f.workspace.links.finish(f.root.id, next.epoch, change === 'rotation');
    }
    expect(() => read(f, guest.userId, guest.custom)).toThrow(AuthError);
  },
);

test('personal access tokens retain their own current actor and revocation state', () => {
  const f = fixture();
  const token = f.pat(f.editor.id);
  expect(resolveDocument(f.workspace, f.editor.id, f.child.id, 'edit', token.custom).access).toBe(
    'editor',
  );
  expect(() => read(f, f.owner.id, token.custom)).toThrow(AuthError);
  expect(() => read(f, 'guest:forged', token.custom)).toThrow(AuthError);
  f.tokens.revoke(f.editor.id, token.id);
  expect(() => read(f, f.editor.id, token.custom)).toThrow(AuthError);
});

test('OAuth credentials bind token, actor, connection, resource and document scope independently', async () => {
  const f = fixture();
  const grant = await f.connected(f.editor.id, ['documents:read']);
  expect(validateDocumentCredentials(f.workspace, f.editor.id, grant.custom)).toBe('mcp');
  expect(read(f, f.editor.id, grant.custom).access).toBe('editor');
  expect(() => resolveDocument(f.workspace, f.editor.id, f.child.id, 'edit', grant.custom)).toThrow(
    AuthError,
  );
  expect(() => read(f, f.owner.id, grant.custom)).toThrow(AuthError);
  for (const alteration of [
    { mcpConnectionId: 'different-connection' },
    { mcpResource: 'https://another.example/mcp' },
    { mcpConnectionId: undefined },
    { mcpResource: undefined },
    { mcpTokenHash: f.pat(f.editor.id).custom.mcpTokenHash },
  ])
    expect(() => read(f, f.editor.id, { ...grant.custom, ...alteration })).toThrow(AuthError);
  expect(() =>
    read(f, f.editor.id, { mcpTokenHash: grant.custom.mcpTokenHash, ...f.scope }),
  ).toThrow(AuthError);
  const writable = await f.connected(f.editor.id);
  expect(
    resolveDocument(f.workspace, f.editor.id, f.child.id, 'edit', writable.custom).access,
  ).toBe('editor');
  f.spaces.share(f.owner.id, f.root.id, f.editor.id, 'viewer');
  expect(() =>
    resolveDocument(f.workspace, f.editor.id, f.child.id, 'edit', writable.custom),
  ).toThrow(AuthError);
});

test.each(['expiry', 'token revocation', 'connection revocation'] as const)(
  'OAuth %s is checked on every resolution',
  async (change) => {
    const f = fixture();
    const grant = await f.connected();
    expect(read(f, f.owner.id, grant.custom).id).toBe(f.child.id);
    if (change === 'expiry') f.advance(grant.issued.expires_in! * 1000);
    else if (change === 'token revocation')
      f.db.prepare('UPDATE oauth_access SET revoked=1 WHERE id=?').run(grant.identity.id);
    else f.oauth.disconnect(f.owner.id, grant.identity.connectionId);
    expect(() => read(f, f.owner.id, grant.custom)).toThrow(AuthError);
  },
);

test('the private history proof survives SDK shallow copies but rejects serialized or widened authority', () => {
  const f = fixture();
  const custom = createHistoryReadContext(f.workspace, f.owner.id, f.root.id, f.child.id);
  const sdkCopy = { ...custom, trace: 'unrelated SDK metadata' };
  expect(read(f, f.owner.id, sdkCopy).id).toBe(f.child.id);
  for (const rejected of [
    JSON.parse(JSON.stringify(custom)) as Record<string, unknown>,
    structuredClone(custom),
    { ...custom, historyRead: {} },
    { ...custom, historyRead: null },
    { ...custom, spaceId: f.other.id },
    { ...custom, spaceItem: f.sibling.id },
    { ...custom, ...f.account() },
  ])
    expect(() => read(f, f.owner.id, rejected)).toThrow(AuthError);
  expect(() => read(f, f.editor.id, custom)).toThrow(AuthError);
  expect(() => read(f, f.owner.id, custom, f.sibling.id)).toThrow(AuthError);
  expect(() => resolveDocument(f.workspace, f.owner.id, f.child.id, 'edit', custom)).toThrow(
    AuthError,
  );
  const anotherWorkspace = new WorkspaceStore(f.auth, { spacesEnabled: true });
  expect(() => resolveDocument(anotherWorkspace, f.owner.id, f.child.id, 'read', custom)).toThrow(
    AuthError,
  );
  expect(() =>
    createHistoryReadContext(new WorkspaceStore(f.auth), f.owner.id, f.root.id, f.child.id),
  ).toThrow(AuthError);
  expect(() => createHistoryReadContext(f.workspace, f.owner.id, f.root.id, f.root.id)).toThrow(
    AuthError,
  );
  expect(() => createHistoryReadContext(f.workspace, f.owner.id, f.root.id, f.folder.id)).toThrow(
    AuthError,
  );
});

test('current root grants override internal grants for account, MCP and history readers', () => {
  const f = fixture();
  const token = f.pat(f.editor.id);
  const history = createHistoryReadContext(f.workspace, f.editor.id, f.root.id, f.child.id);
  const readers = [f.scoped(f.editor.id), token.custom, history];
  f.db
    .prepare("INSERT INTO workspace_grants(item_id,user_id,role) VALUES(?,?,'editor')")
    .run(f.child.id, f.editor.id);
  f.spaces.share(f.owner.id, f.root.id, f.editor.id, 'viewer');
  for (const custom of readers) expect(read(f, f.editor.id, custom).access).toBe('viewer');
  for (const custom of readers.slice(0, 2))
    expect(() => resolveDocument(f.workspace, f.editor.id, f.child.id, 'edit', custom)).toThrow(
      AuthError,
    );
  f.spaces.share(f.owner.id, f.root.id, f.editor.id, null);
  for (const custom of readers) expect(() => read(f, f.editor.id, custom)).toThrow(AuthError);
});

test.each(['disabled', 'operator'] as const)(
  'an actor becoming %s invalidates account, MCP and private-history access',
  (change) => {
    const f = fixture();
    const token = f.pat(f.editor.id);
    const history = createHistoryReadContext(f.workspace, f.editor.id, f.root.id, f.child.id);
    f.db
      .prepare(
        `UPDATE auth_users SET ${change === 'disabled' ? 'disabled' : 'is_admin'}=1 WHERE id=?`,
      )
      .run(f.editor.id);
    for (const custom of [f.scoped(f.editor.id), token.custom, history])
      expect(() => read(f, f.editor.id, custom)).toThrow(AuthError);
  },
);

test('a disabled Space owner denies every family while ordinary active-collaborator policy remains intact', () => {
  const f = fixture();
  const token = f.pat(f.editor.id);
  const history = createHistoryReadContext(f.workspace, f.editor.id, f.root.id, f.child.id);
  const guest = f.guest();
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
  for (const custom of [f.scoped(f.editor.id), token.custom, history])
    expect(() => read(f, f.editor.id, custom)).toThrow(AuthError);
  expect(() => read(f, guest.userId, guest.custom)).toThrow(AuthError);
  expect(
    resolveDocument(f.workspace, f.editor.id, f.ordinary.id, 'edit', f.account(f.editor.id)).access,
  ).toBe('editor');
});

test.each(['outer trash', 'internal trash', 'changed root'] as const)(
  'a private proof is not cached permission after %s',
  (change) => {
    const f = fixture();
    const history = createHistoryReadContext(f.workspace, f.owner.id, f.root.id, f.child.id);
    if (change === 'changed root')
      f.db.prepare('UPDATE workspace_items SET space_id=? WHERE id=?').run(f.other.id, f.child.id);
    else
      f.db
        .prepare('UPDATE workspace_items SET trashed_at=1 WHERE id=?')
        .run(change === 'outer trash' ? f.outer.id : f.folder.id);
    expect(() => read(f, f.owner.id, history)).toThrow(AuthError);
  },
);

test('source scopes retain the original family and independently authorize each current source', () => {
  const f = fixture();
  const host = f.scoped(f.editor.id);
  const sibling = sourceDocumentContext(f.workspace, f.editor.id, f.child.id, f.sibling.id, host);
  expect(sibling).toEqual({ ...host, spaceItem: f.sibling.id });
  const ordinary = sourceDocumentContext(f.workspace, f.editor.id, f.child.id, f.ordinary.id, host);
  expect(ordinary).toEqual(f.account(f.editor.id));
  expect(() =>
    sourceDocumentContext(f.workspace, f.editor.id, f.child.id, f.otherChild.id, host),
  ).toThrow(AuthError);
  const guest = f.guest();
  expect(
    sourceDocumentContext(f.workspace, guest.userId, f.child.id, f.sibling.id, guest.custom),
  ).toEqual({ ...guest.custom, spaceItem: f.sibling.id });
  expect(() =>
    sourceDocumentContext(f.workspace, guest.userId, f.child.id, f.ordinary.id, guest.custom),
  ).toThrow(AuthError);
  expect(() =>
    sourceDocumentContext(f.workspace, guest.userId, f.child.id, f.otherChild.id, guest.custom),
  ).toThrow(AuthError);
  const history = createHistoryReadContext(f.workspace, f.owner.id, f.root.id, f.child.id);
  expect(sourceDocumentContext(f.workspace, f.owner.id, f.child.id, f.child.id, history)).toEqual(
    history,
  );
  expect(() =>
    sourceDocumentContext(f.workspace, f.owner.id, f.child.id, f.sibling.id, history),
  ).toThrow(AuthError);
  expect(() => sourceDocumentContext(f.workspace, f.owner.id, f.ordinary.id, f.child.id)).toThrow(
    AuthError,
  );
});

test('File admin keeps exact account/PAT/OAuth scope and immediately loses downgraded or disabled authority', async () => {
  const f = fixture();
  f.spaces.share(f.owner.id, f.root.id, f.editor.id, 'admin');
  f.workspace.share(f.owner.id, f.ordinary.id, f.editor.id, 'admin');
  const pat = f.pat(f.editor.id);
  const readOnly = await f.connected(f.editor.id, ['documents:read']);
  const readWrite = await f.connected(f.editor.id);
  const contexts = [f.scoped(f.editor.id), pat.custom, readOnly.custom, readWrite.custom];
  for (const custom of contexts) {
    expect(read(f, f.editor.id, custom).access).toBe('admin');
    expect(() =>
      read(
        f,
        f.editor.id,
        { ...custom, spaceId: f.other.id, spaceItem: f.otherChild.id },
        f.otherChild.id,
      ),
    ).toThrow();
  }
  for (const custom of [f.scoped(f.editor.id), pat.custom, readWrite.custom])
    expect(resolveDocument(f.workspace, f.editor.id, f.child.id, 'edit', custom).access).toBe(
      'admin',
    );
  expect(() =>
    resolveDocument(f.workspace, f.editor.id, f.child.id, 'edit', readOnly.custom),
  ).toThrow();
  expect(
    resolveDocument(f.workspace, f.editor.id, f.ordinary.id, 'edit', f.account(f.editor.id)).access,
  ).toBe('admin');
  for (const role of ['editor', 'viewer', null] as const) {
    f.spaces.share(f.owner.id, f.root.id, f.editor.id, role);
    for (const custom of contexts) {
      if (role) expect(read(f, f.editor.id, custom).access).toBe(role);
      else expect(() => read(f, f.editor.id, custom)).toThrow();
      if (role !== 'editor')
        expect(() =>
          resolveDocument(f.workspace, f.editor.id, f.child.id, 'edit', custom),
        ).toThrow();
    }
  }
  f.spaces.share(f.owner.id, f.root.id, f.editor.id, 'admin');
  f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.editor.id);
  for (const custom of contexts) expect(() => read(f, f.editor.id, custom)).toThrow();
});
