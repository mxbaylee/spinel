/** Versioned history certificates are facts about PR events, never code passes.
 * Only a genuine policy job's successful history steps can issue one. */
export interface HistoryCheckpoint {
  sequence: number;
  full: boolean;
  after: number | null;
  atOrAfter: number | null;
}

export const historyValidationStep = 'Validate PR history v2';
const markerPrefix = 'PR history v2 ';
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const executed = (value: Record<string, unknown>) =>
  (value.status === 'in_progress' && value.conclusion === null) ||
  (value.status === 'completed' &&
    ['success', 'failure', 'cancelled', 'timed_out', 'action_required'].includes(
      String(value.conclusion),
    ));
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
const time = (value: unknown): number | null => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'))
    ? parsed
    : null;
};

export function historyCheckpointMarker(checkpoint: HistoryCheckpoint): string {
  if (
    !positive(checkpoint.sequence) ||
    typeof checkpoint.full !== 'boolean' ||
    (checkpoint.full ? !positive(checkpoint.after) : checkpoint.after !== null) ||
    (checkpoint.atOrAfter !== null && !positive(checkpoint.atOrAfter)) ||
    (!checkpoint.full && checkpoint.atOrAfter !== null)
  )
    throw new Error('Only complete history with a known full-request boundary can be sealed.');
  return `${markerPrefix}seq=${checkpoint.sequence} full=${checkpoint.full ? 1 : 0} after=${checkpoint.after ?? 0} notify=${checkpoint.atOrAfter ?? 0}`;
}

export function parseHistoryCheckpointMarker(name: unknown): HistoryCheckpoint | null {
  if (typeof name !== 'string' || !name.startsWith(markerPrefix)) return null;
  const match =
    /^PR history v2 seq=([1-9][0-9]*) full=([01]) after=(0|[1-9][0-9]*) notify=(0|[1-9][0-9]*)$/.exec(
      name,
    );
  if (!match || match[0] !== name) throw new Error('Malformed history checkpoint marker.');
  const result = {
    sequence: Number(match[1]),
    full: match[2] === '1',
    after: match[3] === '0' ? null : Number(match[3]),
    atOrAfter: match[4] === '0' ? null : Number(match[4]),
  };
  if (historyCheckpointMarker(result) !== name) throw new Error('Noncanonical history checkpoint.');
  return result;
}

/** Source/base/tested are issuer provenance; a later push may inherit the PR's
 * history, but still has to independently admit its own genuine code results.
 * The consumer must additionally prove a contiguous global sequence suffix. */
