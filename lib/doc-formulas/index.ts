export {
  FORMULA_FORMATS,
  FORMULA_LIMITS,
  formatFormulaValue,
  formulaRange,
  parseFormula,
  validateFormulaDefinition,
} from './definition.ts';
export type {
  FormulaDefinition,
  FormulaFormat,
  FormulaReference,
  FormulaResult,
  FormulaValue,
  ParsedReference,
} from './definition.ts';
export { docFormulas, formulaBody, formulaFromRange, formulaPresentationBody } from './model.ts';
export type { DocFormula } from './model.ts';
export {
  FORMULA_MESSAGES,
  formulaDisplayRows,
  formulaGeometry,
  paintFormula,
} from './rendering.ts';
export type { FormulaDisplay, FormulaGeometry, FormulaPaintColors } from './rendering.ts';
import type { DocFormulaOptions } from './native.ts';
export async function installDocFormulas(options: DocFormulaOptions) {
  return (await import('./native.ts')).installDocFormulas(options);
}
export type { DocFormulaController, DocFormulaOptions, FormulaState } from './native.ts';
export type { FormulaSource } from './definition.ts';
import type { FormulaDefinition, FormulaSource } from './definition.ts';
export async function evaluateFormula(definition: FormulaDefinition, sources: FormulaSource[]) {
  return (await import('./evaluate.ts')).evaluateFormula(definition, sources);
}

export type { DocFormulaSelection } from './native.ts';
export { completeFormula, moveFormulaBindings, quoteFormulaName } from './completion.ts';
export type { FormulaCompletion, FormulaSourceOption, FormulaSheetOption } from './completion.ts';
