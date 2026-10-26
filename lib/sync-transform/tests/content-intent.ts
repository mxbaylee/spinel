import { IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import type { DocumentDataModel, ICellData } from '@univerjs/core';
import { expect } from 'vitest';
import { normalizedCell } from '../src/native-values.ts';
import type { Replica } from './harness.ts';

/** Single UTF-16 characters make deletion boundaries unambiguous to the oracle. */
const markerPattern = /[\uE000-\uF8FF]/g;
let marker = 0;

export function textMarker(): string {
  if (marker >= 6400) throw new Error('The Doc intent character namespace is exhausted');
  return String.fromCharCode(0xe000 + marker++);
}

/** Reset only between independent seeds; reserve their initial characters. */
export const resetTextMarkers = (reserved = 0) => {
  marker = reserved;
};

export function docText(replica: Replica): string {
  return (
    replica.injector
      .get(IUniverInstanceService)
      .getCurrentUnitOfType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC)
      ?.getBody()?.dataStream ?? ''
  );
}

function markers(replica: Replica): Set<string> {
  const values = docText(replica).match(markerPattern) ?? [];
  const unique = new Set(values);
  if (unique.size !== values.length) {
    expect(unique.size, 'a Doc character identity was duplicated').toBe(values.length);
  }
  return unique;
}

export function contentState(replica: Replica) {
  return {
    text: markers(replica),
    sheets: new Set(replica.workbook()?.getSheetOrders() ?? []),
  };
}

type ContentState = ReturnType<typeof contentState>;
type Difference = { inserted: string[]; removed: string[] };
type Effect = {
  text: Difference;
  order: string[];
  sheets: Difference;
  insertedSheets: Map<string, unknown>;
};
const difference = (before: Set<string>, after: Set<string>): Difference => ({
  inserted: [...after].filter((id) => !before.has(id)),
  removed: [...before].filter((id) => !after.has(id)),
});

/** Cheap exact comparisons on the hot path; retain a rich diff for a mismatch. */
function equalIds(actual: Set<string>, expected: Set<string>, where: string) {
  if (actual.size !== expected.size || [...expected].some((id) => !actual.has(id))) {
    expect(actual, where).toEqual(expected);
  }
}
function equalOrder(actual: string[], expected: string[], where: string) {
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    expect(actual, where).toEqual(expected);
  }
}

/** Snapshot the original inserted content, resolving only native style slots. */
function sheetContent(replica: Replica, id: string) {
  const workbook = replica.workbook()!;
  const sheet = workbook.getSheetBySheetId(id);
  if (!sheet) throw new Error(`Inserted worksheet ${id} is missing`);
  const { cellData, rowData, columnData, defaultStyle, ...data } = structuredClone(
    sheet.getSnapshot(),
  );
  const resolve = (style: ICellData['s']) =>
    typeof style === 'string' ? workbook.getStyles().get(style) : style;
  const lines = (values: Record<number, any> | undefined) =>
    Object.fromEntries(
      Object.entries(values ?? {}).map(([index, value]) => [
        index,
        value && typeof value.s === 'string' ? { ...value, s: resolve(value.s) } : value,
      ]),
    );
  const cells: Record<string, Record<string, unknown>> = {};
  for (const row of Object.keys(cellData ?? {})) {
    const values = cellData[Number(row)];
    for (const column of Object.keys(values ?? {})) {
      const value = values[Number(column)];
      const cell = normalizedCell(value && { ...value, s: resolve(value.s) });
      if (cell) (cells[row] ??= {})[column] = cell;
    }
  }
  return {
    ...data,
    cellData: cells,
    rowData: lines(rowData),
    columnData: lines(columnData),
    defaultStyle: resolve(defaultStyle),
  };
}

/**
 * The original local effect, before any transform, defines what an accepted
 * edit may insert/remove. This does not read transformed mutation parameters,
 * call transform, or derive the answer from equality between replicas.
 *
 * Unique text markers cover ordinary text, including text beside/inside Doc
 * links, drawings and Formula operations. Existing pair regressions separately
 * specify style, entity conflict and literal Formula-source semantics.
 */
export class ContentIntent {
  private readonly expected: ContentState;
  private readonly effects = new Map<string, Effect>();
  private order: string[];
  readonly checks = { doc: 0, sheetInsert: 0, sheetRemove: 0 };

  constructor(replica: Replica) {
    this.expected = contentState(replica);
    this.order = [...this.expected.text];
  }

  record(label: string, before: ContentState, after: ContentState, replica: Replica) {
    const sheets = difference(before.sheets, after.sheets);
    this.effects.set(label, {
      text: difference(before.text, after.text),
      order: [...after.text],
      sheets,
      insertedSheets: new Map(sheets.inserted.map((id) => [id, sheetContent(replica, id)])),
    });
  }

  accept(label: string, replica: Replica) {
    const effect = this.effects.get(label);
    if (!effect) throw new Error(`No original content intent for ${label}`);
    for (const key of ['text', 'sheets'] as const) {
      for (const id of effect[key].removed) this.expected[key].delete(id);
      for (const id of effect[key].inserted) this.expected[key].add(id);
    }
    const actual = contentState(replica);
    equalIds(actual.text, this.expected.text, `${label}: accepted Doc character intent`);
    const ordered = [...actual.text];
    // Every previously accepted survivor keeps its order. New characters
    // also keep the sender's observed left/right anchors and mutual order.
    // Concurrent unseen inserts at one gap form no artificial causal edge;
    // their first-accepted tie rule remains pinned by dedicated pair tests.
    const survivors = this.order.filter((id) => this.expected.text.has(id));
    const surviving = new Set(survivors);
    equalOrder(
      ordered.filter((id) => surviving.has(id)),
      survivors,
      `${label}: surviving Doc character order`,
    );
    const causal = effect.order.filter((id) => this.expected.text.has(id));
    const observed = new Set(causal);
    equalOrder(
      ordered.filter((id) => observed.has(id)),
      causal,
      `${label}: original Doc insertion anchors`,
    );
    this.order = ordered;
    equalIds(actual.sheets, this.expected.sheets, `${label}: accepted worksheet identity intent`);
    for (const [id, original] of effect.insertedSheets) {
      expect(sheetContent(replica, id), `${label}: original inserted worksheet content`).toEqual(
        original,
      );
    }
    if (effect.text.inserted.length + effect.text.removed.length > 0) this.checks.doc++;
    this.checks.sheetInsert += effect.sheets.inserted.length;
    this.checks.sheetRemove += effect.sheets.removed.length;
    this.effects.delete(label);
  }
}
