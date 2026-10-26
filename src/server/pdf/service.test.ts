import { afterEach, expect, test, vi } from 'vitest';
import { LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { formulaBody, parseFormula } from '@spinel/doc-formulas';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { DocFormulas } from '../formulas/service.ts';
import { formulaAdmission } from '../formulas/admission.ts';
import { guestCookieName } from '../workspace/links.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { PdfExports, pdfSelection } from './service.ts';
import type { PdfJob, PdfResult } from './runner.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  cleanup.splice(0).forEach((close) => close());
});

function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Private owner identity');
  const editor = auth.createUser('Editor');
  const viewer = auth.createUser('Viewer');
  const operator = auth.createUser('Operator', true);
  const outsider = auth.createUser('Other account');
  const sessions = new Map(
    [owner, editor, viewer, operator, outsider].map((user) => [
      user.id,
      auth.createSession(user.id).session.token_hash,
    ]),
  );
  const account = (user = owner.id) => ({ sessionHash: sessions.get(user)! });
  const doc = workspace.create(owner.id, { name: 'Report', kind: 'doc', parentId: null });
  const sheet = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const second = workspace.create(owner.id, { name: 'Forecast', kind: 'sheet', parentId: null });
  for (const item of [doc, sheet]) {
    workspace.share(owner.id, item.id, editor.id, 'editor');
    workspace.share(owner.id, item.id, viewer.id, 'viewer');
  }
  const book = (id: string): IWorkbookData => ({
    id,
    name: 'Private metadata name',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: ['first', 'hidden', 'last'],
    sheets: {
      first: {
        id: 'first',
        name: 'Summary',
        rowCount: 100,
        columnCount: 8,
        cellData: { 0: { 0: { v: 42 } } },
      },
      hidden: {
        id: 'hidden',
        name: 'Hidden',
        hidden: 1,
        cellData: { 0: { 0: { v: 'hidden secret' } } },
      },
      last: {
        id: 'last',
        name: 'Details',
        rowCount: 100,
        columnCount: 8,
        cellData: { 0: { 0: { v: 11 } } },
      },
    },
  });
  const snapshots = new Map<string, IDocumentData | IWorkbookData>([
    [
      doc.id,
      {
        id: doc.id,
        documentStyle: {},
        body: {
          dataStream: 'Current confirmed content\r\n',
          paragraphs: [{ startIndex: 25, paragraphId: 'content' }],
        },
      },
    ],
    [sheet.id, book(sheet.id)],
    [second.id, book(second.id)],
  ]);
  const generations = new Map<string, string>();
  const restoring = new Set<string>();
  const load = vi.fn(async (_user: string, id: string) => ({
    snapshot: structuredClone(snapshots.get(id)!),
    revision: 9,
    access: 'owner',
  }));
  const collaboration = {
    prepare: vi.fn(async () => {}),
    load,
    generations: {
      active: (id: string) => ({ unitId: generations.get(id) ?? id }),
      restoring: (id: string) => restoring.has(id),
    },
  } as unknown as CollaborationStore;
  const pdf = (): PdfResult => ({
    bytes: Buffer.from('%PDF-complete'),
    pages: 1,
    mediaBox: { width: 595, height: 842 },
    durationMs: 1,
    peakRssBytes: 200_000_000,
  });
  const jobs: PdfJob[] = [];
  const render = vi.fn(async (job: PdfJob, _signal?: AbortSignal): Promise<PdfResult> => {
    jobs.push(structuredClone(job));
    return pdf();
  });
  const exports = new PdfExports(workspace, collaboration, render);
  const guest = (id = doc.id, role: 'viewer' | 'editor' = 'viewer') => {
    const link = workspace.links.begin(id, role);
    workspace.links.finish(id, link.epoch, true);
    const session = workspace.links.exchange(id, link.token!);
    const principal = workspace.links.principal(
      { cookie: `${guestCookieName(id)}=${session.token}` },
      id,
    );
    return { user: principal.userId, custom: { guestHash: principal.guestHash, guestItem: id } };
  };
  const exportAs = (
    user = owner.id,
    id = doc.id,
    custom: Record<string, unknown> = account(user),
    signal?: AbortSignal,
  ) => exports.export(user, id, undefined, () => {}, custom, signal);
  return {
    db,
    auth,
    workspace,
    owner,
    editor,
    viewer,
    operator,
    outsider,
    doc,
    sheet,
    second,
    snapshots,
    generations,
    restoring,
    account,
    collaboration,
    exports,
    render,
    jobs,
    guest,
    exportAs,
    pdf,
  };
}

