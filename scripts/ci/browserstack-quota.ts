// Read-only evidence collection. This module has no WebDriver or Local capability.
export const retainedSessionIds = [
  'b7c91146c925ed5d98567eb41cb43e7eeac5900b',
  '2a80cede7b3faa3d2c0e64eb295b9175c2406b9b',
  '65a1f6569b467ee40f62d591c8a931e7029f7620',
  '12a1af12bf9dfd03d7f62325dda0f784abd1439c',
  '19fe182c1aa612a5db508de9e9593cac2e227cc7',
  '81a4cba3033bb2760f11bbe801b94a569b4ba6f4',
] as const;

export const quotaLimits = Object.freeze({ totalMs: 60_000, requestMs: 8_000, bytes: 65_536 });
type Row = Record<string, unknown>;
type Observation<T> =
  { outcome: 'available'; data: T } | { outcome: 'unavailable'; reason: string };
type Plan = {
  parallelSessionsAllowed: number;
  runningSessions: number | null;
  queuedSessions: number | null;
};
type Session = {
  durationSeconds: number | null;
  providerStatus: string;
  executionStatus: string;
  createdAt: string | null;
};

function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-response');
  return value as Row;
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function plan(value: unknown): Plan {
  const data = row(value);
  const allowed = count(data.parallel_sessions_max_allowed);
  if (allowed === null) throw new Error('invalid-response');
  return {
    parallelSessionsAllowed: allowed,
    runningSessions: count(data.parallel_sessions_running),
    queuedSessions: count(data.queued_sessions),
  };
}
function session(value: unknown, expectedId: string): Session {
  const data = row(row(value).automation_session);
  if (data.hashed_id !== expectedId) throw new Error('session-identity-mismatch');
  const duration = data.duration;
  const timestamp =
    typeof data.created_at === 'string' &&
    data.created_at.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}[T ][\d:.+Z -]+$/.test(data.created_at)
      ? Date.parse(data.created_at)
      : NaN;
  return {
    durationSeconds:
      typeof duration === 'number' &&
      Number.isFinite(duration) &&
      duration >= 0 &&
      duration <= Number.MAX_SAFE_INTEGER
        ? duration
        : null,
    providerStatus:
      typeof data.status === 'string' &&
      /^(done|passed|failed|error|timeout|running|queued|unmarked)$/.test(data.status)
        ? data.status
        : 'unknown',
    executionStatus:
      typeof data.browserstack_status === 'string' &&
      /^(done|error|timeout|running|queued)$/.test(data.browserstack_status)
        ? data.browserstack_status
        : 'unknown',
    createdAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
  };
}
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(http-\d{3}|invalid-response|response-too-large|request-timeout|deadline-exceeded|session-identity-mismatch)$/.test(
    message,
  )
    ? message
    : 'request-failed';
}

export async function collectQuotaEvidence(options: {
  username: string;
  accessKey: string;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const overallDeadline = started + quotaLimits.totalMs;
  const overall = new AbortController();
  const totalTimer = setTimeout(() => overall.abort(), quotaLimits.totalMs);
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.accessKey}`).toString('base64')}`;

  async function read<T>(path: string, parse: (value: unknown) => T): Promise<Observation<T>> {
    if (!options.username || !options.accessKey)
      return { outcome: 'unavailable', reason: 'missing-credentials' };
    const remaining = overallDeadline - now();
    if (overall.signal.aborted || remaining <= 0)
      return { outcome: 'unavailable', reason: 'deadline-exceeded' };
    const controller = new AbortController();
    const end = Math.min(overallDeadline, now() + quotaLimits.requestMs);
    const timeout = setTimeout(() => controller.abort(), Math.max(0, end - now()));
    const signal = AbortSignal.any([overall.signal, controller.signal]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    let rejectAbort: () => void = () => {};
    const abort = new Promise<never>((_, reject) => {
      rejectAbort = () =>
        reject(new Error(overall.signal.aborted ? 'deadline-exceeded' : 'request-timeout'));
      signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const active = () => {
      if (overall.signal.aborted || now() >= overallDeadline) throw new Error('deadline-exceeded');
      if (signal.aborted || now() >= end) throw new Error('request-timeout');
    };
    async function request() {
      // Every caller uses a fixed local path; there is no caller-supplied URL/method.
      const received = await fetcher(`https://api.browserstack.com/automate/${path}`, {
        method: 'GET',
        headers: { Authorization: authorization, Accept: 'application/json' },
        redirect: 'error',
        signal,
      }).then((value) => {
        if (signal.aborted) void value.body?.cancel().catch(() => {});
        return value;
      });
      response = received;
      active();
      if (!received.ok) {
        void received.body?.cancel().catch(() => {});
        throw new Error(`http-${received.status}`);
      }
      const length = received.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > quotaLimits.bytes)) {
        void received.body?.cancel().catch(() => {});
        throw new Error('response-too-large');
      }
      if (!received.body) throw new Error('invalid-response');
      reader = received.body.getReader();
      const body = Buffer.alloc(quotaLimits.bytes);
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        active();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > quotaLimits.bytes) throw new Error('response-too-large');
        body.set(chunk.value, bytes - chunk.value.byteLength);
      }
      let value: unknown;
      try {
        value = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, bytes)),
        );
      } catch {
        throw new Error('invalid-response');
      }
      const data = parse(value);
      active();
      return data;
    }
    try {
      // Race the entire operation once; per-chunk races retain abort listeners
      // for every fragment and defeat bounded buffering on a fragmented stream.
      const data = await Promise.race([request(), abort]);
      active();
      return { outcome: 'available', data };
    } catch (error) {
      return { outcome: 'unavailable', reason: reason(error) };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', rejectAbort);
      controller.abort();
      // Do not wait on a hostile stream's cancellation promise beyond the deadline.
      if (reader) void reader.cancel().catch(() => {});
      else void response?.body?.cancel().catch(() => {});
    }
  }

  try {
    const planEvidence = await read('plan.json', plan);
    const sessions: { sessionId: string; evidence: Observation<Session> }[] = [];
    for (const id of retainedSessionIds) {
      sessions.push({
        sessionId: id,
        evidence: await read(`sessions/${id}.json`, (value) => session(value, id)),
      });
    }
    const complete =
      planEvidence.outcome === 'available' &&
      sessions.every(
        ({ evidence }) =>
          evidence.outcome === 'available' &&
          evidence.data.durationSeconds !== null &&
          evidence.data.createdAt !== null &&
          !['running', 'queued', 'unknown'].includes(evidence.data.providerStatus) &&
          ['done', 'error', 'timeout'].includes(evidence.data.executionStatus),
      );
    return {
      mode: 'quota',
      scope: 'Seven read-only requests for Plan and the six retained smoke sessions',
      status: complete ? 'passed' : 'failed',
      plan: planEvidence,
      sessions,
      coverage: 'six-retained-smoke-sessions-only',
      accountWideHistory: 'unknown',
      chargedDurationMapping: 'unverified',
      remainingMinutes: null,
      completeOfflineMatrixCostMinutes: null,
      allocationAllowed: false,
      usageReports: 'not-requested-report-creation-required-no-documented-Automate-minute-balance',
    };
  } finally {
    clearTimeout(totalTimer);
  }
}
