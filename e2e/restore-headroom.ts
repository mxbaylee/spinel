import { RECOVERY_HEADROOM_PREFIX } from '../src/server/backup/recovery-worker.ts';

const nullableCounters = [
  'maximumBytes',
  'usedBytes',
  'chargedBytes',
  'fileBytes',
  'sharedBytes',
  'inactiveBytes',
  'dirtyBytes',
  'writebackBytes',
  'availableKiB',
] as const;
const counters = [
  'observedAtMs',
  'reclaimableBytes',
  'cgroupRequiredBytes',
  'hostRequiredKiB',
] as const;
const flags = ['cacheCountersValid', 'cgroupRefused', 'hostRefused'] as const;
const keys = ['version', 'phase', 'probes', ...nullableCounters, ...counters, ...flags];
const counter = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** Only bounded, fixed fields from an owned container's log tail may be public.
 * These are ordered refusals, not an assertion of which one caused a journal state. */
export function restoreHeadroomDiagnostics(logTail: string) {
  const refusals: Record<string, unknown>[] = [];
  let malformed = 0;
  let omitted = 0;
  for (const line of logTail.slice(-16_384).split('\n')) {
    if (!line.startsWith(RECOVERY_HEADROOM_PREFIX)) continue;
    try {
      if (line.length > 2048) throw new Error('Oversized diagnostic.');
      const value: unknown = JSON.parse(line.slice(RECOVERY_HEADROOM_PREFIX.length));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid diagnostic.');
      const item = value as Record<string, unknown>;
      if (
        Object.keys(item).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(item, key)) ||
        item.version !== 1 ||
        !['start', 'running'].includes(item.phase as string) ||
        !Array.isArray(item.probes) ||
        item.probes.length !== 4 ||
        !item.probes.every((probe) => ['fulfilled', 'rejected'].includes(probe)) ||
        !nullableCounters.every((key) => item[key] === null || counter(item[key])) ||
        !counters.every((key) => counter(item[key])) ||
        !flags.every((key) => typeof item[key] === 'boolean') ||
        (!item.cgroupRefused && !item.hostRefused) ||
        item.cgroupRequiredBytes !== (item.phase === 'start' ? 640 : 128) * 1024 ** 2 ||
        item.hostRequiredKiB !== (item.phase === 'start' ? 768 : 256) * 1024
      )
        throw new Error('Invalid diagnostic.');
      // Reconstruct rather than forwarding a parsed object from process output.
      refusals.push(Object.fromEntries(keys.map((key) => [key, item[key]])));
      if (refusals.length > 8) {
        refusals.shift();
        omitted++;
      }
    } catch {
      malformed++;
    }
  }
  return { refusals, malformed, omitted, inputTruncated: logTail.length > 16_384 };
}
