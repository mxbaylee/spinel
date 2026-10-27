import { byteBudget, encodedBytes, envelopeBytes } from './budget.ts';
import { validateRecoverySnapshot } from './recovery.ts';
import { ClientError, MAX_BATCH_MUTATIONS, MAX_PENDING_BYTES, MAX_WIRE_BYTES } from './types.ts';
import type { ClientCheckpoint, ClientFailure } from './types.ts';

export const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 1;
export const clientFailures = new Set<ClientFailure>([
  'unsupported',
  'refused',
  'stale',
  'divergence',
  'unavailable',
  'malformed',
  'capacity',
  'retry-conflict',
  'invariant',
]);

/** Admit retained structure and budgets without loading a native editor or transforms. */
export function validateCheckpoint(
  checkpoint: ClientCheckpoint,
  unitId: string,
  revision: number,
): void {
  if (
    !validRevision(revision) ||
    !checkpoint ||
    checkpoint.version !== 1 ||
    checkpoint.unitId !== unitId ||
    checkpoint.revision !== revision ||
    !checkpoint.snapshot ||
    checkpoint.snapshot.id !== unitId ||
    !Array.isArray(checkpoint.inflight) ||
    !Array.isArray(checkpoint.buffer) ||
    checkpoint.buffer.some((group) => !Array.isArray(group) || !group.length) ||
    (checkpoint.failure !== undefined && !clientFailures.has(checkpoint.failure))
  )
    throw new ClientError('malformed');
  validateRecoverySnapshot(checkpoint);
  byteBudget()(checkpoint.snapshot);
  if (
    checkpoint.inflight.length > 8192 ||
    checkpoint.buffer.length > 8192 ||
    checkpoint.buffer.some((group) => group.length > MAX_BATCH_MUTATIONS) ||
    checkpoint.inflight.length +
      checkpoint.buffer.reduce((count, group) => count + group.length, 0) >
      8192
  )
    throw new ClientError('capacity');
  const pending = [...checkpoint.inflight, ...checkpoint.buffer.flat()];
  if (pending.length > 8192 || encodedBytes(pending) > MAX_PENDING_BYTES)
    throw new ClientError('capacity');
  const sent = checkpoint.sent;
  if (
    sent !== null &&
    (!sent ||
      sent.type !== 'submit' ||
      typeof sent.mutationId !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(sent.mutationId) ||
      !validRevision(sent.baseRevision) ||
      sent.baseRevision > revision ||
      !Array.isArray(sent.mutations) ||
      !sent.mutations.length ||
      sent.mutations.length > MAX_BATCH_MUTATIONS ||
      sent.expectedRevision !== undefined ||
      Object.keys(sent).some(
        (key) => !['type', 'mutationId', 'baseRevision', 'mutations'].includes(key),
      ) ||
      encodedBytes(sent) > MAX_WIRE_BYTES)
  )
    throw new ClientError('malformed');
  if (!sent && checkpoint.inflight.length) throw new ClientError('malformed');
  for (const group of checkpoint.buffer)
    if (group.length > MAX_BATCH_MUTATIONS || envelopeBytes(group) > MAX_WIRE_BYTES)
      throw new ClientError('capacity');
  // Root targets are identity, whereas nested Formula/custom IDs are data.
  for (const mutation of [...pending, ...(sent?.mutations ?? [])])
    if (!mutation || mutation.params?.unitId !== unitId) throw new ClientError('malformed');
}
