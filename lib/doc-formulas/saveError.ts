import type { FormulaResult } from './definition.ts';

export type FormulaFailureReason = Extract<FormulaResult, { ok: false }>['reason'];

/** Safe calculation failures before mutation; never include source identities or values. */
export class FormulaSaveError extends Error {
  readonly reason: FormulaFailureReason;
  readonly retryable: boolean;

  constructor(reason: FormulaFailureReason) {
    const messages: Record<FormulaFailureReason, string> = {
      busy: 'Calculation is busy. Your expression and format are still here. Try saving again.',
      timeout:
        'Calculation timed out. Your expression and format are still here. Try saving again.',
      unavailable:
        'Calculation is temporarily unavailable. Your expression and format are still here. Try saving again.',
      'invalid-formula': 'Check this formula. Your expression and format are still here.',
      'private-source':
        'This formula’s sources are unavailable. Your expression and format are still here.',
      'missing-source':
        'This formula’s sources are unavailable. Your expression and format are still here.',
      'too-large':
        'This calculation exceeds the supported limits. Use a smaller source or range, or shorter cell values.',
    };
    super(messages[reason]);
    this.name = 'FormulaSaveError';
    this.reason = reason;
    this.retryable = reason === 'busy' || reason === 'timeout' || reason === 'unavailable';
  }
}
