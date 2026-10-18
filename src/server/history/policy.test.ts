import { expect, test } from 'vitest';
import { DAY, HOUR, MINUTE, expiredCheckpoints } from './policy.ts';
import type { Checkpoint } from './policy.ts';

const now = Date.UTC(2026, 9, 18, 12);
const point = (id: string, age: number, name: string | null = null): Checkpoint => ({
  id,
  capturedAt: now - age,
  revision: Number(id) || 1,
  name,
});

test('approved decay retains recent idle breaks, newest half-hour/hour buckets and pinned versions', () => {
  const points = [
    point('1', 1 * MINUTE),
    point('2', 2 * MINUTE),
    point('3', 59 * MINUTE),
    point('4', 61 * MINUTE),
    point('5', 65 * MINUTE),
    point('6', 89 * MINUTE),
    point('7', 91 * MINUTE),
    point('8', 95 * MINUTE, 'Keep forever'),
    point('9', 6 * HOUR + MINUTE),
    point('10', 6 * HOUR + 20 * MINUTE),
    point('11', 7 * HOUR + MINUTE),
    point('12', 7 * HOUR + 30 * MINUTE),
  ];
  // UTC buckets keep the latest snapshot in each interval; named rows don't displace it.
  expect(expiredCheckpoints(points, now).sort()).toEqual(['5', '6', '10', '12'].sort());
});

test('UTC day boundaries keep the final snapshot of each older day and never prune the latest', () => {
  const points: Checkpoint[] = [
    { id: 'early', capturedAt: Date.UTC(2026, 9, 15, 0), revision: 1, name: null },
    { id: 'late', capturedAt: Date.UTC(2026, 9, 15, 23, 59), revision: 2, name: null },
    { id: 'next', capturedAt: Date.UTC(2026, 9, 16, 0), revision: 3, name: null },
    { id: 'pin', capturedAt: Date.UTC(2026, 9, 15, 12), revision: 4, name: 'Milestone' },
  ];
  expect(expiredCheckpoints(points, now)).toEqual(['early']);
  expect(expiredCheckpoints([point('1', 100 * DAY)], now)).toEqual([]);
  expect(expiredCheckpoints([point('1', -DAY)], now)).toEqual([]);
});

test('age transitions use half-open tiers and equal timestamps retain the latest revision', () => {
  const points = [
    point('1', HOUR),
    point('2', HOUR),
    point('3', 6 * HOUR),
    point('4', 6 * HOUR),
    point('5', DAY),
    point('6', DAY),
  ];
  expect(expiredCheckpoints(points, now).sort()).toEqual(['1', '3', '5']);
});
