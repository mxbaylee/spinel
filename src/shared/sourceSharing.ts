import type { GrantRole, ItemAccess, SharePerson } from './workspace.ts';

/** Every identity/name here has passed the sharer's current source-read check. */
export interface SourceSharingTarget {
  id: string;
  name: string;
  kind: 'sheet' | 'space';
  sources: { id: string; name: string }[];
  state: 'grant' | 'kept' | 'requires-owner' | 'included';
  access: ItemAccess | null;
}

export interface SourceSharingReview {
  version: string;
  userId: string;
  hostRole: GrantRole | null;
  /** Effective host access after applying the explicitly selected direct role. */
  hostAccess: ItemAccess | null;
  targets: SourceSharingTarget[];
  /** Some sources cannot be reviewed by this actor; says nothing about recipient access. */
  unavailable: boolean;
}

export interface SourceSharingOutcome {
  host: 'updated' | 'unchanged';
  shared: string[];
  /** Authorized targets still requiring another Owner or File admin's grant. */
  failed: string[];
  review: SourceSharingReview;
  /** All dependencies were reviewed and readable; not a guarantee of valid calculation. */
  complete: boolean;
}

export interface SourceSharingResult {
  people: SharePerson[];
  sourceOutcome: SourceSharingOutcome;
}
