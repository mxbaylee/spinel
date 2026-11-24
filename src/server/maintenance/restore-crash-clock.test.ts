import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import { expiredRestoreClockOffset } from './restore-crash-clock-fixture.ts';

const wallNow = 1_793_661_000_000;

test('restart expires the persisted original authority even after its lifetime grows', () => {
  for (const minutes of [5, 30]) {
    const authority = Object.freeze({ expiresAt: wallNow + minutes * 60_000 });
    const offset = expiredRestoreClockOffset(authority.expiresAt, wallNow);
    expect(wallNow + offset).toBeGreaterThan(authority.expiresAt);
    expect(wallNow + offset).toBe(authority.expiresAt + 1);
    expect(authority.expiresAt).toBe(wallNow + minutes * 60_000);
  }
});

test('the old six-minute advance fails the same expired-authority assertion', () => {
  const expiresAt = wallNow + 30 * 60_000;
  const requireExpired = (offset: number) => assert.ok(wallNow + offset > expiresAt);
  expect(() => requireExpired(6 * 60_000)).toThrow(assert.AssertionError);
  expect(() => requireExpired(expiredRestoreClockOffset(expiresAt, wallNow))).not.toThrow();
});

test('restarting a cold attempt expires its own persisted grant without moving backward', () => {
  const originalExpiry = wallNow + 30 * 60_000;
  const first = expiredRestoreClockOffset(originalExpiry, wallNow);
  const coldDeadline = wallNow + first + 90_000;
  const second = expiredRestoreClockOffset(coldDeadline, wallNow, first);
  expect(wallNow + second).toBeGreaterThan(coldDeadline);
  expect(second).toBeGreaterThan(first);
  expect(expiredRestoreClockOffset(originalExpiry, wallNow, second)).toBe(second);
});

test('an already expired authority does not require a negative clock advance', () => {
  expect(expiredRestoreClockOffset(wallNow - 1, wallNow)).toBe(0);
});
