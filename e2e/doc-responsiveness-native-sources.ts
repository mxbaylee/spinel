import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, glob, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { CDPSession } from '@playwright/test';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function validateNativeMap(payload: any, identities: Record<string, string>) {
  assert.equal(payload.version, 3);
  assert.ok(Array.isArray(payload.sources) && Array.isArray(payload.sourcesContent));
  assert.equal(payload.sources.length, payload.sourcesContent.length);
  assert.equal(new Set(payload.sources).size, payload.sources.length);
  assert.equal(typeof payload.mappings, 'string');
  const found: Record<string, string> = {};
  for (const [index, source] of payload.sources.entries()) {
    assert.equal(typeof source, 'string');
    for (const [path, expected] of Object.entries(identities)) {
      if (!source.replaceAll('\\', '/').endsWith('/' + path)) continue;
      const content = payload.sourcesContent[index];
      assert.equal(typeof content, 'string', `Missing ${path} source`);
      assert.equal(hash(content), expected, `Wrong embedded ${path}`);
      assert.equal(found[path], undefined, `Duplicate ${path}`);
      found[path] = expected;
    }
  }
  return found;
}

export function validateLoadedNativeScript(
  executed: string,
  emitted: Buffer,
  mapBytes: Buffer | null,
  identities: Record<string, string>,
) {
  assert.equal(hash(executed), hash(emitted), 'Loaded code differs from emitted code');
  return mapBytes ? validateNativeMap(JSON.parse(mapBytes.toString()), identities) : {};
}

const optionalMapStat = async (path: string) =>
  stat(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });

export type PreparedNativeSources = {
  complete: true;
  identities: Record<string, string>;
  files: Array<{
    path: string;
    bytes: number;
    sha256: string;
    mapStatus: 'present' | 'absent-at-collection';
    mapBytes: number | null;
    mapSha256: string | null;
    mapped: Record<string, string>;
  }>;
};

/** Static map parsing owns a separate process before either live editor exists. */
export async function prepareNativeWindowSources(
  directory: string,
  identities: Record<string, string>,
): Promise<PreparedNativeSources> {
  const root = await realpath(directory),
    files: PreparedNativeSources['files'] = [];
  const bindings: Record<string, string> = {};
  let total = 0;
  for await (const local of glob('**/*.js', { cwd: root })) {
    assert.ok(files.length < 512, 'Prepared script count exceeds512');
    const path = await realpath(resolve(root, local));
    assert.ok(!relative(root, path).startsWith('..'));
    const codeStat = await stat(path),
      mapStat = await optionalMapStat(path + '.map');
    if (mapStat)
      assert.ok(
        !relative(root, await realpath(path + '.map')).startsWith('..'),
        'Prepared map escaped build',
      );
    total += codeStat.size + (mapStat?.size ?? 0);
    assert.ok(total <= 64 * 1024 ** 2, 'Prepared code/maps exceed64MiB');
    const code = await readFile(path),
      map = mapStat ? await readFile(path + '.map') : null;
    assert.equal(code.length, codeStat.size);
    if (map) assert.equal(map.length, mapStat!.size);
    const mapped = map ? validateNativeMap(JSON.parse(map.toString()), identities) : {};
    for (const [key, value] of Object.entries(mapped)) {
      assert.equal(bindings[key], undefined, 'Duplicate prepared native binding');
      bindings[key] = value;
    }
    files.push({
      path: local,
      bytes: code.length,
      sha256: hash(code),
      mapStatus: map ? 'present' : 'absent-at-collection',
      mapBytes: map?.length ?? null,
      mapSha256: map ? hash(map) : null,
      mapped,
    });
  }
  assert.deepEqual(bindings, identities, 'Prepared native/Core binding incomplete');
  return { complete: true, identities, files };
}

