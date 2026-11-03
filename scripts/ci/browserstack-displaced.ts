/** Report-only view of runs that never reached a runner.
 *
 * The account-wide concurrency group keeps one pending run and cancels an older
 * pending run when a newer one joins, without failing anything. A cancelled run
 * in which no job was assigned a runner spent no device time; it was displaced
 * by a concurrency group (diagnostics have their own) or cancelled by hand
 * before starting, which the API cannot tell apart. This never grants or refuses
 * allocation; it can hold the capability job back by at most its 10 s bound.
 */
import { monthlyScopes } from './browserstack-budget.ts';
import { readJsonBody } from './browserstack-ledger.ts';

export type DisplacedRun = { id: number; event: string; title: string; createdAt: string };
export type DisplacedReport =
  | { status: 'available'; since: string; runs: DisplacedRun[]; unread: number }
  | { status: 'unavailable'; reason: string };

const events = new Set(['schedule', 'workflow_dispatch', 'pull_request']);
const maxRuns = 10;
const maxBytes = 512 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function displacedRuns(options: {
  repository: string;
  token: string;
  currentRunId: string;
  fetcher?: typeof fetch;
  now?: Date;
  requestTimeoutMs?: number;
}): Promise<DisplacedReport> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(options.repository) ||
    !options.token
  )
    return { status: 'unavailable', reason: 'missing-credentials' };
  const fetcher = options.fetcher ?? fetch;
  const api = `https://api.github.com/repos/${options.repository}/actions`;
  // One month covers the previous scheduled run as well as recent label runs.
  const since = new Date((options.now ?? new Date()).getTime() - 31 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const overall = AbortSignal.timeout(10_000);
  async function read(path: string): Promise<Record<string, unknown>> {
    const signal = AbortSignal.any([
      overall,
      AbortSignal.timeout(options.requestTimeoutMs ?? 5_000),
    ]);
    let response: Response;
    try {
      response = await fetcher(`${api}/${path}`, {
        method: 'GET',
        signal,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch {
      throw new Error('request-failed');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`http-${response.status}`);
    }
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      void response.body?.cancel().catch(() => {});
      throw new Error('response-too-large');
    }
    // The ledger's streaming reader stops at the cap even without a declared length.
    const value = await readJsonBody(response, signal, maxBytes);
    if (!object(value)) throw new Error('invalid-response');
    return value;
  }
  try {
    const listed = await read(
      `workflows/browserstack.yml/runs?status=cancelled&created=%3E%3D${since}&per_page=${maxRuns}`,
    );
    if (
      !Array.isArray(listed.workflow_runs) ||
      !Number.isSafeInteger(listed.total_count) ||
      (listed.total_count as number) < listed.workflow_runs.length
    )
      throw new Error('invalid-response');
    const runs: DisplacedRun[] = [];
    for (const run of listed.workflow_runs.slice(0, maxRuns)) {
      if (
        !object(run) ||
        !Number.isSafeInteger(run.id) ||
        typeof run.event !== 'string' ||
        typeof run.created_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(run.created_at)
      )
        throw new Error('invalid-response');
      if (String(run.id) === options.currentRunId || !events.has(run.event)) continue;
      // Every attempt: a re-run may be displaced after an earlier attempt used devices.
      const listedJobs = await read(`runs/${run.id}/jobs?filter=all&per_page=50`);
      // An unread job could have had a runner, so a partial list is refused.
      if (
        !Array.isArray(listedJobs.jobs) ||
        !listedJobs.jobs.every(object) ||
        listedJobs.total_count !== listedJobs.jobs.length
      )
        throw new Error('invalid-response');
      // Any job with a runner may have started provider work; it is not displaced.
      if (listedJobs.jobs.some((job) => typeof job.runner_name === 'string' && job.runner_name))
        continue;
      // The title tells a lost acceptance run from an unrelated label run. It is
      // reduced to a few characters with no backtick and shown as a code span, so
      // it cannot add emphasis, links or structure to the summary.
      const title =
        typeof run.display_title === 'string'
          ? run.display_title
              .replace(/[^\w .,:/#@+=-]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 80)
          : '';
      runs.push({ id: run.id as number, event: run.event, title, createdAt: run.created_at });
    }
    const unread = Math.max(0, (listed.total_count as number) - maxRuns);
    return { status: 'available', since, runs, unread };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    return {
      status: 'unavailable',
      reason: /^(http-\d{3}|[a-z-]+)$/.test(reason) ? reason : 'request-failed',
    };
  }
}

// A scheduled run's title names its scope; an unreadable title names every monthly scope.
function lostScope(run: { title: string }): string {
  const scope = /^BrowserStack monthly ([a-z-]+)$/.exec(run.title)?.[1];
  return monthlyScopes.some((entry) => entry.scope === scope)
    ? scope!
    : monthlyScopes.map((entry) => entry.scope).join(' or ');
}

export function displacedSummary(report: DisplacedReport, repository: string): string[] {
  const lines = ['## Runs cancelled before any job started', ''];
  if (report.status === 'unavailable')
    return [...lines, `- Unavailable (${report.reason}); check the group by hand.`, ''];
  return [
    ...lines,
    ...(report.runs.length
      ? report.runs.map(
          (run) =>
            `- [${run.id}](https://github.com/${repository}/actions/runs/${run.id}): ${run.event}${run.title ? ` (\`${run.title}\`)` : ''}, created ${run.createdAt}. No device time; ${run.event === 'schedule' ? `**the monthly acceptance run was lost; dispatch \`${lostScope(run)}\` unless already re-dispatched**` : 're-dispatch if it was still needed'}.`,
        )
      : [`- None since ${report.since}${report.unread ? ' among the newest ' + maxRuns : ''}.`]),
    ...(report.unread
      ? [`- ${report.unread} older cancelled runs were not read; check them by hand.`]
      : []),
    '',
    'A cancelled run with no runner was displaced by a concurrency group (the account lock, or the diagnostics group for a diagnostics run) or cancelled by hand; this report does not affect admission. A re-run whose earlier attempt reached a runner is not listed.',
    '',
  ];
}

/** Run-page annotations for lost monthly runs; the message carries only the numeric id. */
export function displacedWarnings(report: DisplacedReport): string[] {
  if (report.status !== 'available') return [];
  return report.runs
    .filter((run) => run.event === 'schedule')
    .map(
      (run) =>
        `::warning title=Monthly BrowserStack run lost::Scheduled run ${run.id} was cancelled before any job started; dispatch ${lostScope(run)} unless already re-dispatched.`,
    );
}
