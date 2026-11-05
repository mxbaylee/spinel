import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
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
    async retain(destination: string, identities: Record<string, string>) {
      const root = await realpath('dist');
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
