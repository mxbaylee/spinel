import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RecoveryResourceError } from '../../src/server/backup/resource-error.ts';
import { supervisedRestoreFailure } from './spaces-restore-acceptance.ts';

test('provider failure diagnostics retain fixed stage codes without native private details', () => {
  const error = Object.assign(new Error('secret-access-key /private/database.sqlite'), {
    code: 'EACCES',
    path: '/private/database.sqlite',
    cause: new Error('private SQL'),
  });
  assert.deepEqual(
    supervisedRestoreFailure(error, () => 'stopped'),
    {
      failureCode: 'restore-unknown-eacces',
      controllerPhase: 'stopped',
    },
  );
  const resource = new RecoveryResourceError('memory-headroom');
  assert.equal(
    supervisedRestoreFailure(resource, () => 'recovery-required').failureCode,
    'restore-unknown-memory-headroom',
  );
});

test('only an exact fixed fixture HTTP status and known phase enter the report', () => {
  assert.deepEqual(
    supervisedRestoreFailure(new Error('Unexpected fixture HTTP status 503.'), () => 'running'),
    {
      failureCode: 'restore-unknown-unknown',
      controllerPhase: 'running',
      httpStatus: 503,
    },
  );
  for (const message of [
    'Unexpected fixture HTTP status 503. private-token',
    'Unexpected fixture HTTP status 999.',
    '/private/sql',
  ]) {
    assert.deepEqual(
      supervisedRestoreFailure(new Error(message), () => 'private-secret'),
      {
        failureCode: 'restore-unknown-unknown',
      },
    );
  }
});

test('diagnostic accessor or journal failures do not throw or replace containment', () => {
  const error = new Error();
  Object.defineProperty(error, 'message', {
    get() {
      throw new Error('private');
    },
  });
  assert.deepEqual(
    supervisedRestoreFailure(error, () => {
      throw new Error('private journal');
    }),
    {
      failureCode: 'restore-unknown-unknown',
    },
  );
  assert.deepEqual(
    supervisedRestoreFailure(null, () => undefined),
    {
      failureCode: 'restore-unknown-unknown',
    },
  );
});
