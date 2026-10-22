import { afterEach, expect, test, vi } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { parseFormula, type FormulaResult } from '@spinel/doc-formulas';
import { openDatabase } from '../../../server/database.ts';
import { AuthError, AuthStore } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DocFormulas } from './service.ts';
import { AdminStore } from '../auth/admin.ts';
import { InvitationService } from '../auth/invitations.ts';
import { OwnershipTransfer } from '../auth/ownership.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';

const close: (() => void)[] = [];
afterEach(() => close.splice(0).forEach((finish) => finish()));
function fixture() {
  const db = openDatabase(':memory:');
  close.push(() => db.close());
  const auth = new AuthStore(db);
  const owner = auth.createUser('Owner');
  const reader = auth.createUser('Reader');
  const operator = auth.createUser('Operator', true);
  const workspace = new WorkspaceStore(auth);
  const host = workspace.create(owner.id, { kind: 'doc', name: 'Report', parentId: null });
  const source = workspace.create(owner.id, { kind: 'sheet', name: 'Budget', parentId: null });
  const second = workspace.create(owner.id, { kind: 'sheet', name: 'Forecast', parentId: null });
  workspace.share(owner.id, host.id, reader.id, 'viewer');
  const snapshots = new Map<string, IWorkbookData>(
    [source, second].map((item) => [
      item.id,
      {
        id: item.id,
        name: item.name,
        appVersion: '1.1.0',
        locale: LocaleType.EN_US,
        styles: {},
        sheetOrder: ['summary'],
        sheets: {
          summary: { id: 'summary', name: 'Summary', cellData: { 0: { 0: { v: 42 } } } },
        },
      },
    ]),
  );
  const generations = new Map([
    [source.id, 'first-unit'],
    [second.id, 'second-unit'],
  ]);
  const load = vi.fn(async (_user: string, id: string) => ({
    snapshot: snapshots.get(id)!,
    revision: 1,
    access: 'owner',
  }));
  const collaboration = {
    prepare: vi.fn(async () => {}),
    load,
    generations: {
      active: (id: string) => ({ unitId: generations.get(id)! }),
      restoring: () => false,
    },
  } as unknown as CollaborationStore;
  const calculate = vi.fn(async (): Promise<FormulaResult> => ({
    ok: true,
    kind: 'scalar',
    value: 42,
  }));
  const formulas = new DocFormulas(workspace, collaboration, calculate);
  const verify = vi.fn(() => {});
  const resolve = (expression = '=Budget.Summary.A1') =>
    formulas.resolve(owner.id, host.id, { expression }, verify);
  return {
    db,
    auth,
    owner,
    reader,
    operator,
    workspace,
    host,
    source,
    second,
    snapshots,
    generations,
    load,
    calculate,
    formulas,
    verify,
    resolve,
  };
}

test('transferred Docs preserve stable bindings but grant no implicit external source access', async () => {
  const f = fixture();
  migrateSpaceSchema(f.db);
  const externalOwner = f.auth.createUser('External source owner');
  f.db
    .prepare('UPDATE workspace_items SET owner_id=? WHERE id=?')
    .run(externalOwner.id, f.source.id);
  f.workspace.share(externalOwner.id, f.source.id, f.owner.id, 'viewer');
  const definition = await f.resolve();
  expect(await f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify)).toMatchObject({
    ok: true,
  });
  const admin = new AdminStore(f.auth, new InvitationService(f.auth, 'http://localhost:3000'));
  const handover = new OwnershipTransfer(f.auth);
  admin.disable(f.operator.id, f.owner.id);
  const preview = handover.preview(f.operator.id, f.owner.id);
  handover.transfer(f.operator.id, f.owner.id, f.reader.id, preview.confirmation);
  expect(f.workspace.get(f.reader.id, f.host.id).access).toBe('owner');
  const before = JSON.stringify(definition);
  f.calculate.mockClear();
  expect(await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify)).toEqual({
    ok: false,
    reason: 'private-source',
  });
  expect(f.calculate).not.toHaveBeenCalled();
  expect(JSON.stringify(definition)).toBe(before);
  f.workspace.share(externalOwner.id, f.source.id, f.reader.id, 'viewer');
  expect(await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify)).toMatchObject({
    ok: true,
    value: 42,
  });
});

