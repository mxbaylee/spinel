import type { BrowserContext, TestInfo } from '@playwright/test';
import { assertServerHealthy, fixturePhase, readServerEvidence } from './fixture-evidence.ts';

type SessionResponse = { status: () => number; json: () => Promise<unknown> };
export type SetupAttempt = {
  attempt: number;
  status?: number;
  identityMatch?: boolean;
  result:
    | 'verified'
    | 'denied'
    | 'wrong-account'
    | 'invalid-response'
    | 'transport-error'
    | 'fatal-error';
  reason?: 'ECONNRESET' | 'unclassified';
};

/** Only an idempotent pre-feature session read has this narrowly scoped recovery. */
export async function verifyPreparedSession(options: {
  expectedId: string;
  read: (remainingMs: number) => Promise<SessionResponse>;
  healthy: (remainingMs: number) => Promise<void>;
  record: (attempt: SetupAttempt) => void;
  recovery: boolean;
  budgetMs?: number;
}) {
  const deadline = performance.now() + Math.min(5_000, options.budgetMs ?? 5_000);
  const remaining = () => {
    const time = Math.floor(deadline - performance.now());
    if (time <= 0) throw new Error('Authenticated fixture setup exhausted its original budget.');
    return time;
  };
  let original: unknown;
  for (const attempt of [1, 2]) {
    let response: SessionResponse;
    try {
      response = await options.read(remaining());
    } catch (error) {
      const reset =
        error instanceof Error &&
        error.name === 'Error' &&
        ((error as NodeJS.ErrnoException).code === 'ECONNRESET' ||
          /^apiRequestContext\.get: (?:read )?ECONNRESET\b/.test(error.message));
      options.record({
        attempt,
        result: reset ? 'transport-error' : 'fatal-error',
        reason: reset ? 'ECONNRESET' : 'unclassified',
      });
      if (attempt === 2)
        throw new AggregateError(
          [original, error],
          'Authenticated setup exhausted its single transport recovery.',
          { cause: original },
        );
      if (!reset || !options.recovery) throw error;
      original = error;
      try {
        await options.healthy(remaining());
      } catch (healthError) {
        throw new AggregateError(
          [original, healthError],
          'Authenticated setup cannot recover against an unhealthy owned server.',
          { cause: original },
        );
      }
      continue;
    }
    const status = response.status();
    if (status !== 200) {
      options.record({ attempt, status, result: 'denied' });
      throw new Error(
        `Authenticated fixture setup was denied (HTTP ${status}); no retry is permitted.`,
      );
    }
    let data: { user?: { id?: unknown } };
    try {
      data = (await response.json()) as typeof data;
    } catch (error) {
      options.record({ attempt, status, result: 'invalid-response' });
      throw new Error('Authenticated fixture setup returned an invalid response.', {
        cause: error,
      });
    }
    const match = data?.user?.id === options.expectedId;
    options.record({
      attempt,
      status,
      identityMatch: match,
      result: match ? 'verified' : 'wrong-account',
    });
    if (!match)
      throw new Error(
        'Authenticated fixture setup has the wrong or missing account; no retry is permitted.',
      );
    remaining();
    return;
  }
}

export async function verifyFixtureSession(
  context: BrowserContext,
  origin: string,
  expectedId: string,
  info: TestInfo,
) {
  // This is used before a non-authentication feature flow. Authentication tests
  // keep their real ceremonies and never call this as mutation recovery.
  let owned: ReturnType<typeof readServerEvidence> | undefined;
  try {
    owned = readServerEvidence(origin);
  } catch {
    /* Independent startApp fixtures do not opt in to recovery. */
  }
  if (owned) assertServerHealthy(owned);
  await verifyPreparedSession({
    expectedId,
    recovery: Boolean(owned) && process.env.SPINEL_FIXTURE_NO_RECOVERY !== '1',
    read: (timeout) =>
      context.request.get(`${origin}/api/auth/session`, { timeout, maxRetries: 0 }),
    healthy: async (timeout) => {
      if (!owned) throw new Error('No owned process evidence authorizes setup recovery.');
      assertServerHealthy(readServerEvidence(origin), owned.runId);
      const response = await context.request.get(`${origin}/api/health`, {
        timeout,
        maxRetries: 0,
      });
      if (response.status() !== 200 || (await response.json()).status !== 'ok')
        throw new Error('Owned fixture server failed its health read.');
      assertServerHealthy(readServerEvidence(origin), owned.runId);
    },
    record: (attempt) => fixturePhase(info, 'authenticated-setup', attempt),
  });
}
