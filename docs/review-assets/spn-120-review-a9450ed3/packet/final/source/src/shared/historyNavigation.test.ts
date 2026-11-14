import { expect, test } from 'vitest';
import {
  dayVersions,
  historyDay,
  historyMonth,
  historyVersionLabel,
  shiftHistoryMonth,
} from './historyNavigation.ts';
import type { HistoryVersion } from './historyNavigation.ts';
const version = (
  id: string,
  time: string,
  name: string | null = null,
  beforeRestore = false,
): HistoryVersion => ({ id, capturedAt: Date.parse(time), name, beforeRestore });
test('history days follow UTC boundaries without inventing inactive-day versions', () => {
  const versions = [
    version('late', '2026-10-17T23:59:59.999Z'),
    version('early', '2026-10-18T00:00:00.000Z'),
  ];
  // Calendar grouping deliberately matches retained UTC daily buckets.
  expect(historyDay(versions[0].capturedAt)).toBe('2026-10-17');
  expect(dayVersions(versions, '2026-10-17').map((item) => item.id)).toEqual(['late']);
  expect(dayVersions(versions, '2026-10-18').map((item) => item.id)).toEqual(['early']);
  expect(dayVersions(versions, '2026-10-16')).toEqual([]);
});
test('same-day named and before-restore checkpoints all remain selectable with stable ties', () => {
  const versions = [
    version('z', '2026-10-18T12:00:00Z', 'Approved'),
    version('b', '2026-10-18T09:00:00Z', null, true),
    version('a', '2026-10-18T09:00:00Z', 'Morning'),
  ];
  expect(dayVersions(versions, '2026-10-18').map((item) => item.id)).toEqual(['a', 'b', 'z']);
  expect(historyVersionLabel(versions[1])).toBe('09:00:00 UTC — Unnamed version — Before restore');
  expect(historyVersionLabel(versions[0])).toBe('12:00:00 UTC — Approved');
});
test('calendar aligns weekdays and handles leap days and month/year boundaries', () => {
  const leap = historyMonth('2024-02');
  expect(leap.slice(0, 4)).toEqual([null, null, null, null]);
  expect(leap[4]).toBe('2024-02-01');
  expect(leap.at(-1)).toBe('2024-02-29');
  expect(historyMonth('2026-02').filter(Boolean)).toHaveLength(28);
  expect(historyMonth('2026-11')[0]).toBe('2026-11-01');
  expect(shiftHistoryMonth('2026-12', 1)).toBe('2027-01');
  expect(shiftHistoryMonth('2026-01', -1)).toBe('2025-12');
});
