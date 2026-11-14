/** Deliberate text is admitted only by the dedicated, durable feedback route. */
export const FEEDBACK_LIMITS = {
  messageLength: 2000,
  messageBytes: 8000,
  perMinute: 6,
  globalPerMinute: 60,
  pairLifetimeMs: 5 * 60_000,
  operationTimeoutMs: 30_000,
  artifactBytes: 66 * 1024 * 1024,
  stagingBytes: 3 * 66 * 1024 * 1024,
} as const;
export const FEEDBACK_ROUTES = ['/files', '/files/:id', '/spaces/:id', '/profile'] as const;
export interface FeedbackContext {
  route: (typeof FEEDBACK_ROUTES)[number];
  fileId?: string;
  spaceId?: string;
  runId?: string;
}
export interface FeedbackCollection {
  generation: string;
  binding: string;
  maxMessageLength: number;
  maxMessageBytes: number;
}
export interface FeedbackSubmission {
  id: string;
  generation: string;
  binding: string;
  message: string;
  context: FeedbackContext;
}
export interface FeedbackReceipt {
  id: string;
  generation: string;
  receivedAt: number;
}
export interface FeedbackFlags {
  generation: string;
  actors: string[];
}
export interface FeedbackPair {
  state: 'ready';
  id: string;
  actorId: string;
  generation: string;
  createdAt: number;
  expiresAt: number;
  window: { start: number; end: number };
  counts: {
    user: number;
    system: number;
    userObservations: number;
    systemObservations: number;
  };
  context: 'retained' | 'feedback-only';
  limitations: string[];
}
export type FeedbackPreparation = FeedbackPair | { state: 'empty'; generation: string };
export type FeedbackScope = 'user' | 'system';

export type FeedbackPageContext = FeedbackContext;
export type FeedbackBoundary = FeedbackCollection;
export type FeedbackAcknowledgment = FeedbackReceipt;
export type FeedbackPairReady = FeedbackPair;
export type FeedbackPairPreparation = FeedbackPreparation;
