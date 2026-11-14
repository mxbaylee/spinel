import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyPreparedSession } from '../../e2e/fixture-session.ts';
import type { SetupAttempt } from '../../e2e/fixture-session.ts';

const account = 'the-intended-fixture-account';
const response = (status = 200, id: unknown = account) => ({
  status: () => status,
  json: async () => ({ user: { id } }),
});
const reset = () => new Error('apiRequestContext.get: read ECONNRESET');

test('successful setup verifies the actual identity before feature work, with no recovery', async () => {
  const attempts: SetupAttempt[] = [];
  let checks = 0;
  await verifyPreparedSession({
    expectedId: account,
    read: async () => response(),
    healthy: async () => {
      checks++;
    },
    record: (attempt) => attempts.push(attempt),
    recovery: true,
  });
  assert.equal(checks, 0);
  assert.deepEqual(attempts, [
    { attempt: 1, status: 200, identityMatch: true, result: 'verified' },
  ]);
});

test('one setup reset is recoverable only after health verification and retains both attempts', async () => {
  const events: string[] = [];
  const attempts: SetupAttempt[] = [];
  const budgets: number[] = [];
  let reads = 0;
  await verifyPreparedSession({
    expectedId: account,
    read: async (budget) => {
      budgets.push(budget);
      events.push('read');
      if (++reads === 1) throw reset();
      return response();
    },
    healthy: async (budget) => {
      budgets.push(budget);
      events.push('healthy');
    },
    record: (attempt) => attempts.push(attempt),
    recovery: true,
  });
  assert.deepEqual(events, ['read', 'healthy', 'read']);
  assert.deepEqual(attempts, [
    { attempt: 1, result: 'transport-error', reason: 'ECONNRESET' },
    { attempt: 2, status: 200, identityMatch: true, result: 'verified' },
  ]);
  assert.ok(
    budgets.every((budget, index) => budget > 0 && budget <= (budgets[index - 1] ?? 5_000)),
  );
});

test('the no-recovery proof sample fails on its first reset', async () => {
  const first = reset();
  let reads = 0,
    health = 0;
  await assert.rejects(
    verifyPreparedSession({
      expectedId: account,
      read: async () => {
        reads++;
        throw first;
      },
      healthy: async () => {
        health++;
      },
      record: () => {},
      recovery: false,
    }),
    (error: unknown) => error === first,
  );
  assert.equal(reads, 1);
  assert.equal(health, 0);
});

test('recovery exhaustion retains the original reset and the second failure', async () => {
  const errors = [reset(), reset()];
  const attempts: SetupAttempt[] = [];
  let reads = 0;
  await assert.rejects(
    verifyPreparedSession({
      expectedId: account,
      read: async () => {
        throw errors[reads++];
      },
      healthy: async () => {},
      record: (attempt) => attempts.push(attempt),
      recovery: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, errors);
      assert.equal(error.cause, errors[0]);
      return true;
    },
  );
  assert.equal(reads, 2);
  assert.equal(attempts.length, 2);
});

test('a dead server after a reset prevents the second preparation request', async () => {
  const first = reset(),
    crash = new Error('Owned server exited with signal SIGILL');
  let reads = 0;
  await assert.rejects(
    verifyPreparedSession({
      expectedId: account,
      read: async () => {
        reads++;
        throw first;
      },
      healthy: async () => {
        throw crash;
      },
      record: () => {},
      recovery: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [first, crash]);
      return true;
    },
  );
  assert.equal(reads, 1);
});

for (const status of [401, 403, 500]) {
  test(`HTTP ${status} is terminal rather than setup noise`, async () => {
    let reads = 0;
    await assert.rejects(
      verifyPreparedSession({
        expectedId: account,
        read: async () => {
          reads++;
          return response(status);
        },
        healthy: async () => assert.fail('denied authentication must not enter recovery'),
        record: () => {},
        recovery: true,
      }),
      /was denied/,
    );
    assert.equal(reads, 1);
  });
}

for (const id of ['a-different-account', null, undefined, 42]) {
  test(`wrong or missing account (${String(id)}) never begins feature work or recovers`, async () => {
    let reads = 0,
      feature = false;
    await assert.rejects(
      (async () => {
        await verifyPreparedSession({
          expectedId: account,
          read: async () => {
            reads++;
            return { status: () => 200, json: async () => ({ user: { id } }) };
          },
          healthy: async () => assert.fail('wrong identity must not enter recovery'),
          record: () => {},
          recovery: true,
        });
        feature = true;
      })(),
      /wrong or missing account/,
    );
    assert.equal(reads, 1);
    assert.equal(feature, false);
  });
}

for (const failure of [
  new Error('ECONNREFUSED'),
  new Error('Product assertion failed'),
  new Error('Product assertion mentions ECONNRESET'),
  new assert.AssertionError({ message: 'ECONNRESET' }),
  new SyntaxError('malformed response'),
]) {
  test(`unclassified failure ${failure.name}/${failure.message} is never retried`, async () => {
    let reads = 0;
    await assert.rejects(
      verifyPreparedSession({
        expectedId: account,
        read: async () => {
          reads++;
          throw failure;
        },
        healthy: async () => assert.fail('unclassified error must not enter recovery'),
        record: () => {},
        recovery: true,
      }),
      (error: unknown) => error === failure,
    );
    assert.equal(reads, 1);
  });
}

test('invalid session JSON is terminal even if its parse error mentions a transport code', async () => {
  let reads = 0;
  await assert.rejects(
    verifyPreparedSession({
      expectedId: account,
      read: async () => {
        reads++;
        return {
          status: () => 200,
          json: async () => {
            throw reset();
          },
        };
      },
      healthy: async () => assert.fail('a response parse error is not a transport retry'),
      record: () => {},
      recovery: true,
    }),
    /invalid response/,
  );
  assert.equal(reads, 1);
});

test('an expired original setup budget admits no request', async () => {
  let reads = 0;
  await assert.rejects(
    verifyPreparedSession({
      expectedId: account,
      read: async () => {
        reads++;
        return response();
      },
      healthy: async () => {},
      record: () => {},
      recovery: true,
      budgetMs: 0,
    }),
    /original budget/,
  );
  assert.equal(reads, 0);
});
