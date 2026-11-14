import { CustomRangeType, type ICustomRange, type IDocumentBody } from '@univerjs/core';
import type { IDocumentLayoutBody, IDocumentLayoutTextRun } from '@univerjs/engine-render';
import { validateFormulaDefinition, type FormulaDefinition } from './definition.ts';

export const FORMULA_FONT_FAMILY = 'SpinelDocFormula';

export interface DocFormula {
  id: string;
  start: number;
  end: number;
  definition: FormulaDefinition;
}

/** The entire persisted object is source text and stable references, never evaluated data. */
export function formulaBody(id: string, definition: FormulaDefinition): IDocumentBody {
  return {
    dataStream: definition.expression,
    customRanges: [
      {
        rangeId: id,
        rangeType: CustomRangeType.CUSTOM,
        startIndex: 0,
        endIndex: definition.expression.length - 1,
        wholeEntity: true,
        properties: { spinelFormula: structuredClone(definition) },
      },
    ],
  };
}

export function formulaFromRange(range: ICustomRange, body?: IDocumentBody): DocFormula | null {
  if (range.rangeType !== CustomRangeType.CUSTOM || !range.wholeEntity) return null;
  let definition: FormulaDefinition;
  try {
    definition = validateFormulaDefinition(range.properties?.spinelFormula);
  } catch {
    return null;
  }
  if (
    !definition ||
    !Number.isSafeInteger(range.startIndex) ||
    !Number.isSafeInteger(range.endIndex) ||
    range.startIndex < 0 ||
    range.endIndex < range.startIndex
  )
    return null;
  // Edited or malformed annotations must not keep displaying an older calculation.
  if (
    body &&
    (body.dataStream.slice(range.startIndex, range.endIndex + 1) !== definition.expression ||
      body.customRanges?.filter((item) => item.rangeId === range.rangeId).length !== 1)
  )
    return null;
  return { id: range.rangeId, start: range.startIndex, end: range.endIndex + 1, definition };
}

export function docFormulas(body?: IDocumentBody): DocFormula[] {
  return (body?.customRanges ?? []).flatMap((range) => {
    const formula = formulaFromRange(range, body);
    return formula ? [formula] : [];
  });
}

/** Split existing runs at formula boundaries without changing persisted formatting. */
export function formulaPresentationBody(body: IDocumentBody, scope: string): IDocumentLayoutBody {
  const formulas = docFormulas(body);
  if (!formulas.length) return body;
  const cuts = new Set<number>();
  for (const run of body.textRuns ?? []) {
    cuts.add(run.st);
    cuts.add(run.ed);
  }
  for (const formula of formulas) {
    cuts.add(formula.start);
    cuts.add(formula.end);
  }
  const ordered = [...cuts].sort((a, b) => a - b);
  const textRuns: IDocumentLayoutTextRun[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const st = ordered[i]!;
    const ed = ordered[i + 1]!;
    const existing = body.textRuns?.find((run) => run.st <= st && run.ed >= ed);
    const formula = formulas.find((item) => item.start <= st && item.end >= ed);
    if (existing || formula)
      textRuns.push({
        st,
        ed,
        ts: {
          ...existing?.ts,
          ...(formula ? { ff: FORMULA_FONT_FAMILY, customGlyphKey: `${scope}:${formula.id}` } : {}),
        },
      });
  }
  return { ...body, textRuns };
}
