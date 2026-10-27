const messages = {
  'memory-headroom':
    'Recovery verification has insufficient memory headroom. Free memory or use a larger recovery host, then retry.',
  'memory-limit':
    'Recovery verification exceeded its memory limit. Use a recovery host with a larger verification budget.',
  'time-limit':
    'Recovery verification exceeded its time limit. Use a recovery host with a larger verification budget.',
  'archive-size':
    'The backup exceeds the encrypted archive size limit. Keep the source backup and use a larger recovery budget.',
  'database-size':
    'The restored database exceeds the recovery size limit. Keep the source backup and use a larger recovery budget.',
  'disk-space':
    'Recovery has insufficient disk space. Free space on the private backup or staging volume, then retry.',
} as const;

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
