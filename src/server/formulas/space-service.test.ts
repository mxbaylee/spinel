import { afterEach, expect, test, vi } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { parseFormula } from '@spinel/doc-formulas';
import type { FormulaDefinition, FormulaResult, FormulaSource } from '@spinel/doc-formulas';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, hashToken } from '../auth/store.ts';
import { AccessTokens } from '../auth/tokens.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { SpaceRecoveryStore } from '../workspace/space-recovery.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DocFormulas } from './service.ts';

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((finish) => finish()),
);

function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const reader = auth.createUser('Reader');
  const external = auth.createUser('External owner');
  const spaces = new SpaceStore(workspace);
  const root = spaces.createRoot(owner.id, { name: 'Project', parentId: null }).space;
  const host = spaces.createChild(owner.id, root.id, {
    kind: 'doc',
    name: 'Report',
    parentId: root.id,
  }).item;
  const folder = spaces.createChild(owner.id, root.id, {
    kind: 'folder',
    name: 'Inputs',
    parentId: root.id,
  }).item;
  const source = spaces.createChild(owner.id, root.id, {
    kind: 'sheet',
    name: 'Budget',
    parentId: folder.id,
  }).item;
  const second = spaces.createChild(owner.id, root.id, {
    kind: 'sheet',
    name: 'Forecast',
    parentId: root.id,
  }).item;
  const remote = spaces.createRoot(external.id, { name: 'Private project', parentId: null }).space;
  const remoteSource = spaces.createChild(external.id, remote.id, {
    kind: 'sheet',
    name: 'Remote budget',
    parentId: remote.id,
  }).item;
  const ordinary = workspace.create(external.id, {
    kind: 'sheet',
    name: 'External budget',
    parentId: null,
  });
  const ordinaryHost = workspace.create(owner.id, {
    kind: 'doc',
    name: 'Ordinary report',
    parentId: null,
  });
  spaces.share(owner.id, root.id, reader.id, 'editor');
  const snapshots = new Map<string, IWorkbookData>();
  const generations = new Map<string, string>();
  const addSnapshot = (item: { id: string; name: string }) => {
    snapshots.set(item.id, {
      id: item.id,
      name: item.name,
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      styles: {},
      sheetOrder: ['summary'],
      sheets: {
        summary: { id: 'summary', name: 'Summary', cellData: { 0: { 0: { v: 42 } } } },
      },
    });
    generations.set(item.id, `unit-${item.id}`);
  };
  for (const item of [source, second, remoteSource, ordinary]) addSnapshot(item);
  const prepare = vi.fn(async (_user: string, _id: string, _custom: Record<string, unknown>) => {});
  const load = vi.fn(async (_user: string, id: string, _custom: Record<string, unknown>) => ({
    snapshot: snapshots.get(id)!,
    revision: 1,
    access: 'viewer',
  }));
  const calculate = vi.fn(
    async (_definition: FormulaDefinition, _sources: FormulaSource[]): Promise<FormulaResult> => ({
      ok: true,
      kind: 'scalar',
      value: 42,
    }),
  );
  const collaboration = {
    prepare,
    load,
    generations: {
      active: (id: string) => ({ unitId: generations.get(id)! }),
      restoring: () => false,
    },
  } as unknown as CollaborationStore;
  const formulas = new DocFormulas(workspace, collaboration, calculate);
  const account = (userId: string, scoped = true) => ({
    sessionHash: auth.createSession(userId).session.token_hash,
    ...(scoped ? { spaceId: root.id, spaceItem: host.id } : {}),
  });
  const ownerContext = account(owner.id);
  const readerContext = account(reader.id);
  const guest = (role: 'viewer' | 'editor' = 'editor') => {
    const change = workspace.links.begin(root.id, role);
    workspace.links.finish(root.id, change.epoch, true);
    const session = workspace.links.exchange(root.id, change.token);
    return {
      ...session,
      context: {
        guestHash: hashToken(session.token),
        guestItem: root.id,
        spaceId: root.id,
        spaceItem: host.id,
      },
    };
  };
  const verify = vi.fn(() => {});
  const definition = (expression: string, ids: string[]): FormulaDefinition => ({
    version: 1,
    expression,
    references: parseFormula(expression).map((reference, index) => ({
      start: reference.start,
      end: reference.end,
      range: reference.range,
      itemId: ids[index],
      sheetId: 'summary',
    })),
  });
  const resolve = (expression = '=Budget.Summary.A1') =>
    formulas.resolve(owner.id, host.id, { expression }, verify, false, ownerContext);
  return {
    db,
    auth,
    workspace,
    spaces,
    owner,
    reader,
    external,
    root,
    host,
    folder,
    source,
    second,
    remote,
    remoteSource,
    ordinary,
    ordinaryHost,
    snapshots,
    generations,
    addSnapshot,
    prepare,
    load,
    calculate,
    formulas,
    account,
    guest,
    ownerContext,
    readerContext,
    verify,
    definition,
    resolve,
  };
}