/** Stream the immutable map during live ownership; never parse or stringify it. */
async function verifyPreparedMap(
  path: string,
  row: PreparedNativeSources['files'][number],
  root: string,
) {
  const current = await optionalMapStat(path);
  if (row.mapStatus === 'absent-at-collection') {
    assert.equal(current, null, 'Map appeared after preparation');
    assert.equal(row.mapBytes, null);
    assert.equal(row.mapSha256, null);
    return;
  }
  assert.ok(current, 'Prepared map disappeared');
  assert.ok(!relative(root, await realpath(path)).startsWith('..'), 'Prepared map escaped root');
  assert.equal(current.size, row.mapBytes, 'Prepared map size changed');
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    assert.ok(bytes <= row.mapBytes!, 'Prepared map grew during read');
    digest.update(chunk);
  }
  assert.equal(bytes, row.mapBytes);
  assert.equal(digest.digest('hex'), row.mapSha256, 'Prepared map digest changed');
}

/** Final analysis independently verifies every retained emitted-code/map member. */
export async function validateRetainedNativeSources(
  directory: string,
  observed: any,
  identities: Record<string, string>,
) {
  const root = await realpath(directory);
  assert.ok((await stat(resolve(root, 'binding.json'))).size <= 1024 ** 2);
  const receipt = JSON.parse(await readFile(resolve(root, 'binding.json'), 'utf8'));
  assert.deepEqual(receipt, observed, 'Retained source receipt differs from observation');
  assert.equal(receipt.complete, true);
  assert.ok(
    Array.isArray(receipt.scripts) && receipt.scripts.length > 0 && receipt.scripts.length <= 512,
  );
  const ids = new Set(),
    paths = new Set(),
    bindings: Record<string, string> = {};
  let total = 0;
  const member = async (path: string, bytes: number, sha256: string) => {
    assert.ok(typeof path === 'string' && !path.startsWith('/') && !/[\\\0]/.test(path));
    assert.ok(!path.split('/').includes('..'));
    assert.ok(Number.isSafeInteger(bytes) && bytes >= 0 && /^[a-f0-9]{64}$/.test(sha256));
    total += bytes;
    assert.ok(total <= 64 * 1024 ** 2, 'Retained source closure exceeds64MiB');
    const actual = await realpath(resolve(root, path));
    assert.ok(!relative(root, actual).startsWith('..'));
    assert.equal((await stat(actual)).size, bytes, 'Retained source size mismatch');
    const content = await readFile(actual);
    assert.equal(hash(content), sha256, 'Retained source digest mismatch');
    return content;
  };
  for (const row of receipt.scripts) {
    assert.ok(typeof row.scriptId === 'string' && row.scriptId.length > 0);
    assert.ok(!ids.has(row.scriptId) && !paths.has(row.path), 'Duplicate retained script');
    ids.add(row.scriptId);
    paths.add(row.path);
    assert.ok(row.path.endsWith('.js'));
    const emitted = await member(row.path, row.bytes, row.sha256);
    assert.ok(['present', 'absent-at-collection'].includes(row.mapStatus));
    let map: Buffer | null = null;
    if (row.mapStatus === 'present')
      map = await member(row.path + '.map', row.mapBytes, row.mapSha256);
    else {
      assert.equal(row.mapBytes, null);
      assert.equal(row.mapSha256, null);
      assert.equal(await optionalMapStat(resolve(root, row.path + '.map')), null);
    }
    const mapped = validateLoadedNativeScript(emitted.toString(), emitted, map, identities);
    assert.deepEqual(mapped, row.mapped);
    for (const [key, value] of Object.entries(mapped)) {
      assert.equal(bindings[key], undefined, 'Duplicate retained native binding');
      bindings[key] = value;
    }
  }
  assert.equal(total, receipt.bytes);
  assert.deepEqual(bindings, identities, 'Retained prior native/Core binding incomplete');
  assert.deepEqual(bindings, receipt.bindings);
  return receipt;
}