function addFormula(f: ReturnType<typeof fixture>, sources = [f.sheet.id]) {
  const expression =
    sources.length === 1 ? '=Budget.Summary.A1' : '=SUM(Budget.Summary.A1,Forecast.Summary.A1)';
  const definition: FormulaDefinition = {
    version: 1,
    expression,
    references: parseFormula(expression).map((ref, i) => ({
      start: ref.start,
      end: ref.end,
      itemId: sources[i],
      sheetId: 'first',
      range: 'A1',
    })),
  };
  const body = formulaBody('calculation', definition);
  body.dataStream += '\r\n';
  body.paragraphs = [{ startIndex: expression.length, paragraphId: 'formula' }];
  f.snapshots.set(f.doc.id, { id: f.doc.id, documentStyle: {}, body });
  return definition;
}

test('owners, editors, account viewers and view/edit guests export both current native formats', async () => {
  const f = fixture();
  for (const item of [f.doc, f.sheet]) {
    for (const actor of [f.owner, f.editor, f.viewer]) {
      const result = await f.exportAs(actor.id, item.id);
      expect(result.bytes.toString()).toBe('%PDF-complete');
      expect(() => result.verify()).not.toThrow();
    }
    for (const role of ['viewer', 'editor'] as const) {
      const guest = f.guest(item.id, role);
      expect((await f.exportAs(guest.user, item.id, guest.custom)).bytes.toString()).toBe(
        '%PDF-complete',
      );
    }
  }
  expect(f.collaboration.load).toHaveBeenCalledTimes(10);
  expect(JSON.stringify(f.jobs)).toContain('Current confirmed content');
  expect(JSON.stringify(f.jobs)).not.toContain(f.owner.name);
  expect(JSON.stringify(f.jobs)).not.toContain(f.account().sessionHash);
});

test('operators, outsiders and a guest of another document cannot enter rendering', async () => {
  const f = fixture();
  for (const user of [f.operator.id, f.outsider.id])
    await expect(f.exportAs(user)).rejects.toThrow();
  const guest = f.guest(f.sheet.id);
  await expect(f.exportAs(guest.user, f.doc.id, guest.custom)).rejects.toThrow();
  expect(f.render).not.toHaveBeenCalled();
});

test('worksheet options omit hidden sheets, default to workbook order and validate subsets', async () => {
  const f = fixture();
  expect(await f.exports.options(f.owner.id, f.sheet.id, () => {}, f.account())).toEqual({
    kind: 'sheet',
    worksheets: [
      { id: 'first', name: 'Summary' },
      { id: 'last', name: 'Details' },
    ],
  });
  await f.exports.export(f.owner.id, f.sheet.id, ['last'], () => {}, f.account());
  expect(f.jobs[0]).toMatchObject({ kind: 'sheet', worksheetIds: ['last'] });
  for (const selection of [['hidden'], ['unknown']])
    await expect(
      f.exports.export(f.owner.id, f.sheet.id, selection, () => {}, f.account()),
    ).rejects.toThrow('visible worksheet');
  await expect(
    f.exports.export(f.owner.id, f.doc.id, ['first'], () => {}, f.account()),
  ).rejects.toThrow('only available for Sheets');
  for (const body of [
    null,
    [],
    { worksheetIds: [] },
    { worksheetIds: ['first', 'first'] },
    { worksheetIds: [''] },
    { user: 'other' },
  ])
    expect(() => pdfSelection(body)).toThrow();
  expect(pdfSelection({})).toBeUndefined();
});

test('host restoration or access loss after materialization aborts before rendering', async () => {
  const f = fixture();
  f.collaboration.load = vi.fn(async (_user, id) => {
    f.generations.set(id, 'restored');
    return { snapshot: f.snapshots.get(id)!, revision: 10, access: 'owner' as const };
  });
  await expect(f.exportAs()).rejects.toThrow('restored');
  expect(f.render).not.toHaveBeenCalled();
});

