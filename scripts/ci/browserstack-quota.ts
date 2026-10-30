// Read-only evidence collection. This module has no WebDriver or Local capability.
export const retainedSessionIds = [
  'b7c91146c925ed5d98567eb41cb43e7eeac5900b',
  '2a80cede7b3faa3d2c0e64eb295b9175c2406b9b',
  '65a1f6569b467ee40f62d591c8a931e7029f7620',
  '12a1af12bf9dfd03d7f62325dda0f784abd1439c',
  '19fe182c1aa612a5db508de9e9593cac2e227cc7',
  '81a4cba3033bb2760f11bbe801b94a569b4ba6f4',
] as const;

export const quotaLimits = Object.freeze({
  totalMs: 60_000,
  requestMs: 8_000,
  bytes: 65_536,
  requests: 64,
  pageSize: 10,
  builds: 50,
  sessions: 200,
});
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

type Pagination = { pages: number; outcome: 'exhausted' | 'partial'; reason: string | null };
type SessionEvidence = {
  sessionId: string;
  buildIds: string[];
  observations: {
    source: 'retained-smoke' | 'build-list' | 'detail';
    evidence: Observation<Session>;
  }[];
  conflict: boolean;
};
const providerStatus = (value: unknown) =>
  typeof value === 'string' &&
  /^(done|passed|failed|error|timeout|running|queued|unmarked)$/.test(value)
    ? value
    : 'unknown';