export function verifyHistoryCheckpoint(
  run: unknown,
  job: unknown,
  check: unknown,
  expected: {
    repository: string;
    number: number;
    workflowId: number;
    createdAt: string;
    upperSequence: number;
    currentRunId?: number;
    currentAttempt?: number;
  },
): HistoryCheckpoint | null {
  if (!object(job) || !Array.isArray(job.steps)) return null;
  const markers = job.steps.filter(
    (step) => object(step) && typeof step.name === 'string' && step.name.startsWith(markerPrefix),
  );
  if (!markers.length) return null;
  const bad = () => {
    throw new Error('History checkpoint issuer, proof or coverage is invalid.');
  };
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expected.repository) ||
    !positive(expected.number) ||
    !positive(expected.workflowId) ||
    !positive(expected.upperSequence) ||
    ((expected.currentRunId !== undefined || expected.currentAttempt !== undefined) &&
      (!positive(expected.currentRunId) || !positive(expected.currentAttempt)))
  )
    return bad();
  const created = time(expected.createdAt);
  if (created === null || !object(run) || !object(check)) return bad();
  const identity =
    typeof run.display_title === 'string'
      ? /^PR policy v2 pr=([1-9][0-9]*) action=(opened|edited|synchronize|reopened|labeled|unlabeled) base=([a-f0-9]{40}) head=([a-f0-9]{40}) tested=([a-f0-9]{40})$/.exec(
          run.display_title,
        )
      : null;
  if (
    !identity ||
    identity[0] !== run.display_title ||
    Number(identity[1]) !== expected.number ||
    ![identity[3], identity[4], identity[5]].every(sha) ||
    run.head_sha !== identity[4] ||
    !positive(run.id) ||
    !positive(run.run_number) ||
    !positive(run.run_attempt) ||
    !positive(run.check_suite_id) ||
    run.workflow_id !== expected.workflowId ||
    run.path !== '.github/workflows/pr-policy.yml' ||
    run.event !== 'pull_request' ||
    !object(run.repository) ||
    run.repository.full_name !== expected.repository ||
    !Array.isArray(run.pull_requests) ||
    run.pull_requests.length !== 1 ||
    !object(run.pull_requests[0]) ||
    run.pull_requests[0].number !== expected.number ||
    !positive(job.id) ||
    job.run_id !== run.id ||
    !positive(job.run_attempt) ||
    job.run_attempt > run.run_attempt ||
    job.head_sha !== run.head_sha ||
    job.name !== 'Pull request' ||
    (run.id === expected.currentRunId && job.run_attempt >= (expected.currentAttempt ?? 0)) ||
    !positive(check.id) ||
    !executed(job) ||
    !executed(check) ||
    check.name !== job.name ||
    check.head_sha !== run.head_sha ||
    !object(check.check_suite) ||
    check.check_suite.id !== run.check_suite_id ||
    !object(check.app) ||
    check.app.id !== 15368 ||
    job.check_run_url !==
      `https://api.github.com/repos/${expected.repository}/check-runs/${check.id}`
  )
    return bad();
  const validations = job.steps.filter(
    (step) => object(step) && step.name === historyValidationStep,
  );
  if (
    markers.length !== 1 ||
    validations.length !== 1 ||
    job.steps.some((step) => !object(step) || typeof step.name !== 'string')
  )
    return bad();
  const marker = markers[0] as Record<string, unknown>;
  const validation = validations[0] as Record<string, unknown>;
  for (const step of [validation, marker]) {
    if (step.status !== 'completed' || step.conclusion !== 'success' || !positive(step.number))
      return bad();
  }
  const issued = time(marker.completed_at);
  const validated = time(validation.completed_at);
  const started = time(run.created_at);
  if (
    issued === null ||
    validated === null ||
    started === null ||
    started < created ||
    validated < started ||
    issued < validated ||
    Number(marker.number) <= Number(validation.number)
  )
    return bad();
  const checkpoint = parseHistoryCheckpointMarker(marker.name)!;
  if (
    checkpoint.sequence < run.run_number ||
    checkpoint.sequence > expected.upperSequence ||
    [checkpoint.after, checkpoint.atOrAfter].some(
      (bound) => bound !== null && (bound < created || bound > validated),
    )
  )
    return bad();
  return checkpoint;
}

export interface PolicyHistoryWindow {
  runs: Record<string, unknown>[];
  upperSequence: number;
  throughSequence: number;
  checkpoint: HistoryCheckpoint | null;
  boundary: 'predecessor' | 'opening' | 'checkpoint';
}

/** Read global, unfiltered registration history. A missing sequence is never
 * interpreted as an unrelated PR. Reads stay bounded and detect page shifts.
 * Opening provenance and checkpoint authentication are caller-owned proofs. */
