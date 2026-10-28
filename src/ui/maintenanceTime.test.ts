import { describe, expect, it } from 'vitest';
import { maintenanceInstants } from '../../web/maintenanceTime.ts';

describe('one-off maintenance notices', () => {
  it('requires an explicit occurrence for a repeated local minute', () => {
    // A notice must never silently choose one of the two fall-back occurrences.
    expect(maintenanceInstants('2026-11-01T01:30', 'America/Los_Angeles')).toEqual([
      Date.parse('2026-11-01T08:30:00Z'),
      Date.parse('2026-11-01T09:30:00Z'),
    ]);
  });
  it('does not move a missing spring-forward minute to a later time', () => {
    expect(maintenanceInstants('2027-03-14T02:30', 'America/Los_Angeles')).toEqual([]);
  });
  it('handles half-hour DST changes and non-hour fixed offsets', () => {
    expect(maintenanceInstants('2027-04-04T01:45', 'Australia/Lord_Howe')).toEqual([
      Date.parse('2027-04-03T14:45:00Z'),
      Date.parse('2027-04-03T15:15:00Z'),
    ]);
    expect(maintenanceInstants('2026-12-01T18:15', 'Asia/Kathmandu')).toEqual([
      Date.parse('2026-12-01T12:30:00Z'),
    ]);
  });
  it('rejects invalid zones and calendar dates rather than normalizing them', () => {
    expect(() => maintenanceInstants('2026-02-30T20:00', 'UTC')).toThrow();
    expect(() => maintenanceInstants('2026-12-01T20:00', 'Not/AZone')).toThrow();
    expect(() => maintenanceInstants('2026-12-01T25:00', 'UTC')).toThrow();
  });
});
