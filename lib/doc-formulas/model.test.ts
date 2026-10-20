import { describe, expect, it } from 'vitest';
import { BuildTextUtils, CustomRangeType, type IDocumentBody } from '@univerjs/core';
import { docFormulas, formulaBody, formulaPresentationBody } from './model.ts';
import { formulaGeometry } from './rendering.ts';
import type { FormulaDefinition } from './definition.ts';
const definition: FormulaDefinition = {
  version: 1,
  expression: '=Budget.Summary.A1',
  references: [{ start: 1, end: 18, itemId: 'item', sheetId: 'sheet', range: 'A1' }],
};

describe('native Doc formula model', () => {
  it('persists only readable expression and stable bindings, with independent copies', () => {
    const body = formulaBody('formula-one', definition);
    expect(body.dataStream).toBe(definition.expression);
    expect(body.textRuns).toBeUndefined();
    expect(body.customRanges?.[0]).toMatchObject({
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
    });
    expect(docFormulas(body)).toEqual([
      { id: 'formula-one', start: 0, end: definition.expression.length, definition },
    ]);
    expect(body.customRanges![0]!.properties!.spinelFormula).not.toBe(definition);
    expect(JSON.stringify(body)).not.toContain('customGlyphKey');
    expect(JSON.stringify(body)).not.toContain('result');
  });
  it('projects formula paint metadata without changing source text, formatting or saved snapshot', () => {
    const body = formulaBody('formula-one', definition);
    body.textRuns = [{ st: 0, ed: body.dataStream.length, ts: { bl: 1, fs: 14 } }];
    const before = structuredClone(body);
    const presentation = formulaPresentationBody(body, 'viewer-a');
    expect(presentation.dataStream).toBe(body.dataStream);
    expect(presentation.textRuns![0]!.ts).toMatchObject({
      bl: 1,
      fs: 14,
      customGlyphKey: 'viewer-a:formula-one',
    });
    expect(body).toEqual(before);
    expect(formulaPresentationBody(body, 'viewer-b').textRuns![0]!.ts!.customGlyphKey).toBe(
      'viewer-b:formula-one',
    );
  });
  it('preserves neighboring text styles and refuses a stale annotation after expression editing', () => {
    const body: IDocumentBody = {
      dataStream: `Before ${definition.expression} after`,
      customRanges: [
        {
          ...formulaBody('f', definition).customRanges![0]!,
          startIndex: 7,
          endIndex: 7 + definition.expression.length - 1,
        },
      ],
      textRuns: [{ st: 0, ed: 40, ts: { it: 1 } }],
    };
    const projected = formulaPresentationBody(body, 'viewer');
    expect(
      projected.textRuns?.map((run) => [run.st, run.ed, Boolean(run.ts?.customGlyphKey)]),
    ).toEqual([
      [0, 7, false],
      [7, 7 + definition.expression.length, true],
      [7 + definition.expression.length, 40, false],
    ]);
    body.dataStream = body.dataStream.replace('A1', 'B2');
    expect(docFormulas(body)).toEqual([]);
  });
  it('uses fresh SDK clipboard identities and refuses ambiguous forged identities', () => {
    const body = formulaBody('original', definition);
    const pasted = BuildTextUtils.customRange.copyCustomRange(body.customRanges![0]!);
    expect(pasted.rangeId).not.toBe('original');
    expect(pasted.properties).toEqual(body.customRanges![0]!.properties);
    body.customRanges!.push({ ...body.customRanges![0]! });
    expect(docFormulas(body)).toEqual([]);
  });
  it('measures scalar and a thirty-row table as native glyphs, without stringifying private state', () => {
    const scalar = formulaGeometry(
      { ok: true, kind: 'scalar', value: 42 },
      definition,
      (text) => text.length * 0.6,
    );
    expect(scalar.table).toBe(false);
    const table = formulaGeometry(
      { ok: true, kind: 'table', rows: Array.from({ length: 30 }, (_, row) => [row, 'Item', 3]) },
      definition,
      (text) => text.length * 0.6,
    );
    expect(table.rows).toHaveLength(30);
    expect(table.ascent).toBe(40.5);
    expect(table.width).toBeLessThanOrEqual(36);
    const denied = formulaGeometry(
      { ok: false, reason: 'private-source' },
      definition,
      (text) => text.length * 0.6,
    );
    expect(denied.rows.flat().join('')).not.toContain('42');
    expect(denied.table).toBe(false);
  });
});
