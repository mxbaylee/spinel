import { RESTORE_RESOURCE_MESSAGES as messages } from '../../shared/restore.ts';

export type RecoveryResourceCode = keyof typeof messages;
export const isRecoveryResourceCode = (value: unknown): value is RecoveryResourceCode =>
  typeof value === 'string' && Object.hasOwn(messages, value);

/** Only fixed operational advice may cross the worker/API boundary. Never wrap
 * a native error's message, filename, SQL or recovered document content here. */
export class RecoveryResourceError extends Error {
  readonly code: RecoveryResourceCode;
  constructor(code: RecoveryResourceCode) {
    if (!isRecoveryResourceCode(code)) throw new Error('Invalid recovery resource code.');
    super(messages[code]);
    this.name = 'RecoveryResourceError';
    this.code = code;
  }
}

/** Refusals that another configured key cannot change. A wrong key and altered
 * bytes are indistinguishable, so `backup-unreadable` tries the next key. */
export const keyIndependent = (error: unknown): error is RecoveryResourceError =>
  error instanceof RecoveryResourceError && error.code !== 'backup-unreadable';