export async function readPolicyHistoryWindow(
  client: { repository: string; get(path: string): Promise<unknown> },
  expected: {
    workflowId: number;
    createdAt: string;
    currentRun?: { id: number; sequence: number };
    isOpening(run: Record<string, unknown>): Promise<boolean>;
    checkpoint(
      run: Record<string, unknown>,
      upperSequence: number,
    ): Promise<HistoryCheckpoint | null>;
  },
): Promise<PolicyHistoryWindow> {
  const created = time(expected.createdAt);
  if (
    !positive(expected.workflowId) ||
    created === null ||
    (expected.currentRun &&
      (!positive(expected.currentRun.id) || !positive(expected.currentRun.sequence)))
  )
    throw new Error('Invalid policy-history range.');
  if (expected.currentRun) {
    const current = await client.get(`actions/runs/${expected.currentRun.id}`);
    if (
      !object(current) ||
      current.id !== expected.currentRun.id ||
      current.run_number !== expected.currentRun.sequence ||
      current.workflow_id !== expected.workflowId ||
      current.path !== '.github/workflows/pr-policy.yml' ||
      !object(current.repository) ||
      current.repository.full_name !== client.repository
    )
      throw new Error('The current policy invocation has no verified registration.');
  }
  const runs: Record<string, unknown>[] = [];
  const ids = new Set<number>();
  const sequences = new Map<number, number>();
  const observedCheckpoints: HistoryCheckpoint[] = [];
  const endpoint = `actions/workflows/${expected.workflowId}/runs?per_page=100&page=`;
  let firstPage = '';
  let upperSequence = 0;
  let previousSequence = Number.POSITIVE_INFINITY;
  let previousCreated = Number.POSITIVE_INFINITY;
  const pageRuns = (raw: unknown): Record<string, unknown>[] => {
    if (
      !object(raw) ||
      !Array.isArray(raw.workflow_runs) ||
      raw.workflow_runs.length > 100 ||
      typeof raw.total_count !== 'number' ||
      !Number.isSafeInteger(raw.total_count) ||
      raw.total_count < raw.workflow_runs.length ||
      raw.workflow_runs.some((run) => !object(run))
    )
      throw new Error('Policy-history page is malformed.');
    return raw.workflow_runs as Record<string, unknown>[];
  };
  const fingerprint = (page: Record<string, unknown>[]) =>
    JSON.stringify(page.map((run) => [run.id, run.run_number, run.run_attempt]));
  const completeSuffix = (throughSequence: number) => {
    if (upperSequence - throughSequence > runs.length) return false;
    for (let sequence = throughSequence + 1; sequence <= upperSequence; sequence++)
      if (!sequences.has(sequence)) return false;
    return true;
  };
  const finish = async (
    throughSequence: number,
    boundary: PolicyHistoryWindow['boundary'],
    checkpoint: HistoryCheckpoint | null,
  ): Promise<PolicyHistoryWindow> => {
    // At most 1,000 records were read; never loop over an attacker-sized range.
    if (!completeSuffix(throughSequence))
      throw new Error('Policy history has a missing registered run.');
    if (
      checkpoint &&
      observedCheckpoints.some(
        (observed) =>
          observed.full &&
          (!checkpoint.full ||
            Number(checkpoint.after) < Number(observed.after) ||
            Number(checkpoint.atOrAfter) < Number(observed.atOrAfter)),
      )
    )
      throw new Error('A covering history checkpoint weakens an observed full requirement.');
    if (expected.currentRun) {
      if (
        expected.currentRun.sequence > upperSequence ||
        (expected.currentRun.sequence > throughSequence &&
          sequences.get(expected.currentRun.sequence) !== expected.currentRun.id)
      )
        throw new Error('The current policy invocation is not included in history.');
    }
    if (fingerprint(pageRuns(await client.get(endpoint + '1'))) !== firstPage)
      throw new Error('Policy history changed during pagination; read the current sequence again.');
    return {
      runs: runs.filter((run) => Number(run.run_number) > throughSequence),
      upperSequence,
      throughSequence,
      checkpoint,
      boundary,
    };
  };
  for (let page = 1; page <= 10; page++) {
    const batch = pageRuns(await client.get(endpoint + page));
    if (page === 1) firstPage = fingerprint(batch);
    for (const run of batch) {
      const started = time(run.created_at);
      if (
        !positive(run.id) ||
        !positive(run.run_number) ||
        !positive(run.run_attempt) ||
        run.workflow_id !== expected.workflowId ||
        run.path !== '.github/workflows/pr-policy.yml' ||
        !object(run.repository) ||
        run.repository.full_name !== client.repository ||
        started === null ||
        started > previousCreated ||
        ids.has(run.id) ||
        sequences.has(run.run_number) ||
        run.run_number >= previousSequence
      )
        throw new Error('Policy history has foreign, duplicate, malformed or reordered records.');
      upperSequence ||= run.run_number;
      previousSequence = run.run_number;
      previousCreated = started;
      ids.add(run.id);
      sequences.set(run.run_number, run.id);
      runs.push(run);
      const checkpoint = await expected.checkpoint(run, upperSequence);
      if (checkpoint) {
        historyCheckpointMarker(checkpoint);
        observedCheckpoints.push(checkpoint);
        if (checkpoint.sequence < run.run_number || checkpoint.sequence > upperSequence)
          throw new Error('The history checkpoint covers an invalid sequence.');
        // An older issuer can finish later and cover more registered events.
        // Do not reject available evidence merely because this anchor is weak.
        if (completeSuffix(checkpoint.sequence))
          return finish(checkpoint.sequence, 'checkpoint', checkpoint);
      }
      if (started < created) return finish(run.run_number, 'predecessor', null);
      if (run.run_number === 1 && (await expected.isOpening(run)))
        return finish(0, 'opening', null);
    }
    if (batch.length < 100) break;
  }
  throw new Error('A complete policy-history prefix is unavailable within the bounded read.');
}