test('ownership handover during awaited Formula calculation refuses the recovered previous owner', async () => {
  const f = fixture();
  migrateSpaceSchema(f.db);
  const definition = await f.resolve();
  const admin = new AdminStore(f.auth, new InvitationService(f.auth, 'http://localhost:3000'));
  const handover = new OwnershipTransfer(f.auth);
  f.calculate.mockImplementationOnce(async () => {
    admin.disable(f.operator.id, f.owner.id);
    const preview = handover.preview(f.operator.id, f.owner.id);
    handover.transfer(f.operator.id, f.owner.id, f.reader.id, preview.confirmation);
    admin.reactivate(f.operator.id, f.owner.id);
    return { ok: true, kind: 'scalar', value: 42 };
  });
  await expect(f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify)).rejects.toThrow(
    'not available',
  );
  expect(f.auth.user(f.owner.id)?.disabled).toBe(0);
  expect(await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify)).toMatchObject({
    ok: true,
    value: 42,
  });
});

test('resolution uses readable names but saved bindings survive renames and follow current generations', async () => {
  const f = fixture();
  const definition = await f.resolve('=SUM(Budget.Summary.A1,Forecast.Summary.A1)');
  expect(definition.references.map((reference) => reference.itemId)).toEqual([
    f.source.id,
    f.second.id,
  ]);
  f.workspace.update(f.owner.id, f.source.id, { name: 'Renamed budget' });
  f.snapshots.get(f.source.id)!.sheets.summary.name = 'Renamed summary';
  f.generations.set(f.source.id, 'restored-unit');
  const changed = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    { expression: '=1+SUM(Budget.Summary.A1,Forecast.Summary.A1)', previous: definition },
    f.verify,
  );
  expect(changed.references[0]).toMatchObject({
    itemId: f.source.id,
    sheetId: 'summary',
    start: 7,
  });
  expect(await f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify)).toEqual({
    ok: true,
    kind: 'scalar',
    value: 42,
  });
  expect(f.calculate.mock.calls).toHaveLength(1);
  // Definitions are source metadata only; calculation never mutates a shared snapshot.
  expect(JSON.stringify(definition)).not.toContain('"value"');
});

test('every source must be readable, including before any materialization or calculation', async () => {
  const f = fixture();
  const definition = await f.resolve('=SUM(Budget.Summary.A1,Forecast.Summary.A1)');
  f.workspace.share(f.owner.id, f.source.id, f.reader.id, 'viewer');
  f.load.mockClear();
  expect(await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify)).toEqual({
    ok: false,
    reason: 'private-source',
  });
  expect(f.load).not.toHaveBeenCalled();
  expect(f.calculate).not.toHaveBeenCalled();
  f.workspace.share(f.owner.id, f.second.id, f.reader.id, 'viewer');
  expect(await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify)).toMatchObject({
    ok: true,
  });
});

test('source revocation after an await discards the entire result and returns no current metadata', async () => {
  const f = fixture();
  const definition = await f.resolve();
  f.workspace.share(f.owner.id, f.source.id, f.reader.id, 'viewer');
  f.calculate.mockImplementationOnce(async () => {
    f.workspace.share(f.owner.id, f.source.id, f.reader.id, null);
    return { ok: true, kind: 'scalar', value: 'PRIVATE-VALUE' };
  });
  expect(await f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify)).toEqual({
    ok: false,
    reason: 'private-source',
  });
  expect(f.formulas.sources(f.reader.id, f.host.id, f.verify)).toEqual([]);
  await expect(
    f.formulas.sheets(f.reader.id, f.host.id, f.source.id, f.verify),
  ).rejects.toMatchObject({
    status: 404,
  });
});

