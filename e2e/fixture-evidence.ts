import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Browser, BrowserContext, TestInfo } from '@playwright/test';
import type { AppProcessEvidence } from './owned-process.ts';
import { withFixtureCleanup } from './owned-process.ts';

export type ServerEvidence = AppProcessEvidence & {
  ownerPid: number;
  runId: string;
  updatedAt: number;
};
type EvidenceInfo = Pick<
  TestInfo,
  'testId' | 'retry' | 'repeatEachIndex' | 'project' | 'outputPath'
>;
const journals = new WeakMap<object, { started: number; events: object[]; dropped: number }>();
let sourceSha: string | undefined;

/** No cookies, account IDs, URLs, native snapshots or arbitrary error messages. */
export function fixturePhase(info: EvidenceInfo, phase: string, facts: object = {}) {
  let journal = journals.get(info);
  if (!journal) {
    journal = { started: performance.now(), events: [], dropped: 0 };
    journals.set(info, journal);
  }
  journal.events.push({
    elapsedMs: Math.round(performance.now() - journal.started),
    phase,
    ...facts,
  });
  if (journal.events.length > 128) {
    journal.events.shift();
    journal.dropped++;
  }
  if (!sourceSha) {
    try {
      sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      sourceSha = 'unavailable';
    }
  }
  const path = info.outputPath('fixture-evidence.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        sourceSha,
        testId: info.testId,
        project: info.project.name,
        retry: info.retry,
        repeatEachIndex: info.repeatEachIndex,
        events: journal.events,
        dropped: journal.dropped,
      },
      null,
      2,
    ) + '\n',
  );
}

export function serverEvidencePath(origin: string) {
  const port = new URL(origin).port;
  if (!/^\d+$/.test(port)) throw new Error('Fixture server needs its explicit isolated port.');
  return resolve('playwright-report', `server-${port}.json`);
}

export function readServerEvidence(origin: string): ServerEvidence {
  const state = JSON.parse(readFileSync(serverEvidencePath(origin), 'utf8')) as ServerEvidence;
  if (
    !Number.isSafeInteger(state.ownerPid) ||
    state.ownerPid <= 0 ||
    !Number.isSafeInteger(state.pid) ||
    !state.pid ||
    state.pid <= 0 ||
    !/^[a-f0-9-]{36}$/.test(state.runId) ||
    typeof state.ready !== 'boolean' ||
    !Number.isFinite(state.updatedAt)
  )
    throw new Error('Owned fixture server evidence is incomplete.');
  return state;
}

export function assertServerHealthy(state: ServerEvidence, runId = state.runId) {
  if (
    state.runId !== runId ||
    !state.ready ||
    state.expectedClose ||
    state.exited ||
    state.closed ||
    state.unexpectedExit ||
    state.firstFailure !== null ||
    // The wrapper updates every 250ms. Stale evidence cannot authorize recovery
    // merely because an old process ID is still present or has been reused.
    Date.now() - state.updatedAt > 2_000 ||
    state.updatedAt > Date.now() + 1_000
  )
    throw new Error(
      `Owned fixture server is unavailable (ready=${state.ready}, exited=${state.exited}, code=${state.exitCode}, signal=${state.signal}).`,
    );
  for (const pid of [state.ownerPid, state.pid!]) process.kill(pid, 0);
}

export async function withinFixtureBudget<T>(
  work: () => Promise<T>,
  budgetMs: number,
  phase: string,
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Fixture ${phase} exceeded its bounded budget.`)),
          budgetMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function closeFixtureContexts(contexts: readonly BrowserContext[]) {
  const results = await Promise.allSettled(
    contexts.map((context) =>
      withinFixtureBudget(
        async () => {
          try {
            await context.close();
          } catch (error) {
            // Playwright may already have retired a failed worker's context. Only
            // its explicit closed-target error is idempotent; other errors remain.
            if (
              !(error instanceof Error) ||
              !/^(?:browserContext\.close: )?Target (?:page, context or browser has been closed|closed)\b/.test(
                error.message,
              )
            )
              throw error;
          }
        },
        3_000,
        'context close',
      ),
    ),
  );
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, 'Fixture context cleanup failed.');
}

/** Diagnostics get one second, all context closes share three, DB disposal always runs. */
export async function closeFixtureResources(
  info: EvidenceInfo,
  options: {
    capture: () => Promise<void>;
    contexts: readonly BrowserContext[];
    dispose: () => void;
  },
) {
  const errors: unknown[] = [];
  try {
    await withinFixtureBudget(options.capture, 1_000, 'diagnostic capture');
  } catch (error) {
    errors.push(error);
  }
  try {
    await closeFixtureContexts(options.contexts);
  } catch (error) {
    errors.push(error);
  }
  try {
    options.dispose();
  } catch (error) {
    errors.push(error);
  }
  try {
    fixturePhase(info, 'cleanup', { errors: errors.length, contexts: options.contexts.length });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed.');
}

/** Guard only the named non-performance journeys against their actual owned server. */
export async function withFixtureServer<T>(
  browser: Browser,
  origin: string,
  info: EvidenceInfo,
  work: () => Promise<T>,
) {
  const first = readServerEvidence(origin);
  assertServerHealthy(first);
  fixturePhase(info, 'server-ready', { server: first });
  let terminal: Error | undefined;
  let rejectExit!: (error: Error) => void;
  const exited = new Promise<never>((_, reject) => {
    rejectExit = reject;
  });
  const inspect = () => {
    if (terminal) return;
    try {
      assertServerHealthy(readServerEvidence(origin), first.runId);
    } catch (error) {
      terminal = new Error(
        'Owned fixture server exited or became unavailable during the scenario.',
        { cause: error },
      );
      rejectExit(terminal);
    }
  };
  // This polls actual process ownership/state; it does not delay product actions
  // or replace their observable readiness assertions with a timed sleep.
  const timer = setInterval(inspect, 100);
  const pendingWork = Promise.resolve().then(work);
  let workFailed = false;
  return withFixtureCleanup(
    async () => {
      try {
        const value = await Promise.race([pendingWork, exited]);
        inspect();
        if (terminal) throw terminal;
        return value;
      } catch (original) {
        workFailed = true;
        if (terminal) {
          // Abort blocked browser operations, then join the interrupted scenario
          // so its own DB cleanup cannot race the next test or lose its errors.
          const secondary: unknown[] = [];
          try {
            await closeFixtureContexts(browser.contexts());
          } catch (error) {
            secondary.push(error);
          }
          try {
            await withinFixtureBudget(
              async () => {
                try {
                  await pendingWork;
                } catch (error) {
                  secondary.push(error);
                }
              },
              5_000,
              'interrupted scenario cleanup',
            );
          } catch (error) {
            secondary.push(error);
          }
          if (secondary.length)
            throw new AggregateError(
              [original, ...secondary],
              'Owned server failed; interrupted fixture cleanup evidence is retained.',
              { cause: original },
            );
        }
        throw original;
      }
    },
    async () => {
      clearInterval(timer);
      let final: ServerEvidence | undefined;
      try {
        final = readServerEvidence(origin);
      } catch {
        /* Explicit missing evidence below. */
      }
      fixturePhase(
        info,
        terminal ? 'server-failure' : workFailed ? 'scenario-failure' : 'scenario-finished',
        {
          server: final ?? null,
        },
      );
    },
  );
}
