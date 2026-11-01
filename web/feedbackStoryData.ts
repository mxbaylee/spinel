import type { FeedbackPairReady } from '../src/shared/feedback.ts';

export const feedbackActor = '11111111-1111-4111-8111-111111111111';
export const feedbackGeneration = '22222222-2222-4222-8222-222222222222';
export const feedbackPair: FeedbackPairReady = {
  state: 'ready',
  id: '44444444-4444-4444-8444-444444444444',
  actorId: feedbackActor,
  generation: feedbackGeneration,
  createdAt: Date.now(),
  expiresAt: Date.now() + 5 * 60_000,
  window: { start: Date.UTC(2026, 9, 30, 9), end: Date.UTC(2026, 10, 1, 14, 30) },
  counts: { user: 38, system: 147, userObservations: 37, systemObservations: 145 },
  context: 'retained',
  limitations: [
    'All means every matching retained record in this snapshot, not every event that ever happened.',
    'Automatic diagnostics are best effort. Unsent browser records and expired observations are unavailable.',
    'Drop counters describe the whole process since server start, not loss for this account.',
  ],
};