test('restore during materialization or evaluation never returns a mixed-generation result', async () => {
  const f = fixture();
  const definition = await f.resolve();
  f.load.mockImplementationOnce(async (_user, id) => {
    f.generations.set(id, 'restored-during-load');
    return { snapshot: f.snapshots.get(id)!, revision: 1, access: 'owner' };
  });
  expect(await f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify)).toEqual({
    ok: false,
    reason: 'unavailable',
  });
  expect(f.calculate).not.toHaveBeenCalled();
  f.calculate.mockImplementationOnce(async () => {
    f.generations.set(f.source.id, 'restored-during-calculate');
    return { ok: true, kind: 'scalar', value: 99 };
  });
  expect(await f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify)).toEqual({
    ok: false,
    reason: 'unavailable',
  });
});

test('host revocation, disabled accounts and expired sessions do not become source placeholders', async () => {
  const f = fixture();
  const definition = await f.resolve();
  f.workspace.share(f.owner.id, f.source.id, f.reader.id, 'viewer');
  f.calculate.mockImplementationOnce(async () => {
    f.workspace.share(f.owner.id, f.host.id, f.reader.id, null);
    return { ok: true, kind: 'scalar', value: 99 };
  });
  await expect(
    f.formulas.evaluate(f.reader.id, f.host.id, definition, f.verify),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    f.formulas.evaluate(f.operator.id, f.host.id, definition, f.verify),
  ).rejects.toMatchObject({ status: 403 });
  f.calculate.mockImplementationOnce(async () => {
    f.verify.mockImplementation(() => {
      throw new AuthError(401, 'Expired');
    });
    return { ok: true, kind: 'scalar', value: 99 };
  });
  await expect(
    f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify),
  ).rejects.toMatchObject({ status: 401 });
});

test('guest host links never authorize source reads, while source-free formulas remain available', async () => {
  const f = fixture();
  const definition = await f.resolve();
  const change = f.workspace.links.begin(f.host.id, 'viewer');
  f.workspace.links.finish(f.host.id, change.epoch, true);
  const session = f.workspace.links.exchange(f.host.id, change.token, undefined);
  const user = f.workspace.links.principal(
    {
      cookie: `__Host-spinel-guest-${f.host.id}=${session.token}`,
    },
    f.host.id,
  ).userId;
  expect(await f.formulas.evaluate(user, f.host.id, definition, f.verify, true)).toEqual({
    ok: false,
    reason: 'missing-source',
  });
  expect(f.calculate).not.toHaveBeenCalled();
  const literal = await f.formulas.resolve(
    user,
    f.host.id,
    { expression: '={1,2;3,4}' },
    f.verify,
    true,
  );
  expect(literal.references).toEqual([]);
  expect(await f.formulas.evaluate(user, f.host.id, literal, f.verify, true)).toMatchObject({
    ok: true,
  });
  f.workspace.links.begin(f.host.id, null);
  await expect(f.formulas.evaluate(user, f.host.id, literal, f.verify, true)).rejects.toMatchObject(
    { status: 404 },
  );
});

test('one admitted request bounds reads and calculation; a busy request is never queued', async () => {
  const f = fixture();
  const definition = await f.resolve();
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
  const running = f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify);
  await started;
  expect(await f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify)).toEqual({
    ok: false,
    reason: 'busy',
  });
  await expect(f.resolve()).rejects.toMatchObject({ status: 429 });
  finish({ ok: true, kind: 'scalar', value: 3 });
  expect(await running).toMatchObject({ ok: true });
  expect(await f.formulas.evaluate(f.owner.id, f.host.id, definition, f.verify)).toMatchObject({
    ok: true,
  });
});