test('Space account View and Edit keep scalar, range, multisource and stable Formula bindings', async () => {
  const f = fixture();
  const expression = '=SUM(Budget.Summary.A1:C3,Forecast.Summary.A1)';
  const definition = await f.formulas.resolve(
    f.reader.id,
    f.host.id,
    { expression, format: 'currency' },
    f.verify,
    false,
    f.readerContext,
  );
  expect(definition).toMatchObject({
    expression,
    format: 'currency',
    references: [
      { itemId: f.source.id, sheetId: 'summary', range: 'A1:C3' },
      { itemId: f.second.id, sheetId: 'summary', range: 'A1' },
    ],
  });
  f.calculate.mockImplementationOnce(async () => {
    f.spaces.share(f.owner.id, f.root.id, f.reader.id, 'viewer');
    return { ok: true, kind: 'scalar', value: 42 };
  });
  expect(
    await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify, false, f.readerContext),
  ).toEqual({ ok: true, kind: 'scalar', value: 42 });
  f.db.prepare('UPDATE workspace_items SET name=? WHERE id=?').run('Renamed budget', f.source.id);
  f.snapshots.get(f.source.id)!.sheets.summary.name = 'Renamed summary';
  f.spaces.createChild(f.owner.id, f.root.id, {
    kind: 'sheet',
    name: 'Budget',
    parentId: f.root.id,
  });
  const revised = await f.formulas.resolve(
    f.reader.id,
    f.host.id,
    { expression: '=SUM(Budget.Summary.A2:C3,Forecast.Summary.A1)', previous: definition },
    f.verify,
    false,
    f.readerContext,
  );
  expect(revised.references[0]).toMatchObject({
    itemId: f.source.id,
    sheetId: 'summary',
    range: 'A2:C3',
  });
  expect(f.prepare).toHaveBeenCalledWith(f.reader.id, f.source.id, {
    ...f.readerContext,
    spaceItem: f.source.id,
  });
  expect(f.load).toHaveBeenCalledWith(f.reader.id, f.source.id, {
    ...f.readerContext,
    spaceItem: f.source.id,
  });
  expect(JSON.stringify(definition)).not.toContain('"value"');
});

test.each(['viewer', 'editor'] as const)(
  'a Space %s guest discovers and evaluates only current and future same-Space sources',
  async (role) => {
    const f = fixture();
    const guest = f.guest(role);
    const sources = f.formulas.sources(guest.userId, f.host.id, f.verify, guest.context);
    expect(sources).toEqual(
      expect.arrayContaining([
        { itemId: f.source.id, name: 'Budget' },
        { itemId: f.second.id, name: 'Forecast' },
      ]),
    );
    expect(sources).toHaveLength(2);
    const next = f.spaces.createChild(f.owner.id, f.root.id, {
      kind: 'sheet',
      name: 'Next year',
      parentId: f.folder.id,
    }).item;
    f.addSnapshot(next);
    const expression = "=SUM(Budget.Summary.A1:C3,'Next year'.Summary.A1)";
    const definition = await f.formulas.resolve(
      guest.userId,
      f.host.id,
      { expression, format: 'number' },
      f.verify,
      true,
      guest.context,
    );
    expect(definition.references.map((reference) => reference.itemId)).toEqual([
      f.source.id,
      next.id,
    ]);
    expect(
      await f.formulas.evaluate(guest.userId, f.host.id, definition, f.verify, true, guest.context),
    ).toMatchObject({ ok: true, value: 42 });
    expect(
      await f.formulas.sheets(guest.userId, f.host.id, next.id, f.verify, guest.context),
    ).toEqual([{ sheetId: 'summary', name: 'Summary' }]);
    expect(f.load).toHaveBeenCalledWith(guest.userId, next.id, {
      ...guest.context,
      spaceItem: next.id,
    });
    expect(JSON.stringify(sources)).not.toContain(f.owner.id);
  },
);

