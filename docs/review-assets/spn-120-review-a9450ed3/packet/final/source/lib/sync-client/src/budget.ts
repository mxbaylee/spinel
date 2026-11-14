import type { Mutation } from '@spinel/sync-transform';
import { ClientError, MAX_PENDING_BYTES } from './types.ts';

const encoder = new TextEncoder();
export const encodedBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

/** Reserve room for the largest revision and reconnect fence before queuing. */
export function envelopeBytes(mutations: readonly Mutation[]): number {
  return encodedBytes({
    type: 'submit',
    mutationId: '00000000-0000-4000-8000-000000000000',
    baseRevision: Number.MAX_SAFE_INTEGER,
    expectedRevision: Number.MAX_SAFE_INTEGER,
    mutations,
  });
}

/** Charge expanded values before cloning them or retaining a lazy cell cache. */
export function byteBudget(limit = MAX_PENDING_BYTES) {
  let remaining = limit;
  return (value: unknown) => {
    remaining -= encodedBytes(value);
    if (remaining < 0) throw new ClientError('capacity');
  };
}
