import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import { createApp } from '../../server/app.ts';
import { openDatabase } from '../../server/database.ts';
import { AuthStore } from '../server/auth/store.ts';
import { WorkspaceStore } from '../server/workspace/store.ts';
import { SpaceStore } from '../server/workspace/spaces.ts';
import { guestCookieName } from '../server/workspace/links.ts';
import type {
  MaintenanceAdminStatus,
  MaintenanceBridge,
  MaintenancePublicStatus,
} from '../shared/maintenance.ts';
import { publicMaintenance } from '../shared/maintenance.ts';

const nativeFetch = globalThis.fetch;
const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const close of cleanups.splice(0).reverse()) await close();
});

for (const space of [false, true]) {
  test(`default guest Formula transport keeps the supervised ${space ? 'Space child' : 'Doc'} epoch and access fence`, async () => {
    vi.resetModules();
    const directory = await mkdtemp(join(tmpdir(), 'spinel-formula-maintenance-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'index.html'), 'Synthetic Formula fixture');
    let current: MaintenanceAdminStatus = {
      available: true,
      phase: 'running',
      epoch: 'formula-before',
      notice: null,
      operationId: randomUUID(),
      authorityExpiresAt: Date.now() + 60000,
      generationId: randomUUID(),
      lastFailure: null,
      readyToResume: false,
    };
    const listeners = new Set<(status: MaintenancePublicStatus) => void>();
    const update = (patch: Partial<MaintenanceAdminStatus>) => {
      current = { ...current, ...patch };
      for (const listener of listeners) listener(publicMaintenance(current));
    };
    const bridge: MaintenanceBridge = {
      status: () => publicMaintenance(current),
      adminStatus: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async control() {
        return { status: current };
      },
      drained(epoch) {
        if (current.epoch === epoch) update({ phase: 'paused' });
      },
      ready() {},
      fail() {
        throw new Error('Fixture drain failed.');
      },
      close() {},
    };
    const databasePath = join(directory, 'workspace.sqlite');
    const origin = 'http://localhost:3000';
    const app = await createApp({
      databasePath,
      staticDirectory: directory,
      origin,
      maintenance: bridge,
    });
    cleanups.push(() => app.close());
    const database = openDatabase(databasePath);
    cleanups.push(() => database.close());
    const auth = new AuthStore(database);
    const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
    const owner = auth.createUser('Synthetic owner');
    const spaces = new SpaceStore(workspace);
    const spaceId = space
      ? spaces.createRoot(owner.id, { name: 'Synthetic space', parentId: null }).space.id
      : undefined;
    const host = spaceId
      ? spaces.createChild(owner.id, spaceId, {
          name: 'Synthetic Doc',
          kind: 'doc',
          parentId: spaceId,
        }).item
      : workspace.create(owner.id, { name: 'Synthetic Doc', kind: 'doc', parentId: null });
    const rootId = spaceId ?? host.id;
    const link = workspace.links.begin(rootId, 'editor');
    workspace.links.finish(rootId, link.epoch, true);
    const guest = workspace.links.exchange(rootId, link.token);
    const cookie = `${guestCookieName(rootId)}=${guest.token}`;
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const calls: Array<{ path: string; epoch: string | null; status: number }> = [];
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('location', { origin, pathname: `/share/${rootId}` });
    // Only browser cookie/URL plumbing is supplied here. The actual Formula
    // default transport, maintenance wrapper, HTTP admission and native evaluator run.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), origin).pathname;
      const headers = new Headers(init?.headers);
      headers.set('Cookie', cookie);
      headers.set('Origin', origin);
      const response = await nativeFetch(endpoint + path, { ...init, headers });
      calls.push({ path, epoch: headers.get('X-Spinel-Epoch'), status: response.status });
      return response;
    });
    const { formulaRequest } = await import('../../web/DocFormulas.tsx');
    const { refreshMaintenanceStatus } = await import('../../web/maintenanceState.ts');
    const base = spaceId
      ? `/api/guest-spaces/${spaceId}/items/${host.id}`
      : `/api/guest/${host.id}`;
    const resolve = () =>
      formulaRequest<{ definition: FormulaDefinition }>(
        host.id,
        'resolve',
        { expression: '=1+2' },
        undefined,
        spaceId,
      );
    const { definition } = await resolve();
    expect(definition).toEqual({ version: 1, expression: '=1+2', references: [] });
    await expect(
      formulaRequest(host.id, 'evaluate', { definition }, undefined, spaceId),
    ).resolves.toEqual({ ok: true, kind: 'scalar', value: 3 });
    expect(calls.filter((call) => call.path.startsWith(base))).toEqual([
      { path: `${base}/formulas/resolve`, epoch: 'formula-before', status: 200 },
      { path: `${base}/formulas/evaluate`, epoch: 'formula-before', status: 200 },
    ]);
    // A successful status refresh must never bless requests from the old tab.
    update({ epoch: 'formula-after' });
    await refreshMaintenanceStatus();
    await expect(resolve()).rejects.toThrow('Maintenance changed');
    expect(calls.at(-1)).toEqual({
      path: `${base}/formulas/resolve`,
      epoch: 'formula-before',
      status: 409,
    });
    // A fresh module context represents a new tab, not silently upgraded authority.
    vi.resetModules();
    const fresh = (await import('../../web/DocFormulas.tsx')).formulaRequest;
    await expect(fresh(host.id, 'evaluate', { definition }, undefined, spaceId)).resolves.toEqual({
      ok: true,
      kind: 'scalar',
      value: 3,
    });
    expect(calls.at(-1)?.epoch).toBe('formula-after');
    workspace.links.begin(rootId, null);
    await expect(fresh(host.id, 'evaluate', { definition }, undefined, spaceId)).rejects.toThrow();
    expect(calls.at(-1)?.status).toBe(404);
  }, 30000);
}

test('an explicit offline Formula transport and its verification remain authoritative', async () => {
  vi.resetModules();
  vi.stubGlobal('location', { origin: 'https://spinel.example', pathname: '/' });
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  const { formulaRequest } = await import('../../web/DocFormulas.tsx');
  const verify = vi.fn();
  const request = vi.fn(async () => Response.json({ ok: true, kind: 'scalar', value: 3 }));
  await expect(
    formulaRequest('offline-id', 'evaluate', { definition: {} }, undefined, undefined, undefined, {
      fetch: request,
      verify,
    }),
  ).resolves.toMatchObject({ value: 3 });
  expect(request).toHaveBeenCalledOnce();
  expect(verify).toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
