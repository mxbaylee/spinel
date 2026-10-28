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
 * Modified for Spinel: backport owned cursor/zoom callback lifetimes to the
 * pinned open-source @univerjs/docs-ui 1.1.0 ES/CJS builds. No Pro code is read.
 * Source: packages/docs-ui/src/services/selection/text-range.ts and
 * controllers/render-controllers/zoom.render-controller.ts, dream-num/univer v1.1.0.
 * Prepared upstream repair: 1672ca2ad1debbcdb295e203308fae13bdb299b3.
 * Upstream: https://github.com/dream-num/univer/pull/7969
 * SPN-119 removes this temporary patch after a suitable upstream release.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const formats = {
  es: '82ff8f5bb6a16cb52a0d7b10de81cebf5a1e004bb4c7fd629ddfc993d55913cf',
  cjs: 'bc1e09498276d65c6d14240e6494a25a01d036cf3a0ab0a8aeeea6cc735b75bb',
} as const;

export function prepareDocsUiPatch(source: string, format: keyof typeof formats) {
  const core = format === 'cjs' ? '_univerjs_core.' : '';
  const replacements = [
    [
      '_defineProperty(this, "_anchorBlinkTimer", null);',
      `_defineProperty(this, "_anchorBlinkTimer", null);
\t\t// Modified for Spinel: own the initial and recurring cursor hide timeout.
\t\t_defineProperty(this, "_anchorBlinkTimeout", null);`,
    ],
    [
      `\t_anchorBlink() {
\t\tsetTimeout(() => {
\t\t\tif (this._anchorShape) {
\t\t\t\tif (this._anchorShape.visible) this.deactivateStatic();
\t\t\t}
\t\t}, BLINK_ON);
\t\tthis._anchorBlinkTimer = setInterval(() => {
\t\t\tif (this._anchorShape) {
\t\t\t\tif (this._anchorShape.visible) {
\t\t\t\t\tthis.activeStatic();
\t\t\t\t\tsetTimeout(() => {
\t\t\t\t\t\tthis.deactivateStatic();
\t\t\t\t\t}, BLINK_ON);
\t\t\t\t}
\t\t\t}
\t\t}, 1e3);
\t}`,
      `\t_anchorBlink() {
\t\tthis._anchorBlinkTimeout = setTimeout(() => {
\t\t\tthis._anchorBlinkTimeout = null;
\t\t\tif (this._anchorShape) {
\t\t\t\tif (this._anchorShape.visible) this.deactivateStatic();
\t\t\t}
\t\t}, BLINK_ON);
\t\tthis._anchorBlinkTimer = setInterval(() => {
\t\t\tif (this._anchorShape) {
\t\t\t\tif (this._anchorShape.visible) {
\t\t\t\t\tthis.activeStatic();
\t\t\t\t\tif (this._anchorBlinkTimer == null) return;
\t\t\t\t\tif (this._anchorBlinkTimeout != null) clearTimeout(this._anchorBlinkTimeout);
\t\t\t\t\tthis._anchorBlinkTimeout = setTimeout(() => {
\t\t\t\t\t\tthis._anchorBlinkTimeout = null;
\t\t\t\t\t\tthis.deactivateStatic();
\t\t\t\t\t}, BLINK_ON);
\t\t\t\t}
\t\t\t}
\t\t}, 1e3);
\t}`,
    ],
    [
      `if (this._anchorBlinkTimer) {
\t\t\tclearInterval(this._anchorBlinkTimer);
\t\t\tthis._anchorBlinkTimer = null;
\t\t}`,
      `if (this._anchorBlinkTimer != null) {
\t\t\tclearInterval(this._anchorBlinkTimer);
\t\t\tthis._anchorBlinkTimer = null;
\t\t}
\t\tif (this._anchorBlinkTimeout != null) {
\t\t\tclearTimeout(this._anchorBlinkTimeout);
\t\t\tthis._anchorBlinkTimeout = null;
\t\t}`,
    ],
    [
      `\t\tconst currentSheet = this._univerInstanceService.getCurrentUnitOfType(${core}UniverInstanceType.UNIVER_SHEET);
\t\tconst sheetRenderer = currentSheet && this._renderManagerService.getRenderUnitById(currentSheet.getUnitId());
\t\tthis._initTimer = window.setTimeout(() => {
\t\t\tconst zoomRatio = sheetRenderer && this._isSheetEditor ? sheetRenderer.scene.scaleX : getDocEffectiveZoomRatio(this._context.unit);`,
      `\t\t// Modified for Spinel: delayed zoom work belongs to this live renderer.
\t\tthis._initTimer = window.setTimeout(() => {
\t\t\tthis._initTimer = void 0;
\t\t\tif (this._disposed) return;
\t\t\tconst currentSheet = this._univerInstanceService.getCurrentUnitOfType(${core}UniverInstanceType.UNIVER_SHEET);
\t\t\tconst sheetRenderer = currentSheet && this._renderManagerService.getRenderUnitById(currentSheet.getUnitId());
\t\t\tconst zoomRatio = sheetRenderer && this._isSheetEditor ? sheetRenderer.scene.scaleX : getDocEffectiveZoomRatio(this._context.unit);`,
    ],
    [
      `\t\twindow.clearTimeout(this._initTimer);
\t\twindow.clearTimeout(this._updateTimer);
\t\tsuper.dispose();`,
      `\t\twindow.clearTimeout(this._initTimer);
\t\twindow.clearTimeout(this._updateTimer);
\t\tthis._initTimer = void 0;
\t\tthis._updateTimer = void 0;
\t\tsuper.dispose();`,
    ],
    [
      `\t_initSkeletonListener() {
\t\tthis.disposeWithMe(this._docSkeletonManagerService.currentSkeleton$.subscribe((param) => {
\t\t\tif (param == null) return;
\t\t\tconst documentModel = this._univerInstanceService.getCurrentUnitOfType(${core}UniverInstanceType.UNIVER_DOC);
\t\t\tif (!documentModel) return;
\t\t\tthis._updateTimer = window.setTimeout(() => {
\t\t\t\tconst currentSheet = this._univerInstanceService.getCurrentUnitOfType(${core}UniverInstanceType.UNIVER_SHEET);
\t\t\t\tconst sheetRenderer = currentSheet && this._renderManagerService.getRenderUnitById(currentSheet.getUnitId());
\t\t\t\tconst zoomRatio = !this._isSheetEditor ? getDocEffectiveZoomRatio(documentModel) : (sheetRenderer === null || sheetRenderer === void 0 ? void 0 : sheetRenderer.scene.scaleX) || 1;
\t\t\t\tthis.updateViewZoom(zoomRatio, false);
\t\t\t});
\t\t}));
\t}`,
      `\t_initSkeletonListener() {
\t\tthis.disposeWithMe(this._docSkeletonManagerService.currentSkeleton$.subscribe((param) => {
\t\t\twindow.clearTimeout(this._updateTimer);
\t\t\tthis._updateTimer = void 0;
\t\t\tif (param == null) return;
\t\t\tthis._updateTimer = window.setTimeout(() => {
\t\t\t\tthis._updateTimer = void 0;
\t\t\t\tif (this._disposed) return;
\t\t\t\tconst currentSheet = this._univerInstanceService.getCurrentUnitOfType(${core}UniverInstanceType.UNIVER_SHEET);
\t\t\t\tconst sheetRenderer = currentSheet && this._renderManagerService.getRenderUnitById(currentSheet.getUnitId());
\t\t\t\tconst zoomRatio = !this._isSheetEditor ? getDocEffectiveZoomRatio(this._context.unit) : (sheetRenderer === null || sheetRenderer === void 0 ? void 0 : sheetRenderer.scene.scaleX) || 1;
\t\t\t\tthis.updateViewZoom(zoomRatio, false);
\t\t\t});
\t\t}));
\t}`,
    ],
  ];
  // Recover only our exact substitutions, then verify the complete upstream file.
  // This also supplies a hash-verified negative control to the executable tests.
  const original = replacements.reduce(
    (text, [before, after]) => text.replace(after, before),
    source,
  );
  if (createHash('sha256').update(original).digest('hex') !== formats[format])
    throw new Error(
      `Unrecognized @univerjs/docs-ui ${format} build; review the callback lifetime patch.`,
    );
  const patched = replacements.reduce((text, [before, after]) => {
    if (text.split(before).length !== 2)
      throw new Error('Docs UI callback patch target must occur exactly once.');
    return text.replace(before, after);
  }, original);
  if (source !== original && source !== patched)
    throw new Error(
      `Partially modified @univerjs/docs-ui ${format} build; restore the pinned package first.`,
    );
  return { original, patched };
}

export async function patchInstalledDocsUi(root: string) {
  const directory = resolve(root, 'node_modules/@univerjs/docs-ui');
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.name !== '@univerjs/docs-ui' || metadata.version !== '1.1.0')
    throw new Error('Upgrading @univerjs/docs-ui: review callback lifetimes and SPN-119 first.');
  // Validate both builds before writing either; an unknown companion build fails closed.
  const updates = await Promise.all(
    (Object.keys(formats) as (keyof typeof formats)[]).map(async (format) => {
      const path = resolve(directory, 'lib', format, 'index.js');
      const source = await readFile(path, 'utf8');
      return { path, source, patched: prepareDocsUiPatch(source, format).patched };
    }),
  );
  for (const { path, source, patched } of updates)
    if (source !== patched) await writeFile(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await patchInstalledDocsUi(resolve(import.meta.dirname, '../..'));
