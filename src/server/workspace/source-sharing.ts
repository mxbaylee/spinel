import { createHash } from 'node:crypto';
import { docFormulas } from '@spinel/doc-formulas';
import type { GrantRole, ItemAccess, SharePerson } from '../../shared/workspace.ts';
import type {
  SourceSharingResult,
  SourceSharingReview,
  SourceSharingTarget,
} from '../../shared/sourceSharing.ts';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import {
  resolveDocument,
  sourceDocumentContext,
  validateDocumentCredentials,
} from './document-access.ts';
import { WorkspaceFiles } from './files.ts';
import { SpaceStore } from './spaces.ts';
import type { WorkspaceStore } from './store.ts';

// Refusal budgets, not truncation: a review either describes the complete direct
// dependency set or offers host-only sharing without claiming sources were checked.
export const SOURCE_SHARING_LIMITS = {
  documents: 128,
  sources: 256,
  snapshotBytes: 32 * 1024 * 1024,
  ranges: 1024,
  ancestorReads: 10_000,
} as const;
const tooLarge = () =>
  new AuthError(
    413,
    'There are too many formula sources to review at once. Share the report alone.',
  );
const changed = () =>
  new AuthError(409, 'Formula sources changed. Review the updated list before sharing them.');
const unavailable = (error: unknown) =>
  error instanceof AuthError && (error.status === 403 || error.status === 404);
const strength: Record<ItemAccess, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

/** Account-only, synchronous source review and exact-plan confirmation. */
export class SourceSharing {
  private readonly workspace: WorkspaceStore;
  private readonly collaboration?: CollaborationStore;
  private readonly files: WorkspaceFiles;
  private readonly spaces: SpaceStore;

