import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { refactorFormulaUnitQualifier } from '@univerjs/engine-formula';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Rebase known native self references; text, sheet IDs and opaque resources stay intact. */
export function snapshotIdentity<T extends IDocumentData | IWorkbookData>(
  snapshot: T,
  id: string,
): T {
  const copy = structuredClone(snapshot);
  const previous = snapshot.id;
  copy.id = id;
  if (previous === id) return copy;
  const unit = (value: unknown, docDrawing = false) => {
    if (!object(value)) return;
    if (value.unitId === previous) value.unitId = id;
    if (docDrawing && value.subUnitId === previous) value.subUnitId = id;
  };
  const formula = (value: unknown, key: string) => {
    if (object(value) && typeof value[key] === 'string')
      value[key] = refactorFormulaUnitQualifier(value[key], previous, id);
  };
  if ('sheets' in copy) {
    for (const sheet of Object.values(copy.sheets))
      for (const row of Object.values(sheet.cellData ?? {}))
        for (const cell of Object.values(row ?? {})) formula(cell, 'f');
  } else {
    // Docs drawings occur in the body, headers, footers and notes. Only drawing entries
    // are normalized: comment subunits such as default_doc are not document IDs.
    const drawings = (value: unknown) => {
      if (!object(value)) return;
      if (object(value.drawings))
        for (const drawing of Object.values(value.drawings)) unit(drawing, true);
    };
    drawings(copy);
    for (const key of ['headers', 'footers', 'footnotes', 'endnotes', 'notes'] as const) {
      const parts = (copy as unknown as ObjectValue)[key];
      if (object(parts)) for (const part of Object.values(parts)) drawings(part);
    }
  }
  for (const resource of copy.resources ?? []) {
    if (
      ![
        'SHEET_DRAWING_PLUGIN',
        'DOC_DRAWING_PLUGIN',
        'SHEET_RANGE_THEME_MODEL_PLUGIN',
        'SHEET_WORKSHEET_PROTECTION_PLUGIN',
        'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN',
        'SHEET_DEFINED_NAME_PLUGIN',
      ].includes(resource.name) ||
      !resource.data
    )
      continue;
    const data: unknown = JSON.parse(resource.data);
    if (!object(data)) continue;
    if (resource.name === 'SHEET_DRAWING_PLUGIN') {
      for (const subunit of Object.values(data))
        if (object(subunit)) {
          unit(subunit);
          if (object(subunit.data))
            for (const drawing of Object.values(subunit.data)) unit(drawing);
        }
    } else if (resource.name === 'DOC_DRAWING_PLUGIN') {
      if (object(data.data)) for (const drawing of Object.values(data.data)) unit(drawing, true);
    } else if (resource.name === 'SHEET_RANGE_THEME_MODEL_PLUGIN') {
      if (object(data.rangeThemeStyleRuleMap))
        for (const rule of Object.values(data.rangeThemeStyleRuleMap))
          if (object(rule)) unit(rule.rangeInfo);
    } else if (resource.name === 'SHEET_DEFINED_NAME_PLUGIN') {
      for (const name of Object.values(data)) {
        formula(name, 'formulaOrRefString');
        formula(name, 'formulaOrRefStringWithPrefix');
      }
    } else if (Object.hasOwn(data, previous)) {
      const rules = data[previous];
      delete data[previous];
      data[id] = rules;
      if (Array.isArray(rules)) for (const rule of rules) unit(rule);
    }
    resource.data = JSON.stringify(data);
  }
  return copy;
}
