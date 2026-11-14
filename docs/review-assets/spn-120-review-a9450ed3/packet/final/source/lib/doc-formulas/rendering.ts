import type { IDocCustomGlyphRenderInput } from '@univerjs/engine-render';
import { formatFormulaValue, type FormulaDefinition, type FormulaResult } from './definition.ts';

export type FormulaDisplay = FormulaResult | { ok: false; reason: 'loading' };
export const FORMULA_MESSAGES: Record<Extract<FormulaDisplay, { ok: false }>['reason'], string> = {
  loading: 'Calculating…',
  'private-source': 'You need access to this formula’s sources',
  'missing-source': 'Source unavailable',
  'invalid-formula': 'Check formula',
  'too-large': 'Result is too large',
  busy: 'Calculation busy — retry',
  timeout: 'Calculation timed out',
  unavailable: 'Result unavailable',
};
export function formulaDisplayRows(
  result: FormulaDisplay,
  definition: FormulaDefinition,
): string[][] {
  if (!result.ok) return [[FORMULA_MESSAGES[result.reason]]];
  const rows = result.kind === 'scalar' ? [[result.value]] : result.rows;
  return rows.length
    ? rows.map((row) => row.map((cell) => formatFormulaValue(cell, definition.format)))
    : [['(empty)']];
}
export interface FormulaGeometry {
  rows: string[][];
  columns: number[];
  width: number;
  ascent: number;
  descent: number;
  table: boolean;
}
/** Dimensions use em units so native paragraph font size and zoom remain authoritative. */
export function formulaGeometry(
  result: FormulaDisplay,
  definition: FormulaDefinition,
  measure: (text: string) => number,
): FormulaGeometry {
  const rows = formulaDisplayRows(result, definition);
  const table = result.ok && result.kind === 'table';
  const count = Math.max(1, ...rows.map((row) => row.length));
  const columns = Array.from({ length: count }, (_, col) =>
    Math.max(table ? 3 : 1, ...rows.map((row) => measure(row[col] ?? '') + (table ? 1 : 0.5))),
  );
  const total = columns.reduce((sum, value) => sum + value, 0);
  return {
    rows,
    columns,
    table,
    width: total,
    ascent: table ? rows.length * 1.35 : 1,
    descent: table ? 0.2 : 0.25,
  };
}

export interface FormulaPaintColors {
  background: string;
  unavailableBackground: string;
  border: string;
  text: string;
}
const defaultColors: FormulaPaintColors = {
  background: '#fafafa',
  unavailableBackground: '#f2f2f2',
  border: '#aaaaaa',
  text: '#222222',
};

export function paintFormula(
  input: IDocCustomGlyphRenderInput,
  geometry: FormulaGeometry,
  unavailable: boolean,
  colors: FormulaPaintColors = defaultColors,
) {
  const { context: ctx, x, y, fontSizePx: size } = input;
  const width = geometry.width * size;
  const top = y - geometry.ascent * size;
  ctx.save();
  ctx.font = `${input.italic ? 'italic ' : ''}${input.bold ? 'bold ' : ''}${size}px "Atkinson Hyperlegible Next", sans-serif`;
  // The document canvas is paper in both application themes. No theme paint escapes the object.
  ctx.fillStyle = unavailable ? colors.unavailableBackground : colors.background;
  ctx.fillRect(x, top, width, (geometry.ascent + geometry.descent) * size);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 0.75;
  ctx.fillStyle = colors.text;
  for (let row = 0; row < geometry.rows.length; row++) {
    let left = x;
    for (let col = 0; col < geometry.columns.length; col++) {
      const cellWidth = geometry.columns[col]! * size;
      const cellTop = geometry.table ? top + row * 1.35 * size : top;
      const cellHeight = geometry.table ? 1.35 * size : (geometry.ascent + geometry.descent) * size;
      if (geometry.table) ctx.strokeRect(left, cellTop, cellWidth, cellHeight);
      ctx.save();
      ctx.beginPath();
      ctx.rect(left + 0.15 * size, cellTop, Math.max(0, cellWidth - 0.3 * size), cellHeight);
      ctx.clip();
      ctx.fillText(
        geometry.rows[row]?.[col] ?? '',
        left + 0.25 * size,
        geometry.table ? cellTop + size : y - 0.05 * size,
      );
      ctx.restore();
      left += cellWidth;
    }
  }
  ctx.restore();
}
