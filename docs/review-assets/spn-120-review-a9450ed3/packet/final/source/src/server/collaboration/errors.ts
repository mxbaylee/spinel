/** Application access errors stay independent of any editor transport SDK. */
export class CollaborationError extends Error {
  readonly code: 'PERMISSION_DENIED' | 'INVALID_REQUEST';

  constructor(code: 'PERMISSION_DENIED' | 'INVALID_REQUEST', message: string) {
    super(message);
    this.name = 'CollaborationError';
    this.code = code;
  }
}
