import { validateFormulaDefinition } from '@spinel/doc-formulas';

/**
 * A portable file has no trusted instance identity. Keep its authored expression
 * as text, but never let foreign source IDs bind to documents on this instance.
 * Source-free formulas are self-contained and can remain native formula objects.
 */
export function removeImportedSourceBindings(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(removeImportedSourceBindings);
    return;
  }
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.customRanges)) {
    object.customRanges = object.customRanges.filter((range: unknown) => {
      if (!range || typeof range !== 'object') return true;
      const properties = (range as { properties?: Record<string, unknown> }).properties;
      if (!properties || !Object.hasOwn(properties, 'spinelFormula')) return true;
      try {
        return validateFormulaDefinition(properties.spinelFormula).references.length === 0;
      } catch {
        return false;
      }
    });
  }
  Object.values(object).forEach(removeImportedSourceBindings);
}