const terminal = (value: Session) =>
  value.durationSeconds !== null &&
  value.createdAt !== null &&
  !['running', 'queued', 'unknown'].includes(value.providerStatus) &&
  ['done', 'error', 'timeout'].includes(value.executionStatus);
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value))
    throw new Error('invalid-response');
  return value;
};
const conflicts = (a: Session, b: Session) =>
  (Object.keys(a) as (keyof Session)[]).some(
    (key) =>
      a[key] !== null &&
      b[key] !== null &&
      a[key] !== 'unknown' &&
      b[key] !== 'unknown' &&
      a[key] !== b[key],
  );

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
    providerStatus: providerStatus(data.status),
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
  return /^(http-\d{3}|invalid-response|response-too-large|request-timeout|deadline-exceeded|request-limit|session-identity-mismatch)$/.test(
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
  let requests = 0;
  const overall = new AbortController();
  const totalTimer = setTimeout(() => overall.abort(), quotaLimits.totalMs);
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.accessKey}`).toString('base64')}`;

  async function read<T>(path: string, parse: (value: unknown) => T): Promise<Observation<T>> {
    if (!options.username || !options.accessKey)
      return { outcome: 'unavailable', reason: 'missing-credentials' };
    const remaining = overallDeadline - now();
    if (overall.signal.aborted || remaining <= 0)
      return { outcome: 'unavailable', reason: 'deadline-exceeded' };
    if (requests >= quotaLimits.requests)
      return { outcome: 'unavailable', reason: 'request-limit' };
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
      // Paths use only local endpoints, validated IDs and bounded numeric offsets.
      active();
      requests++;
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
    // Keep pagination progress separate from this map: a page containing the
    // six already observed IDs still advances that build's retained listing.
    const observed = new Map<string, SessionEvidence>(
      sessions.map(({ sessionId, evidence }) => [
        sessionId,
        {
          sessionId,
          buildIds: [],
          observations: [{ source: 'retained-smoke', evidence }],
          conflict: false,
        },
      ]),
    );
    const observe = (
      entry: SessionEvidence,
      source: SessionEvidence['observations'][number]['source'],
      evidence: Observation<Session>,
    ) => {
      if (evidence.outcome === 'available')
        for (const previous of entry.observations)
          if (
            previous.evidence.outcome === 'available' &&
            conflicts(previous.evidence.data, evidence.data)
          )
            entry.conflict = true;
      const observation = { source, evidence };
      if (
        !entry.observations.some(
          (previous) => JSON.stringify(previous) === JSON.stringify(observation),
        )
      )
        entry.observations.push(observation);
    };
    async function paginate<T>(
      path: (offset: number) => string,
      parse: (value: unknown) => T,
      id: (value: T) => string,
      accept: (value: T) => string | null,
    ): Promise<Pagination> {
      const seen = new Set<string>();
      let pages = 0,
        offset = 0;
      while (true) {
        const page = await read(path(offset), (value) => {
          if (!Array.isArray(value) || value.length > quotaLimits.pageSize)
            throw new Error('invalid-response');
          return value.map(parse);
        });
        if (page.outcome === 'unavailable')
          return { pages, outcome: 'partial', reason: page.reason };
        pages++;
        let progress = 0;
        for (const value of page.data) {
          const key = id(value);
          if (!seen.has(key)) {
            seen.add(key);
            progress++;
          }
          const failure = accept(value);
          if (failure) return { pages, outcome: 'partial', reason: failure };
        }
        if (page.data.length < quotaLimits.pageSize)
          return { pages, outcome: 'exhausted', reason: null };
        if (!progress) return { pages, outcome: 'partial', reason: 'pagination-no-progress' };
        offset += page.data.length;
      }
    }
    const builds = new Map<
      string,
      {
        buildId: string;
        providerStatuses: string[];
        conflict: boolean;
        sessionIds: string[];
        pagination: Pagination;
      }
    >();
    const buildPagination = await paginate(
      (offset) => `builds.json?limit=${quotaLimits.pageSize}&offset=${offset}`,
      (value) => {
        const data = row(row(value).automation_build);
        return { buildId: identifier(data.hashed_id), status: providerStatus(data.status) };
      },
      (value) => value.buildId,
      ({ buildId, status }) => {
        if (!builds.has(buildId)) {
          if (builds.size >= quotaLimits.builds) return 'build-limit';
          builds.set(buildId, {
            buildId,
            providerStatuses: [],
            conflict: false,
            sessionIds: [],
            pagination: { pages: 0, outcome: 'partial', reason: 'not-requested' },
          });
        }
        const build = builds.get(buildId)!;
        if (!build.providerStatuses.includes(status)) build.providerStatuses.push(status);
        build.conflict = build.providerStatuses.filter((status) => status !== 'unknown').length > 1;
        return null;
      },
    );
    for (const build of builds.values()) {
      build.pagination = await paginate(
        (offset) =>
          `builds/${build.buildId}/sessions.json?limit=${quotaLimits.pageSize}&offset=${offset}`,
        (value) => {
          const sessionId = identifier(row(row(value).automation_session).hashed_id);
          return { sessionId, data: session(value, sessionId) };
        },
        (value) => value.sessionId,
        ({ sessionId, data }) => {
          let entry = observed.get(sessionId);
          if (!entry) {
            if (observed.size >= quotaLimits.sessions) return 'session-limit';
            entry = { sessionId, buildIds: [], observations: [], conflict: false };
            observed.set(sessionId, entry);
          }
          if (!entry.buildIds.includes(build.buildId)) entry.buildIds.push(build.buildId);
          if (!build.sessionIds.includes(sessionId)) build.sessionIds.push(sessionId);
          observe(entry, 'build-list', { outcome: 'available', data });
          return null;
        },
      );
    }
    for (const entry of observed.values()) {
      // A known detail failure is retained, never retried. Sparse list responses
      // may need one detail GET; neither a duration alone nor a build duration
      // proves a terminal session's measured usage.
      if (
        entry.observations.some(({ source }) => source === 'retained-smoke') ||
        entry.observations.some(
          ({ evidence }) => evidence.outcome === 'available' && terminal(evidence.data),
        )
      )
        continue;
      observe(
        entry,
        'detail',
        await read(`sessions/${entry.sessionId}.json`, (value) => session(value, entry.sessionId)),
      );
    }
    const history = {
      scope: 'credential-visible-retained-builds-and-sessions',
      snapshot: 'non-atomic',
      buildPagination,
      builds: [...builds.values()],
      sessions: [...observed.values()],
      deadlineExceeded: overall.signal.aborted || now() >= overallDeadline,
    };
    const complete =
      planEvidence.outcome === 'available' &&
      !history.deadlineExceeded &&
      sessions.every(
        ({ evidence }) => evidence.outcome === 'available' && terminal(evidence.data),
      ) &&
      buildPagination.outcome === 'exhausted' &&
      history.builds.every(
        ({ pagination, providerStatuses, conflict }) =>
          pagination.outcome === 'exhausted' &&
          !conflict &&
          providerStatuses.every((status) => !['running', 'queued', 'unknown'].includes(status)),
      ) &&
      history.sessions.every(
        ({ conflict, observations }) =>
          !conflict &&
          observations.every(({ evidence }) => evidence.outcome === 'available') &&
          observations.some(
            ({ evidence }) => evidence.outcome === 'available' && terminal(evidence.data),
          ),
      );
    return {
      mode: 'quota',
      scope:
        'Bounded read-only Plan, six known smoke sessions and retained build/session enumeration',
      status: complete ? 'passed' : 'failed',
      plan: planEvidence,
      sessions,
      history,
      requests,
      limits: quotaLimits,
      coverage: 'credential-visible-retained-records-only-not-lifetime-history',
      expiredOrDeletedHistory: 'unknown',
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
