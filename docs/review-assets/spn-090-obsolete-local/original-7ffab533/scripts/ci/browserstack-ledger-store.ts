import { createHash, randomUUID } from 'node:crypto';
import { boundedClock, boundedJson, ControlError } from './browserstack-bounded-http.ts';
import {
  budgetReport,
  ingestQuota,
  ledgerBytes,
  ledgerLimits,
  readLedger,
  type LifetimeLedger,
} from './browserstack-ledger.ts';

// This is a permanent data branch, not an obsolete ticket implementation branch.
// Initialization is a separate explicit operation from the owner-attested seed.
// Its data-only pushes do not match CI's main-only push trigger.
export const ledgerLocation = Object.freeze({
  repository: 'mxbaylee/spinel',
  branch: 'codex/browserstack-lifetime-ledger',
  path: 'browserstack-lifetime-ledger.json',
});
export const ledgerStoreLimits = Object.freeze({
  timeoutMs: 8000,
  operationMs: 30000,
  responseBytes: 2 * 1024 * 1024,
  requests: 4,
});
type Snapshot = { sha: string; ledger: LifetimeLedger };
type Reservation = LifetimeLedger['reservations'][number];
export const probeAdmissionPolicy = Object.freeze({
  name: 'owner-attested-one-probe-minute-ceiling-v1' as const,
  maximumEvidenceAgeMs: 300000,
  reservedSeconds: 180,
});
type ProbeInput = Omit<
  Reservation,
  | 'reservationId'
  | 'state'
  | 'sessionIds'
  | 'quotaReportId'
  | 'assumedPriorChargedSeconds'
  | 'admissionPolicy'