test.each(['session', 'share', 'restore', 'image'] as const)(
  'final %s check prevents returning rendered bytes',
  async (boundary) => {
    const f = fixture();
    f.render.mockImplementationOnce(async () => {
      if (boundary === 'session')
        f.db
          .prepare('DELETE FROM sessions WHERE token_hash=?')
          .run(f.account(f.viewer.id).sessionHash);
      if (boundary === 'share') f.workspace.share(f.owner.id, f.doc.id, f.viewer.id, null);
      if (boundary === 'restore') f.generations.set(f.doc.id, 'restored');
      if (boundary === 'image')
        f.db.prepare('DELETE FROM doc_images WHERE item_id=?').run(f.doc.id);
      return f.pdf();
    });
    if (boundary === 'image') {
      // A prepared image is keyed by immutable bytes; deleting it during rendering
      // invalidates the whole output even though the child already owns a copy.
      const imageId = 'a'.repeat(64);
      f.db
        .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
        .run(f.doc.id, imageId, 'image/png', Buffer.from([1]));
      const snapshot = f.snapshots.get(f.doc.id) as IDocumentData;
      snapshot.drawings = {
        picture: {
          drawingId: 'picture',
          unitId: f.doc.id,
          subUnitId: f.doc.id,
          drawingType: 0,
          imageSourceType: 1,
          source: `/api/items/${f.doc.id}/images/${imageId}`,
          layoutType: 0,
          docTransform: {
            angle: 0,
            size: { width: 10, height: 10 },
            positionH: { relativeFrom: 0, posOffset: 0 },
            positionV: { relativeFrom: 0, posOffset: 0 },
          },
        },
      } as IDocumentData['drawings'];
      snapshot.drawingsOrder = ['picture'];
    }
    await expect(f.exportAs(f.viewer.id)).rejects.toThrow();
    expect(f.render).toHaveBeenCalledOnce();
  },
);

test('revoked guest aborts a running renderer and cannot fall back to account identity', async () => {
  const f = fixture();
  const guest = f.guest();
  f.render.mockImplementationOnce(async (_job, signal) => {
    const change = f.workspace.links.begin(f.doc.id, null);
    f.workspace.links.finish(f.doc.id, change.epoch, false);
    return new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('renderer stopped')), {
        once: true,
      });
      setTimeout(() => reject(new Error('Expected authorization polling')), 1000).unref();
    });
  });
  await expect(f.exportAs(guest.user, f.doc.id, guest.custom)).rejects.toThrow();
  expect(f.render.mock.calls[0][1]?.aborted).toBe(true);
});

test('Formula sources inaccessible from the outset produce only a whole neutral placeholder', async () => {
  const f = fixture();
  addFormula(f, [f.sheet.id, f.second.id]);
  const evaluate = vi.spyOn(DocFormulas.prototype, 'evaluate');
  await f.exportAs(f.viewer.id);
  expect(evaluate).not.toHaveBeenCalled();
  expect(f.jobs[0]).toMatchObject({
    kind: 'doc',
    input: { formulas: [{ rangeId: 'calculation', result: { kind: 'unavailable' } }] },
  });
});

test('loss of one aggregate input discards the entire first PDF and rebuilds once', async () => {
  const f = fixture();
  addFormula(f, [f.sheet.id, f.second.id]);
  f.workspace.share(f.owner.id, f.second.id, f.viewer.id, 'viewer');
  vi.spyOn(DocFormulas.prototype, 'evaluate').mockResolvedValue({
    ok: true,
    kind: 'scalar',
    value: 53,
  });
  const first = f.pdf();
  f.render.mockImplementationOnce(async (job) => {
    f.jobs.push(structuredClone(job));
    f.workspace.share(f.owner.id, f.second.id, f.viewer.id, null);
    return first;
  });
  const exported = await f.exportAs(f.viewer.id);
  expect(f.render).toHaveBeenCalledTimes(2);
  expect(f.jobs[0]).toMatchObject({
    input: { formulas: [{ result: { kind: 'scalar', value: '53' } }] },
  });
  expect(f.jobs[1]).toMatchObject({ input: { formulas: [{ result: { kind: 'unavailable' } }] } });
  expect(first.bytes.every((byte) => byte === 0)).toBe(true);
  expect(exported.bytes.toString()).toBe('%PDF-complete');
});

test('a second source loss discards both PDFs and stops after the single allowed rebuild', async () => {
  const f = fixture();
  const definition = addFormula(f);
  f.workspace.share(f.owner.id, f.second.id, f.viewer.id, 'viewer');
  const snapshot = f.snapshots.get(f.doc.id) as IDocumentData;
  const second = formulaBody('second-calculation', {
    ...definition,
    references: definition.references.map((reference) => ({ ...reference, itemId: f.second.id })),
  });
  const prefix = snapshot.body!.dataStream.slice(0, -2) + ' ';
  snapshot.body = {
    dataStream: prefix + second.dataStream + '\r\n',
    paragraphs: [{ startIndex: prefix.length + second.dataStream.length, paragraphId: 'formulas' }],
    customRanges: [
      ...snapshot.body!.customRanges!,
      ...second.customRanges!.map((range) => ({
        ...range,
        startIndex: range.startIndex + prefix.length,
        endIndex: range.endIndex + prefix.length,
      })),
    ],
  };
  vi.spyOn(DocFormulas.prototype, 'evaluate').mockResolvedValue({
    ok: true,
    kind: 'scalar',
    value: 42,
  });
  const discarded = [f.pdf(), f.pdf()];
  for (const [index, id] of [f.sheet.id, f.second.id].entries()) {
    f.render.mockImplementationOnce(async () => {
      f.workspace.share(f.owner.id, id, f.viewer.id, null);
      return discarded[index];
    });
  }
  await expect(f.exportAs(f.viewer.id)).rejects.toThrow('Formula access changed again');
  expect(f.render).toHaveBeenCalledTimes(2);
  expect(discarded.every((file) => file.bytes.every((byte) => byte === 0))).toBe(true);
});

