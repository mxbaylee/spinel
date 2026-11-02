/** Reviewed legacy cutoff, not production activation or proof of old events.
 * Durable provider/source verification:
 * https://github.com/mxbaylee/spinel/tree/3ad4a4d2ff433b70efa4800593319a1d7745f5ea/docs/review-assets/spn-129-adoption-cutoff
 * This authority survives expiry of that one provider registration. It grants
 * no exception for missing registrations or proofs after the fixed cutoff. */
export const legacyHistoryCutoff = {
  repository: 'mxbaylee/spinel',
  workflowId: 403983940,
  runId: 41510513950,
  sequence: 14,
  createdAt: '2026-11-02T19:30:10Z',
  base: '18a8759c498574a1d9cc24a969a558cd97a798ed',
  head: '4903b96968a988812555010f1bbfb0214709006b',
  tested: '1bcfcf16e1699c8f9e7f23c21959b8013e206761',
  workflowSourceSha256: '809dd6325243857260c84ffb9bf41b893625d9b1ae8e4cbb6a1ff725e49426ee',
} as const;

export interface LegacyAdoption {
  cutoff: number;
  run: number;
  job: number;
  attempt: number;
  step: number;
  completed: number;
}

export const adoptionValidationStep = 'Validate legacy history adoption v1';
export const noAdoptionStep = 'Legacy history adoption not required';
export const adoptionMarkerPrefix = 'PR adoption v1 ';
const positive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

export function eligibleForLegacyAdoption(
  repository: string,
  workflowId: number,
  createdAt: string,
) {
  const created = Date.parse(createdAt);
  return (
    repository === legacyHistoryCutoff.repository &&
    workflowId === legacyHistoryCutoff.workflowId &&
    Number.isFinite(created) &&
    created < Date.parse(legacyHistoryCutoff.createdAt)
  );
}

export function adoptionMarker(sequence: number) {
  if (!positive(sequence) || sequence <= legacyHistoryCutoff.sequence)
    throw new Error('Legacy adoption must follow the fixed cutoff.');
  return `${adoptionMarkerPrefix}cutoff=${legacyHistoryCutoff.runId} seq=${sequence}`;
}

export function parseAdoptionMarker(name: unknown): number | null {
  if (typeof name !== 'string' || !name.startsWith(adoptionMarkerPrefix)) return null;
  const match = /^PR adoption v1 cutoff=([1-9][0-9]*) seq=([1-9][0-9]*)$/.exec(name);
  if (!match || adoptionMarker(Number(match[2])) !== name)
    throw new Error('Malformed legacy-adoption marker.');
  return Number(match[2]);
}

export function adoptionIdentity(adoption: LegacyAdoption): string {
  if (
    adoption.cutoff !== legacyHistoryCutoff.runId ||
    ![adoption.run, adoption.job, adoption.attempt, adoption.step, adoption.completed].every(
      positive,
    ) ||
    adoption.completed < Date.parse(legacyHistoryCutoff.createdAt)
  )
    throw new Error('Invalid immutable legacy-adoption origin.');
  return `adopted=${adoption.cutoff} run=${adoption.run} job=${adoption.job} attempt=${adoption.attempt} step=${adoption.step} at=${adoption.completed}`;
}

export function sameAdoption(left: LegacyAdoption | undefined, right: LegacyAdoption | undefined) {
  return left === undefined || right === undefined
    ? left === right
    : adoptionIdentity(left) === adoptionIdentity(right);
}
