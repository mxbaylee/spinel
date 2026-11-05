import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
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
  mapBytes: Buffer,
  identities: Record<string, string>,
) {
  assert.equal(hash(executed), hash(emitted), 'Loaded code differs from emitted code');
  return validateNativeMap(JSON.parse(mapBytes.toString()), identities);
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
    const map = await member(row.path + '.map', row.mapBytes, row.mapSha256);
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
    async retain(destination: string, identities: Record<string, string>, distDirectory = 'dist') {
      const root = await realpath(distDirectory);
      const rows: any[] = [],
        bindings: Record<string, string> = {};
      let bytes = 0;
      await mkdir(destination, { recursive: true });
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
        const emitted = await readFile(path),
          mapBytes = await readFile(path + '.map');
        bytes += emitted.length + mapBytes.length;
        assert.ok(bytes <= 64 * 1024 ** 2, 'Loaded code/maps exceed64MiB');
        const { scriptSource } = await cdp.send('Debugger.getScriptSource', {
          scriptId: script.scriptId,
        });
        const mapped = validateLoadedNativeScript(scriptSource, emitted, mapBytes, identities);
        for (const [key, value] of Object.entries(mapped)) {
          assert.equal(bindings[key], undefined, `Duplicate loaded native module ${key}`);
          bindings[key] = value;
        }
        await mkdir(dirname(destination + '/' + local), { recursive: true });
        await writeFile(destination + '/' + local, emitted);
        await writeFile(destination + '/' + local + '.map', mapBytes);
        rows.push({
          ...script,
          path: local,
          bytes: emitted.length,
          sha256: hash(emitted),
          mapBytes: mapBytes.length,
          mapSha256: hash(mapBytes),
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
