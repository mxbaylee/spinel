import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { linkLegacyOfflineDependencies } from '../../e2e/offline-upgrade-dependencies.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'spinel-legacy-dependencies-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'archived');
  const installed = join(root, 'current');
  const packages: Record<string, object> = {
    '': { name: 'fixture', workspaces: ['lib/*'] },
    'lib/sync-client': { version: '0.0.0' },
    'lib/sync-transform': { version: '0.0.0' },
    'node_modules/@spinel/sync-client': { resolved: 'lib/sync-client', link: true },
    'node_modules/@spinel/sync-transform': { resolved: 'lib/sync-transform', link: true },
    'node_modules/external': { version: '1.0.0', integrity: 'sha512-pinned' },
  };
  for (const [directory, revision] of [
    [source, 'archived'],
    [installed, 'current'],
  ]) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify({ packages }));
    for (const name of ['sync-client', 'sync-transform']) {
      const workspace = join(directory, 'lib', name);
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          name: `@spinel/${name}`,
          type: 'module',
          exports: { '.': './index.ts', './detail': './detail.ts' },
        }),
      );
      await writeFile(join(workspace, 'detail.ts'), `export const revision = '${revision}';`);
    }
    await writeFile(
      join(directory, 'lib/sync-transform/index.ts'),
      `export const revision = '${revision}';`,
    );
    await writeFile(
      join(directory, 'lib/sync-client/index.ts'),
      `import { revision } from '@spinel/sync-transform';
export { revision };
export function persist(save: (checkpoint: unknown) => void) {
  save(${revision === 'archived' ? '{ unitId: revision }' : '() => ({ unitId: revision })'});
}`,
    );
  }
  const modules = join(installed, 'node_modules');
  await mkdir(join(modules, '@spinel'), { recursive: true });
  for (const name of ['sync-client', 'sync-transform'])
    await symlink(join(installed, 'lib', name), join(modules, '@spinel', name), 'dir');
  await mkdir(join(modules, 'external'));
  await writeFile(
    join(modules, 'external/package.json'),
    JSON.stringify({ name: 'external', version: '1.0.0', main: './index.ts' }),
  );
  await writeFile(join(modules, 'external/index.ts'), 'export const pinned = true;');
  await mkdir(join(modules, '.vite'));
  await writeFile(join(modules, '.vite/current-cache'), 'Current build only');
  return { root, source, installed, packages };
}

test('archived workspace imports preserve the eager contract and transitive source identity', async (t) => {
  const f = await fixture(t);
  const leaking = join(f.root, 'leaking');
  await cp(f.source, leaking, { recursive: true });
  await symlink(join(f.installed, 'node_modules'), join(leaking, 'node_modules'), 'dir');
  const currentEntry = createRequire(join(leaking, 'probe.ts')).resolve('@spinel/sync-client');
  assert.equal(currentEntry, join(f.installed, 'lib/sync-client/index.ts'));
  const current = await import(pathToFileURL(currentEntry).href);
  let received: unknown;
  current.persist((value: unknown) => {
    received = value;
  });
  assert.equal(
    typeof received,
    'function',
    'The original blanket link imports the incompatible API',
  );
  assert.equal(current.revision, 'current');

  const originals = await Promise.all(
    ['package-lock.json', 'lib/sync-client/index.ts', 'lib/sync-transform/index.ts'].map(
      async (path) => ({ path, bytes: await readFile(join(f.source, path)) }),
    ),
  );
  await linkLegacyOfflineDependencies(f.source, f.installed);
  const resolve = createRequire(join(f.source, 'probe.ts')).resolve;
  const archivedEntry = resolve('@spinel/sync-client');
  assert.equal(archivedEntry, join(f.source, 'lib/sync-client/index.ts'));
  assert.equal(resolve('@spinel/sync-client/detail'), join(f.source, 'lib/sync-client/detail.ts'));
  assert.equal(resolve('@spinel/sync-transform'), join(f.source, 'lib/sync-transform/index.ts'));
  const archived = await import(pathToFileURL(archivedEntry).href);
  archived.persist((value: unknown) => {
    received = value;
  });
  assert.deepEqual(received, { unitId: 'archived' });
  assert.equal(archived.revision, 'archived');
  assert.equal(resolve('external'), join(f.installed, 'node_modules/external/index.ts'));
  await assert.rejects(realpath(join(f.source, 'node_modules/.vite')), { code: 'ENOENT' });
  for (const { path, bytes } of originals)
    assert.deepEqual(await readFile(join(f.source, path)), bytes);
});

test('an extra current workspace is not exposed to the archived build', async (t) => {
  const f = await fixture(t);
  const extra = join(f.installed, 'node_modules/@spinel/extra');
  await mkdir(extra);
  await writeFile(join(extra, 'package.json'), JSON.stringify({ main: './index.ts' }));
  await writeFile(join(extra, 'index.ts'), 'export const currentOnly = true;');
  await linkLegacyOfflineDependencies(f.source, f.installed);
  assert.throws(() => createRequire(join(f.source, 'probe.ts')).resolve('@spinel/extra'), {
    code: 'MODULE_NOT_FOUND',
  });
});

test('external dependency drift is rejected before creating dependency links', async (t) => {
  const f = await fixture(t);
  f.packages['node_modules/external'] = { version: '2.0.0', integrity: 'sha512-changed' };
  await writeFile(join(f.installed, 'package-lock.json'), JSON.stringify({ packages: f.packages }));
  await assert.rejects(
    linkLegacyOfflineDependencies(f.source, f.installed),
    /Installed dependency differs/,
  );
  await assert.rejects(realpath(join(f.source, 'node_modules')), { code: 'ENOENT' });
});

for (const damage of ['missing manifest', 'wrong name', 'missing link', 'escaped link'] as const)
  test(`an archived workspace with ${damage} is rejected before linking`, async (t) => {
    const f = await fixture(t);
    const manifest = join(f.source, 'lib/sync-transform/package.json');
    if (damage === 'missing manifest') await rm(manifest);
    else if (damage === 'wrong name')
      await writeFile(manifest, JSON.stringify({ name: '@spinel/current-only' }));
    else {
      if (damage === 'missing link') delete f.packages['node_modules/@spinel/sync-transform'];
      else
        f.packages['node_modules/@spinel/sync-transform'] = {
          link: true,
          resolved: '../current/lib/sync-transform',
        };
      await writeFile(
        join(f.source, 'package-lock.json'),
        JSON.stringify({ packages: f.packages }),
      );
    }
    await assert.rejects(linkLegacyOfflineDependencies(f.source, f.installed));
    await assert.rejects(realpath(join(f.source, 'node_modules')), { code: 'ENOENT' });
  });
