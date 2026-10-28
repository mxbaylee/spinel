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
 * Modified for Spinel: execute the pinned OSS cursor/zoom bundle classes with
 * controlled graphics and native test timers. Verified upstream bytes remain
 * negative controls. No Pro package is read or modified.
 * Source: packages/docs-ui/src/services/selection/text-range.ts and
 * controllers/render-controllers/zoom.render-controller.ts, Univer v1.1.0.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as core from '@univerjs/core';
import { Subject } from 'rxjs';
import { patchInstalledDocsUi, prepareDocsUiPatch } from './patch-univer-docs-ui.ts';

type Format = 'es' | 'cjs';
const readBuild = (format: Format) =>
  readFile(
    new URL(`../../node_modules/@univerjs/docs-ui/lib/${format}/index.js`, import.meta.url),
    'utf8',
  );

function region(source: string, path: string) {
  const marker = `//#region ${path}\n`;
  const start = source.indexOf(marker);
  const end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start, `${path}: actual bundle region exists`);
  return source.slice(start + marker.length, end);
}

function timers(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const callbacks: (() => void)[] = [];
  return {
    callbacks,
    count: () => timeouts.size + intervals.size,
    tick: (milliseconds: number) => t.mock.timers.tick(milliseconds),
    setTimeout(callback: () => void, delay = 0) {
      callbacks.push(callback);
      const handle = setTimeout(() => {
        timeouts.delete(handle);
        callback();
      }, delay);
      timeouts.add(handle);
      return handle;
    },
    clearTimeout(handle: ReturnType<typeof setTimeout>) {
      timeouts.delete(handle);
      clearTimeout(handle);
    },
    setInterval(callback: () => void, delay: number) {
      callbacks.push(callback);
      const handle = setInterval(callback, delay);
      intervals.add(handle);
      return handle;
    },
    clearInterval(handle: ReturnType<typeof setInterval>) {
      intervals.delete(handle);
      clearInterval(handle);
    },
  };
}
type Timers = ReturnType<typeof timers>;
const defineProperty = (object: Record<string, unknown>, key: string, value: unknown) => {
  object[key] = value;
  return object;
};

function cursorFactory(source: string, clock: Timers) {
  const graphics = {
    NORMAL_TEXT_SELECTION_PLUGIN_STYLE: { stroke: '#112233' },
    getColor: () => 'transparent',
  };
  const Cursor = runInNewContext(
    `${region(source, 'src/services/selection/text-range.ts')}\nTextRange;`,
    {
      ...core,
      ...graphics,
      ...clock,
      _univerjs_core: core,
      _univerjs_engine_render: graphics,
      _defineProperty: defineProperty,
    },
    { filename: 'docs-ui.installed-cursor.js', timeout: 1000 },
  );
  // Geometry is unrelated to callback ownership; keep the actual constructor,
  // blink methods and disposal while providing an observable rendered anchor.
  Cursor.prototype.refresh = function (this: { _anchorShape: ReturnType<typeof anchor> }) {
    this._anchorShape = anchor();
  };
  function anchor() {
    return {
      visible: true,
      stroke: 'gray.1000',
      disposed: false,
      writes: 0,
      setProps(properties: { stroke: string }) {
        assert.equal(this.disposed, false, 'a dead cursor must never be painted');
        this.stroke = properties.stroke;
        this.writes++;
      },
      dispose() {
        this.disposed = true;
      },
      hide() {
        this.visible = false;
      },
      show() {
        this.visible = true;
      },
    };
  }
  return () =>
    new Cursor() as {
      getAnchor(): ReturnType<typeof anchor>;
      dispose(): void;
      activeStatic(): void;
    };
}

