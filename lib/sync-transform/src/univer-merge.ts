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
 * Modified for Spinel: how open-source @univerjs/sheets 1.1.0 writes one cell,
 * for a cell held as data rather than in a worksheet. Styles stay inline, as a
 * MoveRange carries them, instead of going through the workbook's style
 * table; style values are not sanitized (Univer's commands send well-formed
 * ones); the numfmt handlers act on one cell. No @univerjs-pro package is
 * read or used. Source, tag v1.1.0:
 * packages/sheets/src/commands/mutations/set-range-values.mutation.ts
 * (SetRangeValuesMutation's handler, mergeCellData, overrideStyle,
 * updateCellProperty), packages/sheets/src/basics/cell-style.ts (handleStyle,
 * mergeStyle, mergeBorderData, mergeRichTextStyle, skipParagraphs,
 * shouldSkipRichTextStyleKey) and packages/sheets/src/services/numfmt/numfmt.service.ts
 * (setValues, deleteValues).
 */
import { BORDER_KEYS, isFormulaId, normalizeTextRuns, STYLE_KEYS, Tools } from '@univerjs/core';
import { getCellType, getCellValue } from '@univerjs/sheets';

type CellData = Record<string, any>;

/** The workbook style table, for inline styles: a cell's `s` is its style. */
const styles: any = {
  get: (id: unknown) => id,
  getStyleByCell: (cell: CellData | null | undefined) =>
    cell && Tools.isObject(cell.s) ? cell.s : undefined,
  setValue: (style: unknown) => (style == null ? undefined : style),
};

/** A cell after a SetRangeValues writes `newVal` to it; null is an empty cell. */
export function setCell(
  cell: CellData | null,
  newVal: CellData | null,
  isOverrideStyle: boolean,
): CellData | null {
  if (!newVal) return null;
  const merged = mergeCellData(
    Tools.deepClone(newVal),
    Tools.deepClone(cell ?? {}),
    !!isOverrideStyle,
  );
  return Tools.isEmptyObject(merged) ? null : merged;
}

/** A cell after SetNumfmt gives it `pattern`. */
export function setNumfmt(cell: CellData | null, pattern: string): CellData {
  if (!cell) return { s: { n: { pattern } } };
  return { ...cell, s: { ...styles.getStyleByCell(cell), n: { pattern } } };
}

/** A cell after RemoveNumfmt. */
export function removeNumfmt(cell: CellData | null): CellData | null {
  if (!cell) return cell;
  const newStyle = { ...(cell.s && styles.get(cell.s)) };
  delete newStyle.n;
  return { ...cell, s: styles.setValue(newStyle) };
}

const overwriteCellPropertiesSet = new Set(['f', 'p', 'si', 'custom', 'ref', 'xf', 'ft', 'fd']);

function mergeCellData(newValue: CellData, oldValue: CellData, isOverrideStyle = false) {
  const type = getCellType(styles, newValue, oldValue);
  Object.keys(newValue).forEach((key) => {
    if (overwriteCellPropertiesSet.has(key)) updateCellProperty(oldValue, key, newValue[key]);
    else if (key === 'v') {
      if (newValue.v !== undefined) oldValue.v = getCellValue(type, newValue);
    } else if (key === 's') {
      if (isOverrideStyle) overrideStyle(oldValue, newValue);
      else handleStyle(oldValue, newValue);
    }
  });
  if ((newValue.f === null || newValue.f === '') && !isFormulaId(newValue.si)) {
    delete oldValue.ft;
    delete oldValue.fd;
  }
  if (oldValue.v !== undefined) {
    oldValue.t = type;
    oldValue.v = getCellValue(type, oldValue);
  }
  if (oldValue.v === null) {
    delete oldValue.t;
    delete oldValue.v;
  }
  return oldValue;
}

function overrideStyle(oldValue: CellData, newValue: CellData) {
  if (newValue.s === undefined) return;
  if (newValue.s === null) {
    delete oldValue.s;
    return;
  }
  const styleValue = typeof newValue.s === 'string' ? styles.get(newValue.s) : newValue.s;
  const styleCell: CellData = {};
  handleStyle(styleCell, { s: styleValue });
  if (styleCell.s == null) delete oldValue.s;
  else oldValue.s = styleCell.s;
}

function updateCellProperty(cell: CellData, key: string, value: unknown) {
  if (value === undefined) return;
  if (value === null) delete cell[key];
  else cell[key] = Tools.deepClone(value);
}