test('picker bindings disambiguate duplicate names and cannot bypass source permissions', async () => {
  const f = fixture();
  f.workspace.update(f.owner.id, f.second.id, { name: 'Budget' });
  const expression = '=SUM(Budget.Summary.A1,Budget.Summary.A1)';
  await expect(f.resolve(expression)).rejects.toThrow('one spreadsheet');
  const bindings = parseFormula(expression).map((reference, index) => ({
    start: reference.start,
    end: reference.end,
    range: reference.range,
    itemId: index === 0 ? f.source.id : f.second.id,
    sheetId: 'summary',
  }));
  const definition = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    { expression, bindings },
    f.verify,
  );
  expect(definition.references.map((reference) => reference.itemId)).toEqual([
    f.source.id,
    f.second.id,
  ]);
  const edited = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    { expression, previous: definition, format: 'number' },
    f.verify,
  );
  expect(edited.references).toEqual(definition.references);
  await expect(
    f.formulas.resolve(f.reader.id, f.host.id, { expression, bindings }, f.verify),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    f.formulas.resolve(
      f.owner.id,
      f.host.id,
      { expression, bindings: [{ ...bindings[0], end: bindings[0].end - 1 }] },
      f.verify,
    ),
  ).rejects.toMatchObject({ status: 400 });
});

test('editing addresses preserves renamed source identities rather than binding a new namesake', async () => {
  const f = fixture();
  const previous = await f.resolve();
  f.workspace.update(f.owner.id, f.source.id, { name: 'Renamed budget' });
  f.snapshots.get(f.source.id)!.sheets.summary.name = 'Renamed summary';
  f.workspace.update(f.owner.id, f.second.id, { name: 'Budget' });
  const edited = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    {
      expression: '=Budget.Summary.A2:C30',
      previous,
    },
    f.verify,
  );
  expect(edited.references[0]).toMatchObject({
    itemId: f.source.id,
    sheetId: 'summary',
    range: 'A2:C30',
  });
  f.snapshots.get(f.second.id)!.sheets.other = { id: 'other', name: 'Other', cellData: {} };
  f.snapshots.get(f.second.id)!.sheetOrder.push('other');
  const changedSource = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    {
      expression: '=Budget.Other.A2',
      previous,
    },
    f.verify,
  );
  expect(changedSource.references[0]).toMatchObject({
    itemId: f.second.id,
    sheetId: 'other',
    range: 'A2',
  });
});

test('duplicate-name address edits preserve slots and ambiguous reference removal requires an explicit choice', async () => {
  const f = fixture();
  f.workspace.update(f.owner.id, f.second.id, { name: 'Budget' });
  const expression = '=SUM(Budget.Summary.A1,Budget.Summary.A1)';
  const bindings = parseFormula(expression).map((reference, index) => ({
    start: reference.start,
    end: reference.end,
    range: reference.range,
    itemId: index === 0 ? f.source.id : f.second.id,
    sheetId: 'summary',
  }));
  const previous = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    { expression, bindings },
    f.verify,
  );
  f.workspace.update(f.owner.id, f.source.id, { name: 'Renamed budget' });
  const edited = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    {
      expression: '=SUM(Budget.Summary.A2,Budget.Summary.A3)',
      previous,
    },
    f.verify,
  );
  expect(edited.references.map((reference) => reference.itemId)).toEqual([
    f.source.id,
    f.second.id,
  ]);
  const shortened = '=Budget.Summary.A2';
  await expect(
    f.formulas.resolve(
      f.owner.id,
      f.host.id,
      {
        expression: shortened,
        previous,
      },
      f.verify,
    ),
  ).rejects.toThrow('intended spreadsheet');
  const parsed = parseFormula(shortened)[0];
  const selected = await f.formulas.resolve(
    f.owner.id,
    f.host.id,
    {
      expression: shortened,
      previous,
      bindings: [
        {
          start: parsed.start,
          end: parsed.end,
          range: parsed.range,
          itemId: f.source.id,
          sheetId: 'summary',
        },
      ],
    },
    f.verify,
  );
  expect(selected.references[0].itemId).toBe(f.source.id);
});
