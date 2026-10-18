import { expect, test, vi } from 'vitest';
import { auditDeniedEdit } from './audit.ts';

test('denial audit emits only bounded identifiers, a timestamp and the fixed category', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    auditDeniedEdit('forged-user\nsecret', 'document payload'.repeat(1000), 'submitChangeset');
    const event = JSON.parse(String(warn.mock.calls[0][0]));
    expect(event).toEqual({
      event: 'collaboration.edit_denied',
      stage: 'submitChangeset',
      at: expect.any(String),
    });
    expect(Number.isFinite(Date.parse(event.at))).toBe(true);
    expect(String(warn.mock.calls[0][0]).length).toBeLessThan(200);
  } finally {
    warn.mockRestore();
  }
});
