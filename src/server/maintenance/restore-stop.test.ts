import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  sameRestoreStopRequest,
  validRestoreStopRecord,
  validRestoreStopRequest,
} from './restore-stop.ts';
const request = () => ({
  jobId: randomUUID(),
  challengeId: randomUUID(),
  generationId: randomUUID(),
  epoch: randomUUID(),
  deadline: Date.now() + 1000,
});
test('a journal witness requires every binding and a consistent acceptance record', () => {
  const value = {
    request: request(),
    databaseIdentity: { device: '1', inode: '2' },
    child: { pid: 123, start: '456', boot: randomUUID(), token: randomUUID() },
    fingerprint: null as string | null,
    acceptedAt: null as number | null,
  };
  expect(validRestoreStopRecord(value)).toBe(true);
  expect(validRestoreStopRecord({ ...value, fingerprint: 'a'.repeat(64) })).toBe(false);
  expect(
    validRestoreStopRecord({ ...value, fingerprint: 'a'.repeat(64), acceptedAt: Date.now() }),
  ).toBe(true);
  expect(
    validRestoreStopRecord({
      ...value,
      fingerprint: 'a'.repeat(64),
      acceptedAt: value.request.deadline + 1,
    }),
  ).toBe(false);
  for (const key of ['request', 'databaseIdentity', 'child', 'fingerprint', 'acceptedAt']) {
    const incomplete: Record<string, unknown> = { ...value };
    delete incomplete[key];
    expect(validRestoreStopRecord(incomplete)).toBe(false);
  }
  expect(validRestoreStopRequest({ ...value.request, extra: true })).toBe(false);
});
test('same job or epoch is insufficient to match another shutdown challenge', () => {
  const a = request();
  expect(sameRestoreStopRequest(a, { ...a })).toBe(true);
  for (const key of ['jobId', 'challengeId', 'generationId', 'epoch'] as const)
    expect(sameRestoreStopRequest(a, { ...a, [key]: randomUUID() })).toBe(false);
  expect(sameRestoreStopRequest(a, { ...a, deadline: a.deadline + 1 })).toBe(false);
});
