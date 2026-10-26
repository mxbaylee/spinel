import { createRequire } from 'node:module';
import type { SheetPrintOptions } from './contract.ts';
import type { NativeSheetInput } from './native.ts';
import type { NativeDocInput, DocPrintOptions } from './doc-native.ts';

export { PRINT_LIMITS, PrintError } from './contract.ts';
export type {
  PreparedImage,
  PreparedFont,
  PrintLimits,
  SheetPrintOptions,
  SheetPrintPage,
  PrintBox,
  PrintErrorCode,
} from './contract.ts';
export { preflightSheets, paginateSheet } from './preflight.ts';
export type { SheetGeometry, SheetPreflight } from './preflight.ts';
export type { NativeSheetInput as SheetPrintInput } from './native.ts';
export type { NativeDocInput as DocPrintInput, DocPrintOptions } from './doc-native.ts';
export { selectDocImageSources, selectSheetImageSources } from './selection.ts';
export type { DocImageSelectionOptions } from './selection.ts';
export type {
  PreparedDocFormula,
  PreparedDocFormulaResult,
  PreparedFormulaValue,
} from './doc-preparation.ts';

// Host-side metadata selection must not import Canvas or initialize fonts. Node
// loads these synchronous ESM graphs only when a dedicated process renders. Keep
// loading synchronous: an await before native admission would expose caller
// snapshots/bytes to mutation before ownership and the shared lock are acquired.
const loadRenderer = createRequire(import.meta.url);

export async function renderSheetPdf(input: NativeSheetInput, options: SheetPrintOptions = {}) {
  const native = loadRenderer('./native.ts') as typeof import('./native.ts');
  return native.renderSheetPdfCandidate(input, options);
}

export async function renderDocPdf(input: NativeDocInput, options: DocPrintOptions = {}) {
  const native = loadRenderer('./doc-native.ts') as typeof import('./doc-native.ts');
  return native.renderDocPdf(input, options);
}
