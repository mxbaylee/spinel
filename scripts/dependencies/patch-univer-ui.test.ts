/**
 * Copyright 2023-present DreamNum Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for Spinel: execute the installed open-source virtual-list hook with
 * controlled React hooks and ResizeObserver delivery; retain its original
 * measurement below as a negative control. No @univerjs-pro package is read.
 * Source: packages/ui/src/views/hooks/virtual-list.ts, tag v1.1.0:
 * https://github.com/dream-num/univer/blob/v1.1.0/packages/ui/src/views/hooks/virtual-list.ts
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { patchInstalledUi, patchUi } from './patch-univer-ui.ts';

const readBuild = (format: 'es' | 'cjs') =>
  readFile(
    new URL(`../../node_modules/@univerjs/ui/lib/${format}/index.js`, import.meta.url),
    'utf8',
  );

function originalMeasurement(source: string): string {
  // Restore only getSize's original reads. patchUi validates the recovered
  // whole-file hash before the negative control can stand in for upstream.
  return source.replace(
    /const getSize = \(\) => \{[\s\S]*?(?=\n\t{4}if \(width !==)/,
    `const getSize = () => {
\t\t\t\tconst width = containerTarget.current.clientWidth;
\t\t\t\tconst height = containerTarget.current.clientHeight;`,
  );
}

function mountVirtualList(source: string, format: string) {
  const marker = '//#region src/views/hooks/virtual-list.ts\n';
  const start = source.indexOf(marker);
  const end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start, `${format}: virtual-list hook region exists`);
  const hookSource = source.slice(start + marker.length, end);
  const effects: (() => void | (() => void))[] = [];
  const updates: unknown[][] = [];
  const observers: FakeResizeObserver[] = [];
  let stateIndex = 0;
  const react = {
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => {
      const index = stateIndex++;
      updates[index] = [];
      return [value, (next: unknown) => updates[index].push(next)];
    },
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => void | (() => void)) => effects.push(fn),
  };
  class FakeResizeObserver {
    callback: () => void;
    target?: unknown;
    disconnected = false;
    constructor(callback: () => void) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target: unknown) {
      this.target = target;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const useVirtualList = runInNewContext(
    `${hookSource}\nuseVirtualList;`,
    { ...react, react, useEvent: (fn: unknown) => fn, ResizeObserver: FakeResizeObserver },
    { filename: `${format}/virtual-list.installed.js`, timeout: 1000 },
  );
  const element = { clientWidth: 640, clientHeight: 320, scrollTop: 0 };
  const ref: { current: typeof element | null } = { current: element };
  useVirtualList(['a', 'b', 'c'], { containerTarget: ref, itemHeight: 24 });
  const cleanups = effects.map((effect) => effect());
  assert.equal(observers.length, 1, `${format}: one resize observer is registered`);
  const observer = observers[0];
  assert.equal(observer.target, element);
  const sizes = updates[0] as { width: number; height: number }[];
  assert.equal(sizes.length, 1);
  assert.equal(sizes[0].width, 640);
  assert.equal(sizes[0].height, 320);
  element.clientWidth = 960;
  element.clientHeight = 480;
  observer.callback();
  assert.equal(sizes.length, 2, `${format}: attached resize updates state`);
  assert.equal(sizes[1].width, 960);
  assert.equal(sizes[1].height, 480);
  const cleanup = () => {
    cleanups.forEach((dispose) => dispose?.());
    assert.equal(observer.disconnected, true, `${format}: cleanup disconnects the observer`);
  };
  return { observer, ref, sizes, cleanup };
}

for (const format of ['es', 'cjs'] as const) {
  test(`${format}: virtual-list resize ignores a cleared ref and still disconnects`, async () => {
    const { observer, ref, sizes, cleanup } = mountVirtualList(await readBuild(format), format);
    // React clears the ref during commit, before passive effect cleanup. Deliver
    // the already queued callback in that interval, while the observer is active.
    ref.current = null;
    assert.equal(observer.disconnected, false);
    assert.doesNotThrow(() => observer.callback());
    assert.equal(sizes.length, 2, 'a detached callback must not record a measurement');
    cleanup();
  });

  test(`${format}: the original virtual-list callback reproduces the null clientWidth error`, async () => {
    const installed = await readBuild(format);
    const original = originalMeasurement(installed);
    assert.equal(patchUi(original, format), installed, 'negative control is the pinned upstream');
    const { observer, ref, cleanup } = mountVirtualList(original, format);
    ref.current = null;
    assert.throws(() => observer.callback(), /Cannot read properties of null.*clientWidth/);
    cleanup();
  });

  test(`${format}: the UI patch is idempotent and rejects changed upstream bytes`, async () => {
    const installed = await readBuild(format);
    const original = originalMeasurement(installed);
    const patched = patchUi(original, format);
    assert.equal(patched, installed);
    assert.equal(patchUi(patched, format), patched);
    for (const source of [original, patched])
      assert.throws(() => patchUi(source + '\n// unexpected change', format), /Unrecognized/);
  });
}

test('UI installation validates its version and both formats before changing either', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'spinel-ui-patch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'node_modules/@univerjs/ui');
  const metadata = resolve(directory, 'package.json');
  const originals = {
    es: originalMeasurement(await readBuild('es')),
    cjs: originalMeasurement(await readBuild('cjs')),
  };
  for (const format of ['es', 'cjs'] as const) {
    await mkdir(resolve(directory, 'lib', format), { recursive: true });
    await writeFile(resolve(directory, 'lib', format, 'index.js'), originals[format]);
  }
  await writeFile(metadata, JSON.stringify({ version: '1.1.1' }));
  await assert.rejects(patchInstalledUi(root), /Upgrading @univerjs\/ui/);
  for (const format of ['es', 'cjs'] as const)
    assert.equal(
      await readFile(resolve(directory, 'lib', format, 'index.js'), 'utf8'),
      originals[format],
    );

  await writeFile(metadata, JSON.stringify({ version: '1.1.0' }));
  const cjs = resolve(directory, 'lib/cjs/index.js');
  await writeFile(cjs, originals.cjs + '\n// unexpected change');
  await assert.rejects(patchInstalledUi(root), /Unrecognized @univerjs\/ui cjs/);
  assert.equal(await readFile(resolve(directory, 'lib/es/index.js'), 'utf8'), originals.es);
  assert.equal(await readFile(cjs, 'utf8'), originals.cjs + '\n// unexpected change');

  await writeFile(cjs, originals.cjs);
  await patchInstalledUi(root);
  await patchInstalledUi(root);
  for (const format of ['es', 'cjs'] as const)
    assert.equal(
      await readFile(resolve(directory, 'lib', format, 'index.js'), 'utf8'),
      patchUi(originals[format], format),
    );
});