test('late source generation changes fail and final publication verifier repeats all access checks', async () => {
  const f = fixture();
  addFormula(f);
  vi.spyOn(DocFormulas.prototype, 'evaluate').mockResolvedValue({
    ok: true,
    kind: 'scalar',
    value: 42,
  });
  f.render.mockImplementationOnce(async () => {
    f.generations.set(f.sheet.id, 'source-restored');
    return f.pdf();
  });
  await expect(f.exportAs(f.viewer.id)).rejects.toThrow('source was restored');
  f.generations.clear();
  const file = await f.exportAs(f.viewer.id);
  f.workspace.share(f.owner.id, f.sheet.id, f.viewer.id, null);
  expect(() => file.verify()).toThrow('Formula access changed');
});

test('complete 30-row Formula results survive preparation; resource failures do not become partial PDFs', async () => {
  const f = fixture();
  addFormula(f);
  const rows = Array.from({ length: 30 }, (_, i) => [`row-${i + 1}`, i + 1]);
  const evaluate = vi
    .spyOn(DocFormulas.prototype, 'evaluate')
    .mockResolvedValue({ ok: true, kind: 'table', rows });
  await f.exportAs();
  expect(f.jobs[0]).toMatchObject({
    input: { formulas: [{ result: { kind: 'table', rows: rows.map((row) => row.map(String)) } }] },
  });
  evaluate.mockResolvedValue({ ok: false, reason: 'too-large' });
  await expect(f.exportAs()).rejects.toThrow('limit');
  expect(f.render).toHaveBeenCalledTimes(1);
});

test('PDF native work waits for existing Formula admission, and cancellation keeps no future render queued', async () => {
  const f = fixture();
  const release = await formulaAdmission.acquire(() => {});
  const controller = new AbortController();
  const task = f.exportAs(f.owner.id, f.doc.id, f.account(), controller.signal);
  await vi.waitFor(() => expect(f.collaboration.load).toHaveBeenCalled());
  controller.abort();
  await expect(task).rejects.toThrow();
  expect(f.render).not.toHaveBeenCalled();
  release();
  expect((await f.exportAs()).bytes.toString()).toBe('%PDF-complete');
});

test('exact Space child scope and current root role control both account and guest export', async () => {
  const f = fixture();
  const spaces = new SpaceStore(f.workspace);
  const space = spaces.createRoot(f.owner.id, { name: 'Project', parentId: null }).space;
  const child = spaces.createChild(f.owner.id, space.id, {
    name: 'Page',
    kind: 'doc',
    parentId: space.id,
  }).item;
  const sibling = spaces.createChild(f.owner.id, space.id, {
    name: 'Sibling',
    kind: 'doc',
    parentId: space.id,
  }).item;
  f.snapshots.set(child.id, {
    id: child.id,
    body: { dataStream: 'Scoped content\r\n' },
    documentStyle: {},
  });
  spaces.share(f.owner.id, space.id, f.viewer.id, 'viewer');
  const scope = { ...f.account(f.viewer.id), spaceId: space.id, spaceItem: child.id };
  await expect(f.exportAs(f.viewer.id, child.id, scope)).resolves.toHaveProperty('pages', 1);
  await expect(f.exportAs(f.viewer.id, sibling.id, scope)).rejects.toThrow();
  await expect(f.exportAs(f.viewer.id, child.id, f.account(f.viewer.id))).rejects.toThrow();
  const guest = f.guest(space.id);
  await expect(
    f.exportAs(guest.user, child.id, { ...guest.custom, spaceId: space.id, spaceItem: child.id }),
  ).resolves.toHaveProperty('pages', 1);
  f.render.mockImplementationOnce(async () => {
    spaces.share(f.owner.id, space.id, f.viewer.id, null);
    return f.pdf();
  });
  await expect(f.exportAs(f.viewer.id, child.id, scope)).rejects.toThrow();
});
