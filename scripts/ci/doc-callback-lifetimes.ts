/** Read-only accounting of native Doc callback lifetimes in an unmodified CDP trace. */
export type DocCallbackFamily = 'cursor' | 'zoom-init' | 'zoom-update';
export type DocCallbackAttribution = DocCallbackFamily | 'other';

export interface DocCallbackCallsite {
  url: string;
  /** Coordinates exactly as emitted by Chrome's timeline, before source-map conversion. */
  lineNumber: number;
  columnNumber: number;
  family: DocCallbackAttribution;
  sourceUrl?: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export const DOC_CALLBACK_MARKERS = {
  beforeMount: 'spn113-before-mount',
  inputStart: 'spn113-input-start',
  finalKey: 'spn113-final-key',
  disposed: 'spn113-disposed',
  end: 'spn113-end',
} as const;

type Phase = keyof typeof DOC_CALLBACK_MARKERS;
type Span = { startedAtUs: number; durationUs: number };
type TraceEvent = {
  name?: string;
  cat?: string;
  ph?: string;
  pid?: number;
  tid?: number;
  ts?: number;
  dur?: number;
  args?: { data?: Record<string, unknown> };
};

export interface DocCallbackTraceInput {
  traceEvents: unknown[];
  completion: { dataLossOccurred: boolean } | null;
  frameId: string;
  role: 'baselineObservation' | 'candidate';
  callsites: DocCallbackCallsite[];
  markers?: { [K in Phase]: string };
}

export interface DocTimerLifetime {
  pid: number;
  tid: number;
  frame: string;
  timerId: number;
  generation: number;
  family: DocCallbackAttribution | 'unknown';
  callsite: number | null;
  installedAtUs: number;
  timeoutMs: number;
  singleShot: boolean;
  retiredAtUs: number | null;
  retiredBy: 'fire' | 'remove' | null;
  removals: number;
  duplicateRemovals: number;
  fires: Span[];
}

const families = ['cursor', 'zoom-init', 'zoom-update'] as const;
const phases = Object.keys(DOC_CALLBACK_MARKERS) as Phase[];
const caps: Record<DocCallbackFamily, number> = { cursor: 4, 'zoom-init': 1, 'zoom-update': 1 };
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const target = (family: string): family is DocCallbackFamily =>
  families.includes(family as DocCallbackFamily);
const callsiteKey = (value: Record<string, unknown>) =>
  typeof value.url === 'string' && integer(value.lineNumber) && integer(value.columnNumber)
    ? JSON.stringify([value.url, value.lineNumber, value.columnNumber])
    : null;

function spanSummary(spans: Span[]) {
  const sorted = spans.toSorted((a, b) => a.startedAtUs - b.startedAtUs);
  let unionUs = 0;
  let end = -Infinity;
  for (const span of sorted) {
    const nextEnd = span.startedAtUs + span.durationUs;
    unionUs += Math.max(0, nextEnd - Math.max(end, span.startedAtUs));
    end = Math.max(end, nextEnd);
  }
  return {
    count: spans.length,
    sumMs: spans.reduce((sum, span) => sum + span.durationUs, 0) / 1000,
    unionMs: unionUs / 1000,
    maxMs: spans.reduce((max, span) => Math.max(max, span.durationUs), 0) / 1000,
  };
}

function clipped(spans: Span[], from: number, until: number) {
  return spans.flatMap((span) => {
    const start = Math.max(span.startedAtUs, from);
    const end = Math.min(span.startedAtUs + span.durationUs, until);
    return end > start ? [{ startedAtUs: start, durationUs: end - start }] : [];
  });
}

/**
 * Attribution is supplied from the exact build's source maps, never guessed from
 * minified names, output lines, delay values, or counts. The caller preserves the
 * mapping and raw trace with its hashes. Unknown target ownership cannot pass.
 * Baselines may demonstrate unbounded callbacks; accepted then means a complete
 * observation, not passing production lifetime bounds.
 */
export function analyzeDocCallbackLifetimes(input: DocCallbackTraceInput) {
  const evidenceFailures: string[] = [];
  const candidateViolations: string[] = [];
  const fail = (message: string) => evidenceFailures.push(message);
  if (input.role !== 'baselineObservation' && input.role !== 'candidate')
    fail('Unknown evidence role.');
  if (input.completion?.dataLossOccurred !== false)
    fail('Trace completion is missing or reports lost data.');
  if (!input.frameId) fail('The measured frame identity is missing.');
  const markers = input.markers ?? DOC_CALLBACK_MARKERS;
  if (new Set(Object.values(markers)).size !== phases.length)
    fail('Phase marker names are not unique.');
  const events = input.traceEvents.flatMap((raw, index) =>
    object(raw) ? [{ event: raw as TraceEvent, index }] : [],
  );
  if (events.length !== input.traceEvents.length) fail('The trace contains a malformed event.');
  const found = Object.fromEntries(
    phases.map((phase) => [phase, events.filter(({ event }) => event.name === markers[phase])]),
  ) as Record<Phase, typeof events>;
  const times = {} as Record<Phase, number | null>;
  for (const phase of phases) {
    if (found[phase].length !== 1) fail(`Expected exactly one ${phase} marker.`);
    const event = found[phase][0]?.event;
    times[phase] = event && finite(event.ts) ? event.ts : null;
    if (!event || !finite(event.ts) || !integer(event.pid) || !integer(event.tid))
      fail(`The ${phase} marker has an invalid timestamp or renderer identity.`);
    if (
      event &&
      (typeof event.cat !== 'string' || !event.cat.split(',').includes('blink.user_timing'))
    )
      fail(`The ${phase} marker is not a browser user-timing observation.`);
  }
  const identity = found.beforeMount[0]?.event;
  const sameThread = (event: TraceEvent) =>
    event.pid === identity?.pid && event.tid === identity?.tid;
  for (const phase of phases)
    if (found[phase][0] && !sameThread(found[phase][0]!.event))
      fail(`The ${phase} marker belongs to a different renderer/thread.`);
  for (let index = 1; index < phases.length; index++) {
    const before = times[phases[index - 1]!]!;
    const after = times[phases[index]!]!;
    if (before !== null && after !== null && after <= before)
      fail('Phase markers are not strictly ordered.');
  }
  if (times.disposed !== null && times.end !== null && times.end - times.disposed < 1_000_000)
    fail('Post-disposal observation is shorter than one 1,000 ms cursor period.');

  const sites = new Map<string, number>();
  input.callsites.forEach((site, index) => {
    const key = callsiteKey(site as unknown as Record<string, unknown>);
    if (!key || (!target(site.family) && site.family !== 'other')) {
      fail(`Callsite ${index} is invalid.`);
      return;
    }
    if (sites.has(key)) fail(`Callsite ${index} duplicates a generated source position.`);
    else sites.set(key, index);
  });
  const classify = (frame: unknown) => {
    const key = object(frame) ? callsiteKey(frame) : null;
    const index = key === null ? undefined : sites.get(key);
    return {
      index: index ?? null,
      family: index === undefined ? ('unknown' as const) : input.callsites[index]!.family,
    };
  };
  const topFrame = (event: TraceEvent) => {
    const stack = event.args?.data?.stackTrace;
    return Array.isArray(stack) ? stack[0] : undefined;
  };
  const functionCalls = events
    .filter(
      ({ event }) =>
        event.name === 'FunctionCall' &&
        sameThread(event) &&
        event.args?.data?.frame === input.frameId &&
        finite(event.ts) &&
        finite(event.dur),
    )
    .toSorted(
      (a, b) => a.event.ts! - b.event.ts! || b.event.dur! - a.event.dur! || a.index - b.index,
    );
  const orphanAttribution = (event: TraceEvent) => {
    if (event.name === 'TimerRemove') return classify(topFrame(event));
    const callback = functionCalls.find(
      ({ event: call }) =>
        call.ts! >= event.ts! && call.ts! + call.dur! <= event.ts! + (event.dur ?? 0),
    );
    return classify(callback?.event.args?.data);
  };

  const ledger: DocTimerLifetime[] = [];
  const latest = new Map<string, DocTimerLifetime>();
  const pending: Record<DocCallbackFamily, number> = {
    cursor: 0,
    'zoom-init': 0,
    'zoom-update': 0,
  };
  const highWater = { ...pending };
  const pendingAt = {} as Record<Phase, Record<DocCallbackFamily, number> | null>;
  for (const phase of phases) pendingAt[phase] = null;
  const orphans: Array<{ name: string; atUs: number; timerId: number; family: string }> = [];
  let ignoredOtherFrames = 0;
  let unrelatedTimers = 0;
  const relevant = events
    .filter(
      ({ event }) =>
        phases.some((phase) => event.name === markers[phase]) ||
        ['TimerInstall', 'TimerRemove', 'TimerFire'].includes(event.name ?? ''),
    )
    .toSorted((a, b) => (a.event.ts ?? Infinity) - (b.event.ts ?? Infinity) || a.index - b.index);
  for (const { event, index } of relevant) {
    const phase = phases.find((phase) => event.name === markers[phase]);
    if (phase) {
      if (sameThread(event)) pendingAt[phase] = { ...pending };
      continue;
    }
    if (!integer(event.pid) || !integer(event.tid) || !finite(event.ts)) {
      fail(`Timer event ${index} has no valid clock or renderer identity.`);
      continue;
    }
    if (!sameThread(event)) continue;
    const data = event.args?.data;
    if (!data || typeof data.frame !== 'string' || !integer(data.timerId)) {
      fail(`Timer event ${index} is missing its frame or timer ID.`);
      continue;
    }
    if (data.frame !== input.frameId) {
      ignoredOtherFrames++;
      continue;
    }
    const key = JSON.stringify([event.pid, event.tid, data.frame, data.timerId]);
    const prior = latest.get(key);
    if (event.name === 'TimerInstall') {
      const attribution = classify(topFrame(event));
      if (attribution.family === 'unknown')
        fail(`Timer installation ${index} has unknown source attribution.`);
      if (prior && prior.retiredAtUs === null)
        fail(
          `Timer ${data.timerId} was installed again while its preceding generation was pending.`,
        );
      if (typeof data.singleShot !== 'boolean' || !finite(data.timeout) || event.ph !== 'I') {
        fail(`Timer installation ${index} has invalid repetition, delay, or event shape.`);
        continue;
      }
      const lifetime: DocTimerLifetime = {
        pid: event.pid,
        tid: event.tid,
        frame: data.frame,
        timerId: data.timerId,
        generation: (prior?.generation ?? 0) + 1,
        family: attribution.family,
        callsite: attribution.index,
        installedAtUs: event.ts,
        timeoutMs: data.timeout,
        singleShot: data.singleShot,
        retiredAtUs: null,
        retiredBy: null,
        removals: 0,
        duplicateRemovals: 0,
        fires: [],
      };
      ledger.push(lifetime);
      latest.set(key, lifetime);
      if (target(lifetime.family)) {
        pending[lifetime.family]++;
        highWater[lifetime.family] = Math.max(highWater[lifetime.family], pending[lifetime.family]);
        if (times.beforeMount !== null && event.ts < times.beforeMount)
          fail('A target callback was installed before the declared native-mount boundary.');
      } else if (lifetime.family === 'other') unrelatedTimers++;
      continue;
    }
    if (event.name === 'TimerFire' && (event.ph !== 'X' || !finite(event.dur))) {
      fail(`Timer firing ${index} has no complete callback duration.`);
      continue;
    }
    if (event.name === 'TimerRemove' && event.ph !== 'I') {
      fail(`Timer removal ${index} has an unsupported event shape.`);
      continue;
    }
    if (prior && prior.retiredAtUs !== null && event.name === 'TimerRemove') {
      prior.duplicateRemovals++;
      continue;
    }
    if (!prior || prior.retiredAtUs !== null) {
      const attribution = orphanAttribution(event);
      orphans.push({
        name: event.name!,
        atUs: event.ts,
        timerId: data.timerId,
        family: attribution.family,
      });
      // Known unrelated shell work may predate capture. Missing target or unknown
      // ownership is incomplete, including a second fire of a retired target.
      if (attribution.family !== 'other' || (prior && target(prior.family)))
        fail(`${event.name} ${index} has no pending installation with proven unrelated ownership.`);
      continue;
    }
    if (event.name === 'TimerFire')
      prior.fires.push({ startedAtUs: event.ts, durationUs: event.dur! });
    else prior.removals++;
    if (event.name === 'TimerRemove' || prior.singleShot) {
      prior.retiredAtUs = event.ts;
      prior.retiredBy = event.name === 'TimerRemove' ? 'remove' : 'fire';
      if (target(prior.family)) pending[prior.family]--;
    }
  }

  const tasks: Span[] = [];
  const taskBoundaryEvents: Array<{ phase: string; atUs: number }> = [];
  const openTasks: number[] = [];
  let instantaneousTasks = 0;
  for (const { event, index } of events
    .filter(({ event }) => sameThread(event) && event.name === 'ThreadControllerImpl::RunTask')
    .toSorted((a, b) => (a.event.ts ?? Infinity) - (b.event.ts ?? Infinity) || a.index - b.index)) {
    if (!finite(event.ts)) fail(`Main-thread task ${index} has an invalid timestamp.`);
    else if (event.ph === 'I') instantaneousTasks++;
    else if (event.ph === 'B') openTasks.push(event.ts);
    else if (event.ph === 'E') {
      const startedAtUs = openTasks.pop();
      if (startedAtUs !== undefined)
        tasks.push({ startedAtUs, durationUs: event.ts - startedAtUs });
      else {
        taskBoundaryEvents.push({ phase: 'unmatched-end', atUs: event.ts });
        if (times.beforeMount === null || event.ts >= times.beforeMount)
          fail(`Main-thread task ${index} ends without an observed start.`);
      }
    } else if (event.ph === 'X' && finite(event.dur))
      tasks.push({ startedAtUs: event.ts, durationUs: event.dur });
    else fail(`Main-thread task ${index} has an incomplete span.`);
  }
  for (const atUs of openTasks) {
    taskBoundaryEvents.push({ phase: 'unclosed-start', atUs });
    if (times.end === null || atUs < times.end)
      fail('A main-thread task is incomplete within the measured observation window.');
  }
  if (!tasks.length) fail('No complete measured-thread task spans were retained.');
  const lastTraceUs = events.reduce(
    (max, { event }) =>
      finite(event.ts) ? Math.max(max, event.ts + (finite(event.dur) ? event.dur : 0)) : max,
    0,
  );
  const metrics = Object.fromEntries(
    families.map((family) => {
      const owned = ledger.filter((lifetime) => lifetime.family === family);
      const fires = owned.flatMap((lifetime) => lifetime.fires);
      const postInput =
        times.finalKey === null ? [] : fires.filter((span) => span.startedAtUs >= times.finalKey!);
      const postDisposal =
        times.disposed === null ? [] : fires.filter((span) => span.startedAtUs >= times.disposed!);
      const afterDisposalInstallations =
        times.disposed === null
          ? 0
          : owned.filter((lifetime) => lifetime.installedAtUs >= times.disposed!).length;
      if (!owned.length) fail(`No ${family} installations establish target-family coverage.`);
      if (
        family === 'cursor' &&
        (!owned.some((lifetime) => lifetime.singleShot) ||
          !owned.some((lifetime) => !lifetime.singleShot))
      )
        fail('Cursor coverage must include both its hide timeout and repeating blink.');
      if (highWater[family] > caps[family])
        candidateViolations.push(
          `${family} pending high-water ${highWater[family]} exceeds ${caps[family]}.`,
        );
      if (
        pendingAt.disposed?.[family] !== 0 ||
        pendingAt.end?.[family] !== 0 ||
        pending[family] !== 0
      )
        candidateViolations.push(`${family} retains callbacks at/after editor disposal.`);
      if (postDisposal.length || afterDisposalInstallations)
        candidateViolations.push(`${family} fires or installs callbacks after editor disposal.`);
      return [
        family,
        {
          installations: owned.length,
          removals: owned.reduce((sum, lifetime) => sum + lifetime.removals, 0),
          duplicateRemovals: owned.reduce((sum, lifetime) => sum + lifetime.duplicateRemovals, 0),
          firings: fires.length,
          oneShotFirings: owned
            .filter((lifetime) => lifetime.singleShot)
            .reduce((sum, lifetime) => sum + lifetime.fires.length, 0),
          intervalFirings: owned
            .filter((lifetime) => !lifetime.singleShot)
            .reduce((sum, lifetime) => sum + lifetime.fires.length, 0),
          pendingHighWater: highWater[family],
          pendingAt: Object.fromEntries(
            phases.map((phase) => [phase, pendingAt[phase]?.[family] ?? null]),
          ),
          pendingAtTraceEnd: pending[family],
          callbacksAfterFinalKey: postInput.length,
          callbacksAfterDisposal: postDisposal.length,
          installationsAfterDisposal: afterDisposalInstallations,
          directCallbackWall: spanSummary(fires),
          postInputCallbackWall: spanSummary(
            times.finalKey === null ? [] : clipped(fires, times.finalKey, lastTraceUs),
          ),
          postDisposalCallbackWall: spanSummary(
            times.disposed === null ? [] : clipped(fires, times.disposed, lastTraceUs),
          ),
          callbackSpans: fires,
        },
      ];
    }),
  );
  const complete = evidenceFailures.length === 0;
  return {
    schema: 1,
    role: input.role,
    complete,
    bounded: complete && candidateViolations.length === 0,
    accepted:
      complete && (input.role === 'baselineObservation' || candidateViolations.length === 0),
    evidenceFailures,
    candidateViolations,
    frameId: input.frameId,
    renderer: { pid: identity?.pid ?? null, tid: identity?.tid ?? null },
    phaseAtUs: times,
    caps,
    families: metrics,
    ledger,
    orphans,
    ignoredOtherFrames,
    unrelatedTimers,
    mainThreadTasks: {
      ...spanSummary(tasks),
      instantaneousEvents: instantaneousTasks,
      boundaryEvents: taskBoundaryEvents,
      postInput:
        times.finalKey === null || times.disposed === null
          ? null
          : spanSummary(clipped(tasks, times.finalKey, times.disposed)),
      postDisposal:
        times.disposed === null || times.end === null
          ? null
          : spanSummary(clipped(tasks, times.disposed, times.end)),
      spans: tasks,
    },
  };
}