test('a root guest cannot use external bindings or mix account credentials to escape its Space', async () => {
  const f = fixture();
  const guest = f.guest();
  // Even the signed-in owner independently gaining access lends nothing to a guest.
  f.spaces.share(f.external.id, f.remote.id, f.owner.id, 'viewer');
  f.workspace.share(f.external.id, f.ordinary.id, f.owner.id, 'viewer');
  for (const id of [f.remoteSource.id, f.ordinary.id]) {
    const definition = f.definition('=Budget.Summary.A1', [id]);
    expect(
      await f.formulas.evaluate(guest.userId, f.host.id, definition, f.verify, true, guest.context),
    ).toEqual({ ok: false, reason: 'private-source' });
    await expect(
      f.formulas.sheets(guest.userId, f.host.id, id, f.verify, guest.context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.formulas.resolve(
        guest.userId,
        f.host.id,
        { expression: definition.expression, bindings: definition.references },
        f.verify,
        true,
        guest.context,
      ),
    ).rejects.toMatchObject({ status: 404 });
  }
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.load).not.toHaveBeenCalled();
  expect(f.calculate).not.toHaveBeenCalled();
  const literal = { version: 1, expression: '=1', references: [] };
  await expect(
    f.formulas.evaluate(guest.userId, f.host.id, literal, f.verify, true, {
      ...guest.context,
      sessionHash: f.ownerContext.sessionHash,
    }),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    f.formulas.evaluate(guest.userId, f.host.id, literal, f.verify, true, {
      ...guest.context,
      spaceId: f.remote.id,
    }),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    f.formulas.evaluate(guest.userId, f.ordinaryHost.id, literal, f.verify, true, {
      ...guest.context,
      spaceItem: f.ordinaryHost.id,
    }),
  ).rejects.toMatchObject({ status: 404 });
});

