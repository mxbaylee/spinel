import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { getDocsEmptySnapshot } from '@univerjs/core';
import { formulaBody, parseFormula } from '@spinel/doc-formulas';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { DocumentStore } from './documents.ts';
import { WorkspaceStore } from './store.ts';

test('source-sharing HTTP keeps host-only writes unchanged and fences explicit source grants', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-source-sharing-http-'));
  const path = join(directory, 'db.sqlite');
  await writeFile(join(directory, 'index.html'), 'Fixture');
  const app = await createApp({ databasePath: path, staticDirectory: directory });
  const db = openDatabase(path);
  try {
    await new Promise<void>((ready) => app.server.listen(0, '127.0.0.1', ready));
    const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/items`;
    const auth = new AuthStore(db);
    const workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Owner');
    const recipient = auth.createUser('Recipient');
    const other = auth.createUser('Another recipient');
    const operator = auth.createUser('Operator', true);
    const cookie = (id: string) => `${COOKIE_NAME}=${auth.createSession(id).token}`;
    const ownerCookie = cookie(owner.id);
    const recipientCookie = cookie(recipient.id);
    const operatorCookie = cookie(operator.id);
    const host = workspace.create(owner.id, { name: 'Report', kind: 'doc', parentId: null });
    const source = workspace.create(owner.id, {
      name: 'Private budget',
      kind: 'sheet',
      parentId: null,
    });
    const expression = '=Budget.Summary.A1';
    const fragment = formulaBody('formula', {
      version: 1,
      expression,
      references: parseFormula(expression).map((reference) => ({
        start: reference.start,
        end: reference.end,
        range: reference.range,
        itemId: source.id,
        sheetId: 'summary',
      })),
    });
    new DocumentStore(workspace).save(owner.id, host.id, {
      snapshot: {
        ...getDocsEmptySnapshot(host.id),
        body: { ...fragment, dataStream: fragment.dataStream + '\r\n' },
      },
      revision: 0,
      writeId: randomUUID(),
    });
    const request = (
      suffix: string,
      method = 'GET',
      data?: unknown,
      credential = ownerCookie,
      origin = 'http://localhost:3000',
      expectedAccount?: string,
    ) =>
      fetch(root + suffix, {
        method,
        headers: {
          Cookie: credential,
          Origin: origin,
          'Content-Type': 'application/json',
          ...(expectedAccount ? { 'X-Spinel-Offline-Account': expectedAccount } : {}),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    const selected = { userId: recipient.id, role: 'viewer' };
    const preview = async () => {
      const response = await request(`/${host.id}/sharing/review`, 'POST', selected);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      return (await response.json()).review;
    };
    const before = await preview();
    expect(before.targets).toMatchObject([{ id: source.id, state: 'grant' }]);
    const sourceGrants = () =>
      db.prepare('SELECT * FROM workspace_grants WHERE item_id=?').all(source.id);
    // The unchecked flow is exactly the established host-only sharing request.
    expect((await request(`/${host.id}/sharing`, 'PUT', selected)).status).toBe(200);
    expect(sourceGrants()).toEqual([]);
    expect((await request(`/${source.id}`, 'GET', undefined, recipientCookie)).status).toBe(404);
    const review = await preview();
    expect(
      (await request(`/${host.id}/sharing`, 'PUT', { ...selected, sourceReview: before.version }))
        .status,
    ).toBe(409);
    expect(sourceGrants()).toEqual([]);
    for (const body of [
      { ...selected, sourceReview: review.version, targetIds: [source.id] },
      { ...selected, includeSources: true },
      { ...selected, sourceReview: '' },
      { ...selected, sourceReview: null },
      { userId: recipient.id, role: 'owner', sourceReview: review.version },
    ])
      expect((await request(`/${host.id}/sharing`, 'PUT', body)).status).toBe(400);
    expect(
      (
        await request(`/${host.id}/sharing`, 'PUT', {
          userId: other.id,
          role: 'viewer',
          sourceReview: review.version,
        })
      ).status,
    ).toBe(409);
    for (const endpoint of ['sharing/review', 'sharing']) {
      const method = endpoint.endsWith('review') ? 'POST' : 'PUT';
      const body = endpoint.endsWith('review')
        ? selected
        : { ...selected, sourceReview: review.version };
      expect(
        (
          await request(
            `/${host.id}/${endpoint}`,
            method,
            body,
            ownerCookie,
            'https://wrong.example',
          )
        ).status,
      ).toBe(403);
      expect((await request(`/${host.id}/${endpoint}`, method, body, '')).status).toBe(401);
      expect((await request(`/${host.id}/${endpoint}`, method, body, operatorCookie)).status).toBe(
        403,
      );
      expect((await request(`/${host.id}/${endpoint}`, method, body, recipientCookie)).status).toBe(
        403,
      );
      expect(
        (
          await request(
            `/${host.id}/${endpoint}`,
            method,
            body,
            ownerCookie,
            'http://localhost:3000',
            other.id,
          )
        ).status,
      ).toBe(409);
    }
    expect(sourceGrants()).toEqual([]);
    const response = await request(`/${host.id}/sharing`, 'PUT', {
      ...selected,
      sourceReview: review.version,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceOutcome: { host: 'unchanged', shared: [source.id], failed: [], complete: true },
    });
    expect((await request(`/${source.id}`, 'GET', undefined, recipientCookie)).status).toBe(200);
    expect(sourceGrants()).toMatchObject([{ user_id: recipient.id, role: 'viewer' }]);
    expect((await request(`/${source.id}/sharing/review`, 'POST', selected)).status).toBe(400);
    // Ordinary Sheets and folders retain their original sharing request shape.
    expect(
      (await request(`/${source.id}/sharing`, 'PUT', { userId: other.id, role: 'editor' })).status,
    ).toBe(200);
  } finally {
    db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