export interface PolicyInvocation {
  id: number;
  sequence: number;
  attempt: number;
  action: string;
  base: string;
  head: string;
  tested: string;
}
export function parsePolicyRunName(name: unknown) {
  if (typeof name !== 'string') return null;
  const match =
    /^PR policy v([12]) pr=([1-9][0-9]*) action=(opened|edited|synchronize|reopened|labeled|unlabeled)(?: base=([a-f0-9]{40}) head=([a-f0-9]{40}) tested=([a-f0-9]{40}))?$/.exec(
      name,
    );
  if (
    !match ||
    match[0] !== name ||
    !positive(Number(match[2])) ||
    (match[1] === '2' ? ![match[4], match[5], match[6]].every(sha) : match[4] !== undefined)
  )
    return null;
  return {
    version: Number(match[1]),
    number: Number(match[2]),
    action: match[3],
    base: match[4],
    head: match[5],
    tested: match[6],
  };
}

const v1RunName =
  'run-name: PR policy v1 pr=${{ github.event.pull_request.number }} action=${{ github.event.action }}';
export const policyRunNameV2 =
  'run-name: PR policy v2 pr=${{ github.event.pull_request.number }} action=${{ github.event.action }} base=${{ github.event.pull_request.base.sha }} head=${{ github.event.pull_request.head.sha }} tested=${{ github.sha }}';

/** Opening/checkpoint provenance uses provider-owned identities and supported
 * reviewed workflow contracts. It assumes repository workflow changes receive
 * the independent source review required by process.md; it is not a signature
 * service resisting an administrator who can replace the verifier itself. */