test('Formula service boundaries reject incomplete, mixed and mismatched scoped credentials', async () => {
  const f = fixture();
  const guest = f.guest();
  const literal = { version: 1, expression: '=1', references: [] };
  for (const context of [
    { sessionHash: f.ownerContext.sessionHash, spaceId: f.root.id },
    { sessionHash: f.ownerContext.sessionHash, spaceItem: f.host.id },
    { sessionHash: undefined, spaceId: f.root.id, spaceItem: f.host.id },
    { spaceId: f.root.id, spaceItem: f.host.id },
    { ...f.ownerContext, mcpTokenHash: 'injected' },
    { ...f.ownerContext, guestItem: f.root.id },
    { mcpConnectionId: 'partial', spaceId: f.root.id, spaceItem: f.host.id },
  ]) {
    await expect(
      f.formulas.evaluate(f.owner.id, f.host.id, literal, f.verify, false, context),
    ).rejects.toMatchObject({ status: 401 });
    expect(() => f.formulas.sources(f.owner.id, f.host.id, f.verify, context)).toThrow(
      'credential',
    );
  }
  await expect(
    f.formulas.evaluate(guest.userId, f.host.id, literal, f.verify, true, {
      ...guest.context,
      guestHash: undefined,
    }),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    f.formulas.evaluate(f.owner.id, f.host.id, literal, f.verify, false, {
      ...f.ownerContext,
      spaceItem: f.source.id,
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.calculate).not.toHaveBeenCalled();
});

test.each(
  (['prepare', 'load', 'calculate'] as const).flatMap((boundary) =>
    (['rotate', 'revoke', 'downgrade'] as const).map((change) => ({ boundary, change })),
  ),
)(
  'Space guest $change during $boundary invalidates the original Formula request',
  async ({ boundary, change }) => {
    const f = fixture();
    const guest = f.guest('editor');
    const definition = f.definition('=Budget.Summary.A1', [f.source.id]);
    let replacement: ReturnType<typeof f.workspace.links.begin> | undefined;
    const mutate = () => {
      replacement = f.workspace.links.begin(
        f.root.id,
        change === 'revoke' ? null : change === 'downgrade' ? 'viewer' : 'editor',
      );
      f.workspace.links.finish(f.root.id, replacement.epoch, change !== 'revoke');
    };
    if (boundary === 'prepare') f.prepare.mockImplementationOnce(async () => mutate());
    else if (boundary === 'load')
      f.load.mockImplementationOnce(async (_user, id) => {
        mutate();
        return { snapshot: f.snapshots.get(id)!, revision: 1, access: 'viewer' };
      });
    else
      f.calculate.mockImplementationOnce(async () => {
        mutate();
        return { ok: true, kind: 'scalar', value: 'OLD LINK RESULT' };
      });
    await expect(
      f.formulas.evaluate(guest.userId, f.host.id, definition, f.verify, true, guest.context),
    ).rejects.toMatchObject({ status: 404 });
    if (boundary !== 'calculate') expect(f.calculate).not.toHaveBeenCalled();
    if (change === 'downgrade') {
      const fresh = f.workspace.links.exchange(f.root.id, replacement!.token);
      expect(
        await f.formulas.evaluate(fresh.userId, f.host.id, definition, f.verify, true, {
          ...guest.context,
          guestHash: hashToken(fresh.token),
        }),
      ).toEqual({ ok: true, kind: 'scalar', value: 42 });
    }
  },
);

test.each(['editor', 'admin'] as const)(
  'Space %s sources outside the host root need independent current account access',
  async (role) => {
    const f = fixture();
    f.spaces.share(f.owner.id, f.root.id, f.reader.id, role);
    const definition = f.definition(
      "=SUM(Budget.Summary.A1,'Remote budget'.Summary.A1,'External budget'.Summary.A1)",
      [f.source.id, f.remoteSource.id, f.ordinary.id],
    );
    expect(f.formulas.sources(f.reader.id, f.host.id, f.verify, f.readerContext)).toEqual(
      expect.arrayContaining([
        { itemId: f.source.id, name: 'Budget' },
        { itemId: f.second.id, name: 'Forecast' },
      ]),
    );
    expect(
      await f.formulas.evaluate(
        f.reader.id,
        f.host.id,
        definition,
        f.verify,
        false,
        f.readerContext,
      ),
    ).toEqual({ ok: false, reason: 'private-source' });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.calculate).not.toHaveBeenCalled();
    f.spaces.share(f.external.id, f.remote.id, f.reader.id, 'viewer');
    f.workspace.share(f.external.id, f.ordinary.id, f.reader.id, 'viewer');
    expect(
      await f.formulas.evaluate(
        f.reader.id,
        f.host.id,
        definition,
        f.verify,
        false,
        f.readerContext,
      ),
    ).toEqual({ ok: true, kind: 'scalar', value: 42 });
    expect(f.load).toHaveBeenCalledWith(f.reader.id, f.remoteSource.id, {
      sessionHash: f.readerContext.sessionHash,
      spaceId: f.remote.id,
      spaceItem: f.remoteSource.id,
    });
    expect(f.load).toHaveBeenCalledWith(f.reader.id, f.ordinary.id, {
      sessionHash: f.readerContext.sessionHash,
    });
    f.calculate.mockImplementationOnce(async () => {
      f.spaces.share(f.external.id, f.remote.id, f.reader.id, null);
      return { ok: true, kind: 'scalar', value: 'PRIVATE RESULT' };
    });
    expect(
      await f.formulas.evaluate(
        f.reader.id,
        f.host.id,
        definition,
        f.verify,
        false,
        f.readerContext,
      ),
    ).toEqual({ ok: false, reason: 'private-source' });
    expect(
      JSON.stringify(f.formulas.sources(f.reader.id, f.host.id, f.verify, f.readerContext)),
    ).not.toContain('Remote budget');
  },
);

test('ordinary hosts can use an independently authorized Space source without opening legacy Space routes', async () => {
  const f = fixture();
  const context = f.account(f.owner.id, false);
  const definition = await f.formulas.resolve(
    f.owner.id,
    f.ordinaryHost.id,
    { expression: '=Budget.Summary.A1' },
    f.verify,
    false,
    context,
  );
  expect(definition.references[0].itemId).toBe(f.source.id);
  expect(f.load).toHaveBeenCalledWith(f.owner.id, f.source.id, {
    ...context,
    spaceId: f.root.id,
    spaceItem: f.source.id,
  });
  await expect(
    f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify, false, context),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    f.formulas.evaluate(f.owner.id, f.ordinaryHost.id, definition, f.verify, false, f.ownerContext),
  ).rejects.toMatchObject({ status: 404 });
});

