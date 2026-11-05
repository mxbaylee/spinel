import { captureDiagnostic, observeOperation } from '@spinel/diagnostics';
import type { DiagnosticContext, DiagnosticSource, Operation } from '@spinel/diagnostics';
import type { DiagnosticOperation } from './diagnosticsAccount.ts';

export function diagnosticSource(
  diagnostics: { begin(): DiagnosticOperation | undefined },
  context: DiagnosticContext,
): DiagnosticSource {
  return () => {
    const operation = diagnostics.begin();
    return operation
      ? { sink: operation.sink, context: { ...context, runId: operation.runId } }
      : undefined;
  };
}

/** A cancelled async completion cannot later turn into a second successful operation. */
export function beginOperation(
  source: DiagnosticSource | undefined,
  operation: Operation,
  now = () => performance.now(),
) {
  const scope = captureDiagnostic(source);
  let started = 0;
  try {
    started = now();
  } catch {
    /* An optional clock cannot affect the operation. */
  }
  let finished = false;
  return (outcome: 'success' | 'failure' | 'cancelled') => {
    if (finished) return;
    finished = true;
    if (!scope) return;
    try {
      observeOperation(scope.sink, scope.context, operation, outcome, Math.max(0, now() - started));
    } catch {
      /* Neither clock nor observer participates in the measured work. */
    }
  };
}