/** Read exact executed sources before typing; no Debugger pauses or breakpoints. */
export async function observeNativeWindowSources(cdp: CDPSession, origin: string) {
  const scripts: Array<{ scriptId: string; url: string }> = [];
  let overflow = false;
  const listener = (script: { scriptId: string; url: string }) => {
    if (scripts.length >= 512) overflow = true;
    else scripts.push({ scriptId: script.scriptId, url: script.url });
  };
  cdp.on('Debugger.scriptParsed', listener);
  try {
    await cdp.send('Debugger.enable');
  } catch (error) {
    cdp.off('Debugger.scriptParsed', listener);
    throw error;
  }
  return {
    async retain(
      destination: string,
      identities: Record<string, string>,
      prepared: PreparedNativeSources,
      distDirectory = 'dist',
    ) {
      const root = await realpath(distDirectory);
      assert.equal(prepared.complete, true);
      assert.deepEqual(prepared.identities, identities);
      assert.ok(prepared.files.length > 0 && prepared.files.length <= 512);
      const preparedFiles = new Map(prepared.files.map((row) => [row.path, row]));
      assert.equal(preparedFiles.size, prepared.files.length, 'Duplicate prepared script');
      const rows: any[] = [],
        bindings: Record<string, string> = {};
      let bytes = 0;
      await mkdir(destination, { recursive: true });
      const destinationRoot = await realpath(destination);
      // Snapshot once. Eval and non-build URLs stay inventoried but cannot bind frames.
      const inventory = [...scripts];
      assert.equal(overflow, false, 'Script inventory overflow');
      await writeFile(destination + '/inventory.json', JSON.stringify(inventory));
      for (const script of inventory) {
        if (!script.url.startsWith(origin + '/')) continue;
        const url = new URL(script.url);
        assert.equal(url.origin, origin);
        const pathname = decodeURIComponent(url.pathname);
        assert.ok(pathname.endsWith('.js') && !/[\\\0]/.test(pathname));
        assert.ok(!pathname.split('/').includes('..'));
        const path = await realpath(resolve(root, '.' + pathname));
        const local = relative(root, path);
        assert.ok(!local.startsWith('..') && !local.startsWith(sep));
        const expected = preparedFiles.get(local);
        assert.ok(expected, 'Loaded script absent from source preparation');
        assert.equal((await stat(path)).size, expected.bytes, 'Prepared script size changed');
        bytes += expected.bytes + (expected.mapBytes ?? 0);
        assert.ok(bytes <= 64 * 1024 ** 2, 'Loaded code/maps exceed64MiB');
        const emitted = await readFile(path);
        assert.equal(emitted.length, expected.bytes);
        assert.equal(hash(emitted), expected.sha256, 'Emitted script changed after preparation');
        const { scriptSource } = await cdp.send('Debugger.getScriptSource', {
          scriptId: script.scriptId,
        });
        assert.equal(hash(scriptSource), expected.sha256, 'Loaded code differs from prepared code');
        await verifyPreparedMap(path + '.map', expected, root);
        const mapped = expected.mapped;
        for (const [key, value] of Object.entries(mapped)) {
          assert.equal(bindings[key], undefined, `Duplicate loaded native module ${key}`);
          bindings[key] = value;
        }
        await mkdir(dirname(destination + '/' + local), { recursive: true });
        await writeFile(destination + '/' + local, emitted);
        if (expected.mapStatus === 'present') {
          await copyFile(path + '.map', destination + '/' + local + '.map');
          await verifyPreparedMap(destination + '/' + local + '.map', expected, destinationRoot);
        }
        rows.push({
          ...script,
          path: local,
          bytes: emitted.length,
          sha256: hash(emitted),
          mapStatus: expected.mapStatus,
          mapBytes: expected.mapBytes,
          mapSha256: expected.mapSha256,
          mapped,
        });
      }
      assert.deepEqual(bindings, identities, 'Loaded prior native/Core sources not proven');
      const receipt = { complete: true, bytes, bindings, scripts: rows };
      await writeFile(destination + '/binding.json', JSON.stringify(receipt, null, 2));
      return receipt;
    },
    async dispose() {
      cdp.off('Debugger.scriptParsed', listener);
      await cdp.send('Debugger.disable');
    },
  };
}
