import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishUpgrade } from '../../e2e/offline-upgrade-cleanup.ts';

test('upgrade cleanup attempts later owners and retains the first failure', async () => {
  const first = new Error('Native scenario failed.');
  const contextFailure = new Error('Context did not close.');
  const databaseFailure = new Error('Database did not close.');
  const closed: string[] = [];
  await assert.rejects(
    finishUpgrade(
      [
        async () => {
          closed.push('context');
          throw contextFailure;
        },
        () => closed.push('server'),
        () => {
          closed.push('database');
          throw databaseFailure;
        },
        () => closed.push('directory'),
      ],
      first,
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [first, contextFailure, databaseFailure]);
      return true;
    },
  );
  assert.deepEqual(closed, ['context', 'server', 'database', 'directory']);
});

test('an observation failure is retained once and does not skip owned cleanup', async () => {
  const first = new Error('Activation failed.');
  const observationFailure = new Error('Lifecycle collection failed.');
  const closed: string[] = [];
  await assert.rejects(
    finishUpgrade([() => closed.push('browser')], first, {
      async finish(failure) {
        assert.equal(failure, first);
        closed.push('observation');
        throw new AggregateError([first, observationFailure]);
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [first, observationFailure]);
      return true;
    },
  );
  assert.deepEqual(closed, ['observation', 'browser']);
});

test('a cleanup rejection fails an otherwise passing upgrade', async () => {
  const failure = new Error('Server did not close.');
  let directoryClosed = false;
  await assert.rejects(
    finishUpgrade([
      async () => {
        throw failure;
      },
      () => {
        directoryClosed = true;
      },
    ]),
    (error) => error === failure,
  );
  assert.equal(directoryClosed, true);
});