function zoomFactory(source: string, clock: Timers, sheet = false) {
  const zoomSource = region(source, 'src/controllers/render-controllers/zoom.render-controller.ts');
  const zoomValueSource = region(source, 'src/services/doc-zoom.ts');
  const contextCore = { ...core, Inject: () => () => {}, Optional: () => () => {} };
  const scene = {
    scaleX: 1,
    scaleY: 1,
    updates: [] as number[],
    scale(x: number, y: number) {
      this.scaleX = x;
      this.scaleY = y;
      this.updates.push(x);
    },
    getTransformer: () => ({ clearSelectedObjects() {} }),
    onMouseWheel$: { subscribeEvent: () => ({ dispose() {} }) },
  };
  const passthrough = (source: unknown) => source;
  const dependencies = {
    DocSkeletonManagerService: {},
    DocSelectionManagerService: {},
    DocPageLayoutService: {},
    DocViewScaleService: {},
    IEditorService: {},
    IRenderManagerService: {},
    IDocEmbedInteractionBoundaryService: {},
    SetDocZoomRatioOperation: { id: 'doc.operation.set-zoom-ratio' },
    SetDocZoomRatioCommand: { id: 'doc.command.set-zoom-ratio' },
    SwitchDocModeCommand: { id: 'doc.command.switch-mode' },
    DocPageSetupCommand: { id: 'doc.command.page-setup' },
    neoGetDocObject: () => ({ scene }),
  };
  // Resize throttling is unchanged by the patch and covered by upstream tests.
  // Deliver fixture resize notifications synchronously to exercise the listener.
  const reactive = { throttleTime: () => passthrough, animationFrameScheduler: {} };
  const Zoom = runInNewContext(
    `${zoomValueSource}\n${zoomSource}\nDocZoomRenderController;`,
    {
      ...contextCore,
      ...dependencies,
      ...reactive,
      window: clock,
      _univerjs_core: contextCore,
      _univerjs_docs: dependencies,
      _univerjs_engine_render: dependencies,
      rxjs: reactive,
      _defineProperty: defineProperty,
      __decorate: (_decorators: unknown, constructor: unknown) => constructor,
      __decorateParam: () => () => {},
    },
    { filename: 'docs-ui.installed-zoom.js', timeout: 1000 },
  );
  const state = {
    zoom: 1,
    currentZoom: 3,
    sheetId: 'sheet-a',
    fit: false,
    width: 800,
    selectionRefreshes: 0,
  };
  const unitId = sheet ? core.DOCS_NORMAL_EDITOR_UNIT_ID_KEY : 'doc';
  const model = {
    getSettings: () => ({ zoomRatio: state.zoom }),
    getSnapshot: () => ({ documentStyle: {} }),
  };
  const skeletons = new Subject<object | null>();
  const transforms = new core.EventSubject();
  const commands = new Set<(command: { id: string; params: { unitId: string } }) => void>();
  const controller = new Zoom(
    { unitId, unit: model, scene, engine: { onTransformChange$: transforms } },
    { getContextValue: () => false },
    { currentSkeleton$: skeletons },
    {
      getCurrentUnitOfType: (type: core.UniverInstanceType) =>
        type === core.UniverInstanceType.UNIVER_SHEET
          ? { getUnitId: () => state.sheetId }
          : { getSettings: () => ({ zoomRatio: state.currentZoom }) },
      getUnitCreateOptions: () => undefined,
    },
    {
      onCommandExecuted: (
        callback: (command: { id: string; params: { unitId: string } }) => void,
      ) => {
        commands.add(callback);
        return { dispose: () => commands.delete(callback) };
      },
      beforeCommandExecuted: () => ({ dispose() {} }),
    },
    { refreshSelection: () => state.selectionRefreshes++ },
    { isEditor: () => sheet },
    { calculatePagePosition() {} },
    { getRenderUnitById: (id: string) => ({ scene: { scaleX: id === 'sheet-a' ? 1.25 : 1.75 } }) },
    {
      getOptions: () => ({ mode: state.fit ? 'fit-width' : 'none' }),
      getAvailableWidth: () => state.width,
      getViewScale: (zoom: number) => (state.fit ? zoom * 0.8 : zoom),
    },
  ) as { dispose(): void };
  return { controller, state, scene, skeletons, transforms, commands };
}

