import { validateFormulaDefinition } from '@spinel/doc-formulas';
import { AuthError } from '../auth/store.ts';

/** Formula annotations contain authored definitions only, including in nested Doc bodies. */
export function mapArchiveFormulaSources(value: unknown, map: (sourceId: string) => string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value) mapArchiveFormulaSources(child, map);
    return;
  }
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.customRanges))
    for (const range of object.customRanges) {
      if (!range || typeof range !== 'object') continue;
      const properties = (range as { properties?: Record<string, unknown> }).properties;
      if (!properties || !Object.hasOwn(properties, 'spinelFormula')) continue;
      try {
        const definition = validateFormulaDefinition(properties.spinelFormula);
        properties.spinelFormula = {
          ...definition,
          references: definition.references.map((reference) => ({
            ...reference,
            itemId: map(reference.itemId),
          })),
        };
      } catch {
        throw new AuthError(400, 'This Univer file contains an invalid Formula definition.');
      }
    }
  for (const child of Object.values(object)) mapArchiveFormulaSources(child, map);
}
