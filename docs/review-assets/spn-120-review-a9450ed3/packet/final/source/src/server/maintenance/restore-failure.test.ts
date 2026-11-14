import { expect, test } from 'vitest';
import { RecoveryResourceError } from '../backup/resource-error.ts';
import { RESTORE_RESOURCE_MESSAGES } from '../../shared/restore.ts';
import { RestorePreparationFailure, restoreExecutionFailureReason } from './restore-failure.ts';

test.each(Object.keys(RESTORE_RESOURCE_MESSAGES) as Array<keyof typeof RESTORE_RESOURCE_MESSAGES>)(
  'durable diagnostics retain typed %s without private native messages',
  (code) => {
    const original = new RecoveryResourceError(code);
    original.message = '/private/recovery/key SELECT secret FROM sessions';
    const wrapped = new RestorePreparationFailure('candidate-reconcile', original);
    const reason = restoreExecutionFailureReason('preparation-planned', wrapped);
    expect(reason).toBe(`restore-prep-planned-candidate-reconcile-${code}`);
    expect(reason).toMatch(/^[a-z-]{1,64}$/);
    expect(JSON.stringify(wrapped)).not.toContain('private');
    expect(wrapped.cause).toBeUndefined();
  },
);
test('filesystem codes are allowlisted and unknown values never become durable text', () => {
  expect(
    restoreExecutionFailureReason(
      'preparation-planned',
      new RestorePreparationFailure(
        'directory-create',
        Object.assign(new Error('/private/path'), { code: 'EACCES' }),
      ),
    ),
  ).toBe('restore-prep-planned-directory-create-eacces');
  for (const value of [
    new Error('/private/SQLite'),
    { code: 'memory-headroom' },
    Object.assign(new Error('secret'), { code: 'SQLITE_PRIVATE' }),
  ])
    expect(restoreExecutionFailureReason('/private/stage', value)).toBe('restore-unknown-unknown');
  const poisoned = new Error('secret');
  Object.defineProperty(poisoned, 'code', {
    get() {
      throw new Error('private getter');
    },
  });
  expect(restoreExecutionFailureReason('frozen', poisoned)).toBe('restore-frozen-unknown');
});
test('mutated wrappers cannot smuggle paths or arbitrary codes into the journal', () => {
  const wrapper = new RestorePreparationFailure('plan', new Error('private'));
  Object.assign(wrapper, { step: '/private/path', code: 'SQLITE-secret' });
  expect(restoreExecutionFailureReason('preparation-planned', wrapper)).toBe(
    'restore-prep-planned-unknown-unknown',
  );
});

test('wrapped timeout and cancellation retain their normalized code', () => {
  for (const [name, code] of [
    ['TimeoutError', 'time-limit'],
    ['AbortError', 'cancelled'],
  ]) {
    const error = Object.assign(new Error('/private/deadline'), { name });
    const wrapped = new RestorePreparationFailure('deadline', error);
    expect(restoreExecutionFailureReason('preparation-planned', wrapped)).toBe(
      `restore-prep-planned-deadline-${code}`,
    );
  }
});