for (const format of ['es', 'cjs'] as const) {
  test(`${format}: callback repair is idempotent and rejects altered or partial builds`, async () => {
    const installed = await readBuild(format);
    const { original, patched } = prepareDocsUiPatch(installed, format);
    assert.equal(prepareDocsUiPatch(patched, format).patched, patched);
    assert.equal(prepareDocsUiPatch(original, format).patched, patched);
    for (const source of [original, patched])
      assert.throws(
        () => prepareDocsUiPatch(source + '\n// unknown bytes', format),
        /Unrecognized/,
      );
    const partial = patched.replace(
      'if (this._anchorBlinkTimer != null)',
      'if (this._anchorBlinkTimer)',
    );
    assert.throws(() => prepareDocsUiPatch(partial, format), /Unrecognized|Partially modified/);
  });

  test(`${format}: cursor timers remain bounded through initial and recurring replacements`, async (t) => {
    const clock = timers(t);
    const create = cursorFactory(
      prepareDocsUiPatch(await readBuild(format), format).patched,
      clock,
    );
    for (const delay of [0, 1000]) {
      for (const count of [10, 100, 4000]) {
        let cursor = create();
        for (let index = 0; index < count; index++) {
          clock.tick(delay);
          cursor.dispose();
          cursor = create();
        }
        assert.equal(
          clock.count(),
          2,
          `${count} replacements during ${delay ? 'recurring' : 'initial'} hide`,
        );
        cursor.dispose();
        assert.equal(clock.count(), 0);
      }
    }
    const cursor = create();
    const graphic = cursor.getAnchor();
    clock.tick(499);
    assert.equal(graphic.stroke, 'gray.1000');
    clock.tick(1);
    assert.equal(graphic.stroke, '#112233');
    clock.tick(500);
    assert.equal(graphic.stroke, 'gray.1000');
    clock.tick(500);
    assert.equal(graphic.stroke, '#112233');
    cursor.activeStatic = () => cursor.dispose();
    clock.tick(500);
    assert.equal(clock.count(), 0, 'reentrant disposal cannot reintroduce a hide callback');
    const writes = graphic.writes;
    clock.callbacks.slice(-3).forEach((callback) => callback());
    assert.equal(graphic.writes, writes);
    assert.equal(clock.count(), 0);
  });

  test(`${format}: original cursor retains the superseded initial and recurring hides`, async (t) => {
    const clock = timers(t);
    const create = cursorFactory(
      prepareDocsUiPatch(await readBuild(format), format).original,
      clock,
    );
    const first = create();
    first.dispose();
    assert.equal(clock.count(), 1, 'unchanged upstream loses its first timeout handle');
    clock.tick(500);
    const second = create();
    clock.tick(1000);
    second.dispose();
    assert.equal(clock.count(), 1, 'unchanged upstream also loses its recurring hide handle');
    clock.tick(500);
  });

  test(`${format}: zoom coalesces updates, keeps owned state, and preserves commands and resize`, async (t) => {
    const clock = timers(t);
    const fixture = zoomFactory(prepareDocsUiPatch(await readBuild(format), format).patched, clock);
    const { controller, state, scene, skeletons, transforms, commands } = fixture;
    clock.tick(20);
    scene.updates.length = 0;
    for (const count of [10, 100, 4000]) {
      for (let index = 0; index < count; index++) skeletons.next({});
      assert.equal(clock.count(), 1);
      state.zoom = 1.6;
      state.currentZoom = 4;
      clock.tick(0);
      assert.equal(scene.scaleX, 1.6, 'a different active document cannot change this renderer');
      assert.equal(clock.count(), 0);
    }
    assert.equal(scene.updates.length, 3);
    skeletons.next({});
    state.zoom = 1.8;
    commands.forEach((callback) =>
      callback({ id: 'doc.operation.set-zoom-ratio', params: { unitId: 'doc' } }),
    );
    clock.tick(0);
    assert.equal(scene.scaleX, 1.8);
    skeletons.next({});
    state.fit = true;
    state.width = 1200;
    transforms.emitEvent({});
    assert.equal(scene.scaleX, 1.8 * 0.8, 'fit-to-width resize retains composed scale');
    clock.tick(0);
    assert.equal(scene.scaleX, 1.8 * 0.8);
    skeletons.next({});
    skeletons.next(null);
    assert.equal(clock.count(), 0);
    skeletons.next({});
    const retained = clock.callbacks.slice();
    controller.dispose();
    const updates = scene.updates.length;
    assert.equal(clock.count(), 0);
    assert.equal(commands.size, 0);
    assert.equal(skeletons.observed, false);
    retained.forEach((callback) => callback());
    transforms.emitEvent({});
    assert.equal(scene.updates.length, updates);
  });

  test(`${format}: initialization uses the current Sheet and disposal cancels both zoom timers`, async (t) => {
    const clock = timers(t);
    const patched = prepareDocsUiPatch(await readBuild(format), format).patched;
    const first = zoomFactory(patched, clock, true);
    first.state.sheetId = 'sheet-b';
    clock.tick(20);
    assert.equal(first.scene.scaleX, 1.75);
    first.controller.dispose();
    const second = zoomFactory(patched, clock);
    second.skeletons.next({});
    assert.equal(clock.count(), 2);
    second.controller.dispose();
    assert.equal(clock.count(), 0);
    clock.callbacks.forEach((callback) => callback());
    assert.equal(second.scene.updates.length, 0);
  });

  test(`${format}: original zoom retains obsolete work and reads the globally current Doc`, async (t) => {
    const clock = timers(t);
    const { controller, scene, skeletons } = zoomFactory(
      prepareDocsUiPatch(await readBuild(format), format).original,
      clock,
    );
    clock.tick(20);
    for (let index = 0; index < 10; index++) skeletons.next({});
    assert.equal(clock.count(), 10);
    clock.tick(0);
    assert.equal(scene.scaleX, 3);
    for (let index = 0; index < 10; index++) skeletons.next({});
    controller.dispose();
    assert.equal(clock.count(), 9);
  });
}

