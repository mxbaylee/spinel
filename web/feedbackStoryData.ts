import type { FeedbackPairReady } from '../src/shared/feedback.ts';

export const feedbackActor = '11111111-1111-4111-8111-111111111111';
export const feedbackGeneration = '22222222-2222-4222-8222-222222222222';
const now = Date.now();
export const feedbackPair: FeedbackPairReady = {
  state: 'ready',
  id: '44444444-4444-4444-8444-444444444444',
  actorId: feedbackActor,
  generation: feedbackGeneration,
  createdAt: now,
  expiresAt: now + 5 * 60_000,
  window: { start: now - 2 * 86_400_000, end: now - 3_600_000 },
  counts: { user: 38, system: 147, userObservations: 37, systemObservations: 145 },
  context: 'retained',
  limitations: [
    'All means every matching retained record in this snapshot, not every event that ever happened.',
    'Automatic diagnostics are best effort. Unsent browser records and expired observations are unavailable.',
    'Drop counters describe the whole process since server start, not loss for this account.',
  ],
};
