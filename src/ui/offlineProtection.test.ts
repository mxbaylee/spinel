import { expect, test } from 'vitest';
import { answeredMessage, protectionDetail } from '../../web/offline/protection.ts';

const text = 'Trip journal is available offline on this device.';
const deciding = { text, failed: false, ...protectionDetail(null) };

test('a late storage answer replaces only its own still-deciding result', () => {
  expect(deciding.storageHelp).toBe(true);
  for (const state of ['granted', 'denied', 'unsupported', 'error'] as const)
    expect(answeredMessage(deciding, text, state)).toEqual({
      text,
      failed: false,
      ...protectionDetail(state),
    });
  expect(answeredMessage(deciding, text, 'granted')?.storageHelp).toBe(false);
  expect(answeredMessage(deciding, text, 'denied')?.storageHelp).toBe(true);
});

test('a dismissed, newer or already answered message stays exactly as it is', () => {
  expect(answeredMessage(null, text, 'granted')).toBeNull();
  const newer = { ...deciding, text: 'Field notes is available offline on this device.' };
  expect(answeredMessage(newer, text, 'granted')).toBe(newer);
  const removed = { text: 'Trip journal was removed from this device.', failed: false };
  expect(answeredMessage(removed, text, 'granted')).toBe(removed);
  const failed = { text: 'Could not change offline availability. Try again.', failed: true };
  expect(answeredMessage(failed, text, 'granted')).toBe(failed);
  const answered = { text, failed: false, ...protectionDetail('denied') };
  expect(answeredMessage(answered, text, 'granted')).toBe(answered);
});