test('Docs UI installer validates name, version and both complete builds before any writes', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'spinel-docs-ui-patch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'node_modules/@univerjs/docs-ui');
  const metadata = resolve(directory, 'package.json');
  const originals = {
    es: prepareDocsUiPatch(await readBuild('es'), 'es').original,
    cjs: prepareDocsUiPatch(await readBuild('cjs'), 'cjs').original,
  };
  for (const format of ['es', 'cjs'] as const) {
    await mkdir(resolve(directory, 'lib', format), { recursive: true });
    await writeFile(resolve(directory, 'lib', format, 'index.js'), originals[format]);
  }
  for (const data of [
    { name: '@univerjs/docs-ui', version: '1.2.0' },
    { name: 'other', version: '1.1.0' },
  ]) {
    await writeFile(metadata, JSON.stringify(data));
    await assert.rejects(patchInstalledDocsUi(root), /Upgrading @univerjs\/docs-ui/);
    assert.equal(await readFile(resolve(directory, 'lib/es/index.js'), 'utf8'), originals.es);
    assert.equal(await readFile(resolve(directory, 'lib/cjs/index.js'), 'utf8'), originals.cjs);
  }
  await writeFile(metadata, JSON.stringify({ name: '@univerjs/docs-ui', version: '1.1.0' }));
  const cjs = resolve(directory, 'lib/cjs/index.js');
  await writeFile(cjs, originals.cjs + '\n// unexpected change');
  await assert.rejects(patchInstalledDocsUi(root), /Unrecognized/);
  assert.equal(await readFile(resolve(directory, 'lib/es/index.js'), 'utf8'), originals.es);
  assert.equal(await readFile(cjs, 'utf8'), originals.cjs + '\n// unexpected change');
  await writeFile(cjs, originals.cjs);
  await patchInstalledDocsUi(root);
  await patchInstalledDocsUi(root);
  for (const format of ['es', 'cjs'] as const)
    assert.equal(
      await readFile(resolve(directory, 'lib', format, 'index.js'), 'utf8'),
      prepareDocsUiPatch(originals[format], format).patched,
    );
});