> & { quotaEvidence: Uint8Array };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ControlError('ledger-state-invalid');
  return value as Record<string, unknown>;
};
const blobSha = (bytes: Uint8Array) =>
  createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function ledgerStore(options: {
  token: string;
  signal: AbortSignal;
  deadline?: number;
  now?: () => number;
  fetcher?: typeof fetch;
}) {
  if (!options.token || /[\r\n]/.test(options.token))
    throw new ControlError('ledger-token-missing');
  const now = boundedClock(options.now);
  const endpoint = `https://api.github.com/repos/${ledgerLocation.repository}/contents/${ledgerLocation.path}`;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const transaction = () => {
    const deadline = Math.min(
      Math.floor(now()) + ledgerStoreLimits.operationMs,
      options.deadline ?? Infinity,
    );
    let requests = 0;
    const request = async (method: 'GET' | 'PUT', body?: unknown) => {
      if (++requests > ledgerStoreLimits.requests) throw new ControlError('ledger-request-limit');
      return boundedJson({
        url:
          method === 'GET'
            ? `${endpoint}?ref=${encodeURIComponent(ledgerLocation.branch)}`
            : endpoint,
        method,
        body,
        headers,
        signal: options.signal,
        deadline,
        timeoutMs: ledgerStoreLimits.timeoutMs,
        maximumBytes: ledgerStoreLimits.responseBytes,
        now,
        fetcher: options.fetcher,
      });
    };
    const read = async (): Promise<Snapshot> => {
      let result: unknown;
      try {
        result = await request('GET');
      } catch (error) {
        if (error instanceof ControlError && error.code === 'control-http-404')
          throw new ControlError('ledger-state-missing');
        throw error;
      }
      const value = object(result);
      if (
        value.type !== 'file' ||
        value.path !== ledgerLocation.path ||
        value.encoding !== 'base64' ||
        typeof value.content !== 'string' ||
        typeof value.sha !== 'string' ||
        !/^[a-f0-9]{40}$/.test(value.sha) ||
        typeof value.size !== 'number' ||
        !Number.isSafeInteger(value.size) ||
        value.size < 1 ||
        value.size > ledgerLimits.bytes ||
        !/^[A-Za-z0-9+/=\n]+$/.test(value.content)
      )
        throw new ControlError('ledger-state-invalid');
      const encoded = value.content.replaceAll('\n', '');
      const bytes = Buffer.from(encoded, 'base64');
      if (
        bytes.length !== value.size ||
        bytes.toString('base64') !== encoded ||
        blobSha(bytes) !== value.sha
      )
        throw new ControlError('ledger-state-invalid');
      try {
        return { sha: value.sha, ledger: readLedger(bytes) };
      } catch {
        throw new ControlError('ledger-state-invalid');
      }
    };
    const publish = async (current: Snapshot, next: LifetimeLedger): Promise<Snapshot> => {
      const bytes = ledgerBytes(readLedger(ledgerBytes(next)));
      const expectedSha = blobSha(bytes);
      let conflict = false;
      try {
        const result = object(
          await request('PUT', {
            message: 'Record BrowserStack lifetime usage evidence',
            branch: ledgerLocation.branch,
            sha: current.sha,
            content: bytes.toString('base64'),
          }),
        );
        if (object(result.content).sha !== expectedSha)
          throw new ControlError('ledger-publication-unconfirmed');
      } catch (error) {
        conflict = error instanceof ControlError && error.code === 'control-http-409';
        // Never repeat a PUT after an uncertain response. Read back this exact
        // proposed blob; only durable byte equality can recover its admission.
      }
      if (conflict) throw new ControlError('ledger-conflict');
      let durable: Snapshot;
      try {
        durable = await read();
      } catch {
        throw new ControlError('ledger-publication-unconfirmed');
      }
      if (durable.sha !== expectedSha || !same(durable.ledger, next))
        throw new ControlError('ledger-publication-unconfirmed');
      return durable;
    };
    return { read, publish };
  };
  return {
    async reserve(
      input: ProbeInput,
    ): Promise<Pick<Reservation, 'reservationId' | 'run' | 'attempt'>> {
      if (input.quotaEvidence.byteLength > ledgerLimits.bytes)
        throw new ControlError('ledger-probe-admission-refused');
      const evidence = Buffer.from(input.quotaEvidence);
      let quota: Record<string, unknown>;
      try {
        quota = object(JSON.parse(evidence.toString('utf8')));
      } catch {
        throw new ControlError('ledger-probe-admission-refused');
      }
      const fresh = () => {
        const observedAt = typeof quota.date === 'string' ? Date.parse(quota.date) : NaN;
        const plan = object(quota.plan);
        const data = object(plan.data);
        if (
          !Number.isFinite(observedAt) ||
          observedAt > now() ||
          now() - observedAt > probeAdmissionPolicy.maximumEvidenceAgeMs ||
          quota.status !== 'passed' ||
          quota.run !== input.run ||
          quota.sourceSha !== input.sourceSha ||
          quota.testedSha !== input.testedSha ||
          plan.outcome !== 'available' ||
          data.runningSessions !== 0 ||
          data.queuedSessions !== 0 ||
          typeof data.parallelSessionsAllowed !== 'number' ||
          !Number.isSafeInteger(data.parallelSessionsAllowed) ||
          data.parallelSessionsAllowed < 1 ||
          input.reservedSeconds !== probeAdmissionPolicy.reservedSeconds
        )
          throw new ControlError('ledger-probe-admission-refused');
      };
      fresh();
      const tx = transaction();
      const current = await tx.read();
      if (current.ledger.baseline === null || current.ledger.reservations.length !== 0)
        throw new ControlError('ledger-reservation-refused');
      let observed: LifetimeLedger;
      try {
        observed = ingestQuota(current.ledger, evidence);
      } catch {
        throw new ControlError('ledger-probe-admission-refused');
      }
      const report = budgetReport(observed, new Date(now()));
      const conservative = report.conditionalScenarios.find(
        ({ assumedPerSessionCeilingSeconds }) => assumedPerSessionCeilingSeconds === 60,
      );
      const reportId = createHash('sha256').update(evidence).digest('hex');
      const freshObservations = observed.sessions.flatMap(({ observations }) =>
        observations.filter(({ reportIds }) => reportIds.includes(reportId)),
      );
      if (
        !freshObservations.length ||
        freshObservations.some(
          ({ evidence }) =>
            evidence.outcome !== 'available' ||
            evidence.data.durationSeconds === null ||
            evidence.data.createdAt === null ||
            ['running', 'queued', 'unknown'].includes(evidence.data.providerStatus) ||
            !['done', 'error', 'timeout'].includes(evidence.data.executionStatus),
        ) ||
        report.observed.latestCollection?.id !== reportId ||
        conservative?.assumedRemainingSeconds === null ||
        conservative?.assumedRemainingSeconds === undefined ||
        conservative.assumedRemainingSeconds < input.reservedSeconds
      )
        throw new ControlError('ledger-probe-admission-refused');
      const { quotaEvidence: _quotaEvidence, ...identityInput } = input;
      const reservation: Reservation = {
        ...identityInput,
        reservationId: randomUUID(),
        state: 'reserved',
        sessionIds: [],
        quotaReportId: reportId,
        assumedPriorChargedSeconds: 3600 - conservative.assumedRemainingSeconds,
        admissionPolicy: probeAdmissionPolicy.name,
      };
      fresh();
      const next = readLedger(
        ledgerBytes({
          ...observed,
          revision: observed.revision + 1,
          reservations: [reservation],
        }),
      );
      await tx.publish(current, next);
      // A stale acknowledgment retains the reservation but grants no POST.
      fresh();
      return {
        reservationId: reservation.reservationId,
        run: reservation.run,
        attempt: reservation.attempt,
      };
    },
    async retainUncertainty(
      identity: { reservationId: string; run: string; attempt: number },
      sessionId?: string,
    ): Promise<void> {
      const tx = transaction();
      const current = await tx.read();
      const index = current.ledger.reservations.findIndex(
        (entry) =>
          entry.reservationId === identity.reservationId &&
          entry.run === identity.run &&
          entry.attempt === identity.attempt,
      );
      if (index < 0) throw new ControlError('ledger-reservation-missing');
      const original = current.ledger.reservations[index];
      if (
        sessionId !== undefined &&
        (!/^[a-f0-9]{40}$/.test(sessionId) ||
          (original.sessionIds.length !== 0 && !original.sessionIds.includes(sessionId)))
      )
        throw new ControlError('ledger-reservation-conflict');
      const replacement: Reservation = {
        ...original,
        state: 'uncertain',
        sessionIds: sessionId ? [sessionId] : original.sessionIds,
      };
      if (same(original, replacement)) return;
      const reservations = [...current.ledger.reservations];
      reservations[index] = replacement;
      await tx.publish(current, {
        ...current.ledger,
        revision: current.ledger.revision + 1,
        reservations,
      });
    },
  };
}