  constructor(workspace: WorkspaceStore, collaboration?: CollaborationStore) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    this.files = new WorkspaceFiles(workspace);
    this.spaces = new SpaceStore(workspace);
  }

  review(
    actor: string,
    id: string,
    userId: unknown,
    role: unknown,
    custom: Record<string, unknown>,
  ): SourceSharingReview {
    return this.workspace.auth.transaction(() => this.plan(actor, id, userId, role, custom));
  }

  apply(
    actor: string,
    id: string,
    userId: unknown,
    role: unknown,
    version: unknown,
    custom: Record<string, unknown>,
  ): SourceSharingResult {
    if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version))
      throw new AuthError(400, 'Review formula sources before sharing them.');
    return this.workspace.auth.transaction(() => {
      // The final current-snapshot/credential/grant checks and every grant share
      // one writer transaction. There is no asynchronous authorization gap.
      const review = this.plan(actor, id, userId, role, custom);
      if (review.version !== version) throw changed();
      if (!review.hostAccess)
        throw new AuthError(
          400,
          'Give this person access to the report before sharing its sources.',
        );
      const recipient = review.userId;
      const before = this.person(actor, id, recipient);
      const hostChanged = before.directRole !== review.hostRole;
      if (hostChanged) this.files.share(actor, id, recipient, review.hostRole);
      const shared: string[] = [];
      for (const target of review.targets) {
        if (target.state !== 'grant') continue;
        // Existing effective access, including ownership and folder inheritance,
        // never receives a redundant write or a changed shared_at timestamp.
        this.files.get(actor, target.id, 'admin');
        if (this.access(recipient, target.id)) throw changed();
        this.files.share(actor, target.id, recipient, 'viewer');
        shared.push(target.id);
      }
      const after = this.plan(actor, id, recipient, review.hostRole, custom);
      const failed = after.targets
        .filter((target) => target.state === 'requires-owner' || target.state === 'grant')
        .map((target) => target.id);
      return {
        people: this.files.sharing(actor, id),
        sourceOutcome: {
          host: hostChanged ? 'updated' : 'unchanged',
          shared,
          failed,
          review: after,
          complete: !after.unavailable && failed.length === 0,
        },
      };
    });
  }

  private person(actor: string, id: string, userId: unknown): SharePerson {
    if (typeof userId !== 'string') throw new AuthError(400, 'Choose an active everyday account.');
    const person = this.files.sharing(actor, id).find((candidate) => candidate.id === userId);
    if (!person || person.disabled) throw new AuthError(400, 'Choose an active everyday account.');
    return person;
  }

  private access(userId: string, id: string): ItemAccess | null {
    try {
      return this.files.get(userId, id).access;
    } catch (error) {
      if (unavailable(error)) return null;
      throw error;
    }
  }

  private projectedAccess(userId: string, id: string, role: GrantRole | null): ItemAccess | null {
    const row = this.workspace.auth.database
      .prepare('SELECT parent_id,owner_id FROM workspace_items WHERE id=?')
      .get(id) as { parent_id: string | null; owner_id: string };
    const parent = row.parent_id
      ? this.workspace.auth.database
          .prepare('SELECT kind,owner_id FROM workspace_items WHERE id=?')
          .get(row.parent_id)
      : undefined;
    const inherited =
      parent?.kind === 'folder' && parent.owner_id === row.owner_id
        ? this.access(userId, row.parent_id!)
        : null;
    return inherited && (!role || strength[inherited] > strength[role]) ? inherited : role;
  }

  private plan(
    actor: string,
    id: string,
    userId: unknown,
    inputRole: unknown,
    custom: Record<string, unknown>,
  ): SourceSharingReview {
    if (validateDocumentCredentials(this.workspace, actor, custom) !== 'account')
      throw new AuthError(401, 'Sign in with your everyday account.');
    const host = this.files.get(actor, id, 'admin');
    if (host.kind !== 'doc' && host.kind !== 'space')
      throw new AuthError(400, 'Choose a Doc or Space to review formula sources.');
    if (!['viewer', 'editor', 'admin', null].includes(inputRole as string | null))
      throw new AuthError(400, 'Choose Viewer, Editor, File admin or No direct access.');
    const role = inputRole as GrantRole | null;
    const recipient = this.person(actor, id, userId);
    if (!this.collaboration)
      throw new AuthError(503, 'Formula source review is unavailable. Share the report alone.');

    const lookup = this.workspace.auth.database.prepare(
      'SELECT parent_id FROM workspace_items WHERE id=?',
    );
    let reads = 0;
    const spendAncestry = (itemId: string) => {
      const seen = new Set<string>();
      let cursor: string | null = itemId;
      while (cursor && !seen.has(cursor)) {
        if (++reads > SOURCE_SHARING_LIMITS.ancestorReads) throw tooLarge();
        seen.add(cursor);
        const row = lookup.get(cursor) as { parent_id: string | null } | undefined;
        cursor = row?.parent_id ?? null;
      }
    };
    spendAncestry(id);
    const documents =
      host.kind === 'space'
        ? this.spaces.list(actor, id).items.filter((item) => item.kind === 'doc')
        : [host];
    if (documents.length > SOURCE_SHARING_LIMITS.documents) throw tooLarge();
    const sources = new Map<string, { hostId: string; custom: Record<string, unknown> }>();
    const generations: [string, string][] = [];
    let bytes = 0;
    for (const doc of documents) {
      spendAncestry(doc.id);
      const context =
        host.kind === 'space' ? { ...custom, spaceId: id, spaceItem: doc.id } : custom;
      const saved = this.collaboration.committedDocumentSnapshot(
        actor,
        doc.id,
        context,
        SOURCE_SHARING_LIMITS.snapshotBytes - bytes,
      );
      bytes += saved.byteLength;
      generations.push([doc.id, saved.unitId]);
      if ((saved.snapshot?.body?.customRanges?.length ?? 0) > SOURCE_SHARING_LIMITS.ranges)
        throw tooLarge();
      for (const formula of docFormulas(saved.snapshot?.body)) {
        for (const reference of formula.definition.references) {
          sources.set(reference.itemId, { hostId: doc.id, custom: context });
          if (sources.size > SOURCE_SHARING_LIMITS.sources) throw tooLarge();
        }
      }
    }
    const targets = new Map<string, SourceSharingTarget>();
    let inaccessible = false;
    for (const [sourceId, sourceHost] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
      spendAncestry(sourceId);
      let source: ReturnType<typeof resolveDocument>;
      let context: Record<string, unknown>;
      try {
        context = sourceDocumentContext(
          this.workspace,
          actor,
          sourceHost.hostId,
          sourceId,
          sourceHost.custom,
        );
        source = resolveDocument(this.workspace, actor, sourceId, 'read', context);
        if (source.kind !== 'sheet') {
          inaccessible = true;
          continue;
        }
      } catch (error) {
        if (!unavailable(error)) throw error;
        inaccessible = true;
        continue;
      }
      const targetId = typeof context.spaceId === 'string' ? context.spaceId : sourceId;
      const previous = targets.get(targetId);
      if (previous) {
        previous.sources.push({ id: source.id, name: source.name });
        continue;
      }
      spendAncestry(targetId);
      const target = this.files.get(actor, targetId);
      const access = this.access(recipient.id, targetId);
      let state: SourceSharingTarget['state'];
      if (host.kind === 'space' && targetId === id) state = 'included';
      else if (access) state = 'kept';
      else {
        try {
          this.files.get(actor, targetId, 'admin');
          state = 'grant';
        } catch (error) {
          if (!unavailable(error)) throw error;
          state = 'requires-owner';
        }
      }
      targets.set(targetId, {
        id: targetId,
        name: target.name,
        kind: target.kind === 'space' ? 'space' : 'sheet',
        sources: [{ id: source.id, name: source.name }],
        state,
        access,
      });
    }
    const details = {
      userId: recipient.id,
      hostRole: role,
      hostAccess: this.projectedAccess(recipient.id, id, role),
      targets: [...targets.values()].sort((a, b) => a.id.localeCompare(b.id)),
      unavailable: inaccessible,
    };
    validateDocumentCredentials(this.workspace, actor, custom);
    this.files.get(actor, id, 'admin');
    const version = createHash('sha256')
      .update(
        JSON.stringify({
          actor,
          id,
          hostName: host.name,
          currentHostRole: recipient.directRole,
          generations: generations.sort(([a], [b]) => a.localeCompare(b)),
          // Hidden references affect freshness but never appear as response metadata.
          dependencies: [...sources.keys()].sort(),
          ...details,
        }),
      )
      .digest('hex');
    return { version, ...details };
  }
}
