import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeSheetImageFixture } from '../../e2e/sheet-image-cleanup.ts';

test('Sheet image cleanup attempts every resource after diagnostic and context failures', async () => {
  const order: string[] = [];
  const failures = ['diagnostics', 'peer', 'owner', 'database'].map((name) => new Error(name));
  const cleanup = async () => {
    order.push('diagnostics');
    throw failures[0];
  };
  const contexts = ['peer', 'owner'].map((name, index) => ({
    async close() {
      order.push(name);
      throw failures[index + 1];
    },
  }));
  const primary = new Error('native insertion failed');
  let secondary: unknown[] = [];
  await assert.rejects(
    async () => {
      try {
        throw primary;
      } finally {
        secondary = await closeSheetImageFixture(cleanup, contexts, () => {
          order.push('database');
          throw failures[3];
        });
      }
    },
    (error) => error === primary,
  );
  assert.deepEqual(order, ['diagnostics', 'peer', 'owner', 'database']);
  assert.deepEqual(secondary, failures);
});

test('Sheet image setup can close only the resources acquired before failure', async () => {
  const order: string[] = [];
  const failures = await closeSheetImageFixture(
    async () => {
      order.push('diagnostics');
    },
    [],
    () => {
      order.push('database');
    },
  );
  assert.deepEqual(order, ['diagnostics', 'database']);
  assert.deepEqual(failures, []);
});
