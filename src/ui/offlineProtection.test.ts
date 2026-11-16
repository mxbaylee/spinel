import { expect, test } from 'vitest';
import { answeredMessage, protectionDetail } from '../../web/offline/protection.ts';

const text = 'Trip journal is available offline on this device.';
const deciding = { text, failed: false, ...protectionDetail(null) };

test('a late storage answer replaces only its own still-deciding result', () => {
  expect(deciding.storageHelp).toBe(true);
  for (const state of ['granted', 'denied', 'unsupported', 'error'] as const)
    expect(answeredMessage(deciding, deciding, state)).toEqual({
      text,
      failed: false,
      ...protectionDetail(state),
    });
  expect(answeredMessage(deciding, deciding, 'granted')?.storageHelp).toBe(false);
  expect(answeredMessage(deciding, deciding, 'denied')?.storageHelp).toBe(true);
});

test('a dismissed, newer or already answered message stays exactly as it is', () => {
  expect(answeredMessage(null, deciding, 'granted')).toBeNull();
  const newer = { ...deciding, text: 'Field notes is available offline on this device.' };
  expect(answeredMessage(newer, deciding, 'granted')).toBe(newer);
  const removed = { text: 'Trip journal was removed from this device.', failed: false };
  expect(answeredMessage(removed, deciding, 'granted')).toBe(removed);
  const failed = { text: 'Could not change offline availability. Try again.', failed: true };
  expect(answeredMessage(failed, deciding, 'granted')).toBe(failed);
  const answered = { text, failed: false, ...protectionDetail('denied') };
  expect(answeredMessage(answered, deciding, 'granted')).toBe(answered);
});

test('an older storage answer cannot replace a newer identical-title preparation result', () => {
  const newer = { ...deciding };
  // Distinct files may share a name, or the same file may be prepared again.
  // Visible text cannot identify which request owns the current result.
  expect(answeredMessage(newer, deciding, 'granted')).toBe(newer);
  const completed = answeredMessage(newer, newer, 'denied');
  expect(completed).toEqual({ ...newer, ...protectionDetail('denied') });
  expect(answeredMessage(completed, deciding, 'granted')).toBe(completed);
});

test('a late storage answer after the preparation scope ended leaves the result untouched', () => {
  expect(answeredMessage(deciding, deciding, 'granted', false)).toBe(deciding);
  expect(answeredMessage(deciding, deciding, 'denied', true)).toEqual({
    ...deciding,
    ...protectionDetail('denied'),
  });
});