export async function authenticatedPolicyHistory(
  client: {
    repository: string;
    get(path: string): Promise<unknown>;
    list(path: string, key: string): Promise<unknown[]>;
  },
  expected: {
    number: number;
    createdAt: string;
    workflowId: number;
    invocation?: PolicyInvocation;
  },
): Promise<PolicyHistoryWindow> {
  const invocation = expected.invocation;
  const jobs = new Map<number, Promise<unknown[]>>();
  const runJobs = (id: number) => {
    let pending = jobs.get(id);
    if (!pending) {
      pending = client.list(`actions/runs/${id}/jobs?filter=all`, 'jobs');
      jobs.set(id, pending);
    }
    return pending;
  };
  const associated = (run: Record<string, unknown>) =>
    Array.isArray(run.pull_requests) &&
    run.pull_requests.length === 1 &&
    object(run.pull_requests[0]) &&
    run.pull_requests[0].number === expected.number;
  if (invocation) {
    const run = await client.get(`actions/runs/${invocation.id}`);
    const identity = object(run) ? parsePolicyRunName(run.display_title) : null;
    if (
      !object(run) ||
      !identity ||
      identity.version !== 2 ||
      identity.number !== expected.number ||
      identity.action !== invocation.action ||
      identity.base !== invocation.base ||
      identity.head !== invocation.head ||
      identity.tested !== invocation.tested ||
      run.head_sha !== invocation.head ||
      run.event !== 'pull_request' ||
      !associated(run) ||
      !positive(invocation.attempt) ||
      !positive(run.run_attempt) ||
      run.run_attempt !== invocation.attempt
    )
      throw new Error('The current policy event does not match its registered immutable identity.');
  }
  return readPolicyHistoryWindow(client, {
    workflowId: expected.workflowId,
    createdAt: expected.createdAt,
    currentRun: invocation ? { id: invocation.id, sequence: invocation.sequence } : undefined,
    async isOpening(run) {
      const identity = parsePolicyRunName(run.display_title);
      if (
        run.run_number !== 1 ||
        !identity ||
        identity.number !== expected.number ||
        identity.action !== 'opened' ||
        run.event !== 'pull_request' ||
        !associated(run) ||
        !sha(run.head_sha) ||
        !positive(run.check_suite_id) ||
        (identity.version === 2 && identity.head !== run.head_sha)
      )
        return false;
      const suite = await client.get(`check-suites/${run.check_suite_id}`);
      if (
        !object(suite) ||
        suite.id !== run.check_suite_id ||
        !object(suite.app) ||
        suite.app.id !== 15368 ||
        suite.head_sha !== run.head_sha
      )
        throw new Error('The initial policy opening lacks its genuine Actions suite.');
      const source = await client.get(
        `contents/.github/workflows/pr-policy.yml?ref=${run.head_sha}`,
      );
      if (
        !object(source) ||
        source.type !== 'file' ||
        source.path !== '.github/workflows/pr-policy.yml' ||
        source.encoding !== 'base64' ||
        typeof source.content !== 'string' ||
        source.content.length > 64 * 1024
      )
        throw new Error('The initial policy workflow contract is unavailable.');
      const content = Buffer.from(source.content, 'base64').toString('utf8');
      const names = content.split('\n').filter((line) => /^\s*run-name:/.test(line));
      if (names.length !== 1 || names[0] !== (identity.version === 1 ? v1RunName : policyRunNameV2))
        throw new Error(
          'The initial policy event was not bound by the supported workflow contract.',
        );
      return true;
    },
    async checkpoint(run, upperSequence) {
      const identity = parsePolicyRunName(run.display_title);
      if (!identity || identity.number !== expected.number || identity.version !== 2) return null;
      const records = await runJobs(Number(run.id));
      const candidates: HistoryCheckpoint[] = [];
      for (const job of records) {
        if (!object(job) || job.name !== 'Pull request' || !Array.isArray(job.steps)) continue;
        if (invocation && run.id === invocation.id && Number(job.run_attempt) >= invocation.attempt)
          continue;
        const marker = job.steps.some(
          (step) =>
            object(step) && typeof step.name === 'string' && step.name.startsWith('PR history '),
        );
        if (!marker) continue;
        if (
          identity.version !== 2 ||
          job.steps.some(
            (step) =>
              object(step) &&
              typeof step.name === 'string' &&
              step.name.startsWith('PR history ') &&
              !step.name.startsWith(markerPrefix),
          )
        )
          throw new Error('Unsupported history certificate protocol.');
        const checkId =
          typeof job.check_run_url === 'string'
            ? new RegExp(
                `^https://api\\.github\\.com/repos/${client.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/check-runs/([1-9][0-9]*)$`,
              ).exec(job.check_run_url)?.[1]
            : undefined;
        if (!checkId || !positive(Number(checkId)))
          throw new Error('History certificate check identity is unavailable.');
        const check = await client.get(`check-runs/${checkId}`);
        const checkpoint = verifyHistoryCheckpoint(run, job, check, {
          repository: client.repository,
          number: expected.number,
          workflowId: expected.workflowId,
          createdAt: expected.createdAt,
          upperSequence,
          currentRunId: invocation?.id,
          currentAttempt: invocation?.attempt,
        });
        if (!checkpoint) throw new Error('History certificate has no supported proof.');
        candidates.push(checkpoint);
      }
      if (!candidates.length) return null;
      const accepted = candidates.find((candidate) =>
        candidates.every(
          (other) =>
            candidate.sequence >= other.sequence &&
            (!other.full ||
              (candidate.full &&
                Number(candidate.after) >= Number(other.after) &&
                Number(candidate.atOrAfter) >= Number(other.atOrAfter))),
        ),
      );
      if (!accepted) throw new Error('History certificates in one issuer conflict.');
      return accepted;
    },
  });
}