function handleStyle(oldVal: CellData, newVal: CellData) {
  const oldStyle = styles.getStyleByCell(oldVal);
  if (oldStyle == null) delete oldVal.s;
  if (typeof newVal.s === 'string') newVal.s = styles.get(newVal.s);
  const merge = mergeStyle(oldStyle, newVal.s ? newVal.s : null);
  if (merge) {
    Tools.removeNull(merge);
    Object.entries(merge).forEach(([key, val]) => {
      if (typeof val === 'object' && val !== null && Object.keys(val).length === 0) {
        delete merge[key];
      }
    });
  }
  if (Tools.isEmptyObject(merge)) delete oldVal.s;
  else oldVal.s = styles.setValue(merge);
  const newValueStream = newVal.v ? `${newVal.v}\r\n` : '';
  if (!newVal.p && oldVal.p) {
    if (newValueStream && newValueStream !== oldVal.p.body?.dataStream) delete oldVal.p;
    else mergeRichTextStyle(oldVal.p, newVal.s ? newVal.s : null);
  }
}

function mergeStyle(
  oldStyle: CellData | undefined,
  newStyle: CellData | null | undefined,
  isRichText = false,
) {
  if (newStyle === null) return newStyle;
  if (newStyle === undefined) return oldStyle;
  const backupStyle: CellData = Tools.deepClone(oldStyle) || {};
  for (const key of STYLE_KEYS as readonly string[]) {
    if (!Object.prototype.hasOwnProperty.call(newStyle, key)) continue;
    if (isRichText && shouldSkipRichTextStyleKey(key)) continue;
    const value = newStyle[key];
    if (value === undefined) continue;
    if (key === 'bd') backupStyle[key] = mergeBorderData(backupStyle[key], value);
    else backupStyle[key] = value;
  }
  if ('cl' in backupStyle) {
    const color = backupStyle.cl;
    if ('ul' in backupStyle && backupStyle.ul) backupStyle.ul.cl = color;
    if ('ol' in backupStyle && backupStyle.ol) backupStyle.ol.cl = color;
    if ('st' in backupStyle && backupStyle.st) backupStyle.st.cl = color;
  }
  return backupStyle;
}

function mergeBorderData(currentBorders: unknown, incomingBorders: CellData | null) {
  if (incomingBorders === null) return null;
  if (incomingBorders === undefined) return currentBorders;
  const mergedBorders: CellData = Tools.isObject(currentBorders)
    ? { ...(currentBorders as CellData) }
    : {};
  for (const key of BORDER_KEYS as readonly string[]) {
    if (!Object.prototype.hasOwnProperty.call(incomingBorders, key)) continue;
    if (incomingBorders[key] !== undefined) mergedBorders[key] = incomingBorders[key];
  }
  return mergedBorders;
}

function shouldSkipRichTextStyleKey(key: string) {
  return ['bd', 'tr', 'td', 'ht', 'vt', 'tb', 'pd', 'bg'].includes(key);
}

function skipParagraphs(paragraphs: { startIndex: number }[], offset: number): number {
  if (paragraphs.some((p) => p.startIndex === offset))
    return skipParagraphs(paragraphs, offset + 1);
  return offset;
}

function mergeRichTextStyle(p: CellData, newStyle: CellData | null) {
  if (p.body == null) return;
  if (!Array.isArray(p.body.textRuns)) p.body.textRuns = [];
  let index = 0;
  const newTextRuns: CellData[] = [];
  const paragraphs = p.body?.paragraphs || [];
  for (const textRun of p.body.textRuns) {
    const { st, ed, ts = {} } = textRun;
    if (index < st) {
      const tr: CellData = { st: index, ed: st };
      const merge = mergeStyle({}, newStyle, true);
      if (merge) Tools.removeNull(merge);
      if (!Tools.isEmptyObject(merge)) tr.ts = merge;
      newTextRuns.push(tr);
    }
    const merge = mergeStyle(ts, newStyle, true);
    if (merge) Tools.removeNull(merge);
    if (Tools.isEmptyObject(merge)) delete textRun.ts;
    else textRun.ts = merge;
    newTextRuns.push(textRun);
    index = skipParagraphs(paragraphs, ed);
  }
  const endIndex = p.body.dataStream.endsWith('\r\n')
    ? p.body.dataStream.length - 2
    : p.body.dataStream.length;
  if (index < endIndex) {
    const tr: CellData = { st: index, ed: endIndex };
    const merge = mergeStyle({}, newStyle, true);
    if (merge) Tools.removeNull(merge);
    if (!Tools.isEmptyObject(merge)) tr.ts = merge;
    newTextRuns.push(tr);
  }
  p.body.textRuns = normalizeTextRuns(newTextRuns as any);
}
