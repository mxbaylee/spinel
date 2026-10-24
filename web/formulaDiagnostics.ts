import { parseFormula } from '@spinel/doc-formulas';
import { observeOperation } from '@spinel/diagnostics';
import type { DiagnosticContext, DiagnosticSink } from '@spinel/diagnostics';

/** Observe an existing public library call; never pass its expression or result to the sink. */
export function observedFormulaParse(
  expression: string,
  sink: DiagnosticSink | undefined,
  context: DiagnosticContext,
) {
  const start = performance.now();
  try {
    const result = parseFormula(expression);
    observeOperation(
      sink,
      context,
      'formula-parse',
      'success',
      Math.max(0, performance.now() - start),
    );
    return result;
  } catch (error) {
    observeOperation(
      sink,
      context,
      'formula-parse',
      'failure',
      Math.max(0, performance.now() - start),
    );
    throw error;
  }
}