test('MCP formulas retain token credentials for both same-Space and independent external sources', async () => {
  const f = fixture();
  const tokens = new AccessTokens(f.auth);
  const token = tokens.create(f.reader.id, 'Formula integration');
  const context = {
    mcpTokenHash: hashToken(token.token),
    spaceId: f.root.id,
    spaceItem: f.host.id,
  };
  const definition = f.definition(
    "=SUM(Budget.Summary.A1,'Remote budget'.Summary.A1,'External budget'.Summary.A1)",
    [f.source.id, f.remoteSource.id, f.ordinary.id],
  );
  expect(
    await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify, false, context),
  ).toEqual({ ok: false, reason: 'private-source' });
  expect(f.load).not.toHaveBeenCalled();
  f.spaces.share(f.external.id, f.remote.id, f.reader.id, 'viewer');
  f.workspace.share(f.external.id, f.ordinary.id, f.reader.id, 'viewer');
  expect(
    await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify, false, context),
  ).toMatchObject({ ok: true, value: 42 });
  expect(f.load).toHaveBeenCalledWith(f.reader.id, f.source.id, {
    ...context,
    spaceItem: f.source.id,
  });
  expect(f.load).toHaveBeenCalledWith(f.reader.id, f.remoteSource.id, {
    mcpTokenHash: context.mcpTokenHash,
    spaceId: f.remote.id,
    spaceItem: f.remoteSource.id,
  });
  expect(f.load).toHaveBeenCalledWith(f.reader.id, f.ordinary.id, {
    mcpTokenHash: context.mcpTokenHash,
  });
  f.calculate.mockImplementationOnce(async () => {
    tokens.revoke(f.reader.id, token.id);
    return { ok: true, kind: 'scalar', value: 'REVOKED TOKEN' };
  });
  await expect(
    f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify, false, context),
  ).rejects.toMatchObject({ status: 401 });
});

test.each(['prepare', 'load', 'calculate'] as const)(
  'Space Formula discards results when the account session is revoked during %s',
  async (boundary) => {
    const f = fixture();
    const definition = f.definition('=Budget.Summary.A1', [f.source.id]);
    const revoke = () => f.auth.revokeSession(f.readerContext.sessionHash);
    if (boundary === 'prepare') f.prepare.mockImplementationOnce(async () => revoke());
    else if (boundary === 'load')
      f.load.mockImplementationOnce(async (_user, id) => {
        revoke();
        return { snapshot: f.snapshots.get(id)!, revision: 1, access: 'viewer' };
      });
    else
      f.calculate.mockImplementationOnce(async () => {
        revoke();
        return { ok: true, kind: 'scalar', value: 'OLD SESSION' };
      });
    await expect(
      f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify, false, f.readerContext),
    ).rejects.toMatchObject({ status: 401 });
    if (boundary !== 'calculate') expect(f.calculate).not.toHaveBeenCalled();
  },
);

