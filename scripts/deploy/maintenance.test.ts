import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlTimeoutMs, parseControlArguments } from './maintenance.ts';

const operation = '00000000-0000-4000-8000-000000000000';

test('recover-original requires an exact operation UUID and a long client budget', () => {
  assert.deepEqual(parseControlArguments(['recover-original', '--operation', operation]), {
    action: 'recover-original',
    operationId: operation,
  });
  for (const args of [
    ['recover-original'],
    ['recover-original', '--operation'],
    ['recover-original', '--operation', 'not-a-uuid'],
    ['recover-original', '--operation', operation, 'extra'],
    ['recover-original', '--other', operation],
  ])
    assert.throws(() => parseControlArguments(args), `${args.join(' ')} must be refused`);
  assert.equal(controlTimeoutMs('recover-original'), 610_000);
  for (const action of ['status', 'pause', 'stop', 'start', 'verify', 'resume'] as const)
    assert.equal(controlTimeoutMs(action), 65_000);
});

test('other commands keep their argument rules', () => {
  assert.deepEqual(parseControlArguments(['status']), { action: 'status' });
  assert.throws(() => parseControlArguments(['status', '--operation', operation]));
  assert.throws(() => parseControlArguments(['unknown']));
  assert.throws(() => parseControlArguments([]));
  assert.throws(() => parseControlArguments(['start']));
  assert.throws(() => parseControlArguments(['resume']));
  for (const action of ['pause', 'verify'] as const)
    assert.match(
      (parseControlArguments([action]) as { operationId: string }).operationId,
      /^[0-9a-f-]{36}$/,
    );
});