test.each(['source', 'ancestor', 'root', 'host', 'grant', 'owner'] as const)(
  'Space Formula rechecks %s availability after calculation',
  async (changed) => {
    const f = fixture();
    const definition = f.definition('=Budget.Summary.A1', [f.source.id]);
    f.calculate.mockImplementationOnce(async () => {
      if (changed === 'source' || changed === 'ancestor' || changed === 'host')
        new SpaceRecoveryStore(f.workspace).trash(
          f.owner.id,
          f.root.id,
          changed === 'source' ? f.source.id : changed === 'ancestor' ? f.folder.id : f.host.id,
        );
      else if (changed === 'root')
        f.db
          .prepare('UPDATE workspace_items SET trashed_at=1,trash_batch=? WHERE id=?')
          .run('whole-space', f.root.id);
      else if (changed === 'grant') f.spaces.share(f.owner.id, f.root.id, f.reader.id, null);
      else f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
      return { ok: true, kind: 'scalar', value: 'DISCARDED' };
    });
    const result = f.formulas.evaluate(
      f.reader.id,
      f.host.id,
      definition,
      f.verify,
      false,
      f.readerContext,
    );
    if (changed === 'source' || changed === 'ancestor')
      expect(await result).toEqual({ ok: false, reason: 'private-source' });
    else await expect(result).rejects.toMatchObject({ status: 404 });
  },
);

test('a source restore after materialization or calculation never returns mixed Space generations', async () => {
  const f = fixture();
  const definition = f.definition('=Budget.Summary.A1', [f.source.id]);
  f.load.mockImplementationOnce(async (_user, id) => {
    f.generations.set(id, 'restored-during-load');
    return { snapshot: f.snapshots.get(id)!, revision: 1, access: 'viewer' };
  });
  expect(
    await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify, false, f.readerContext),
  ).toEqual({ ok: false, reason: 'unavailable' });
  expect(f.calculate).not.toHaveBeenCalled();
  f.calculate.mockImplementationOnce(async () => {
    f.generations.set(f.source.id, 'restored-during-calculation');
    return { ok: true, kind: 'scalar', value: 'OLD GENERATION' };
  });
  expect(
    await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify, false, f.readerContext),
  ).toEqual({ ok: false, reason: 'unavailable' });
});

test('stable Space bindings remain usable when an unrelated readable catalog exceeds its work budget', async () => {
  const f = fixture();
  const definition = await f.resolve();
  f.spaces.share(f.external.id, f.remote.id, f.owner.id, 'viewer');
  const insert = f.db.prepare(`INSERT INTO workspace_items
    (id,owner_id,parent_id,kind,name,created_at,updated_at,space_id,space_position)
    VALUES(?,?,?,'doc','Unrelated retained page',1,1,?,?)`);
  f.auth.transaction(() => {
    for (let index = 0; index < 10_000; index++)
      insert.run(`catalog-row-${index}`, f.external.id, f.remote.id, f.remote.id, index);
  });
  expect(() => f.formulas.sources(f.owner.id, f.host.id, f.verify, f.ownerContext)).toThrow(
    'too large',
  );
  const revised = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    { expression: '=Budget.Summary.A2', previous: definition },
    f.verify,
    false,
    f.ownerContext,
  );
  expect(revised.references[0]).toMatchObject({ itemId: f.source.id, range: 'A2' });
  expect(
    await f.formulas.evaluate(f.owner.id, f.host.id, revised, f.verify, false, f.ownerContext),
  ).toEqual({ ok: true, kind: 'scalar', value: 42 });
});

test('Space and ordinary Formula requests share one admission and never queue unauthorized work', async () => {
  const f = fixture();
  let finish!: (result: FormulaResult) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.calculate.mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const definition = f.definition('=Budget.Summary.A1', [f.source.id]);
  const first = f.formulas.evaluate(
    f.reader.id,
    f.host.id,
    definition,
    f.verify,
    false,
    f.readerContext,
  );
  await started;
  try {
    expect(
      await f.formulas.evaluate(
        f.owner.id,
        f.ordinaryHost.id,
        { version: 1, expression: '=1', references: [] },
        f.verify,
        false,
        f.account(f.owner.id, false),
      ),
    ).toEqual({ ok: false, reason: 'busy' });
  } finally {
    finish({ ok: true, kind: 'scalar', value: 42 });
    await first;
  }
});
