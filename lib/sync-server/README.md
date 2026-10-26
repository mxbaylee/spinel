# @spinel/sync-server

Durable ordering for native Univer 1.1.0 Sheet and Doc edits. This package owns
the queue, transform, open-source materializer and convergence check. It imports
no Spinel application code. The application supplies one storage adapter and the
current authorization policy; there is no speculative second database adapter.

```ts
const server = new SyncServer(storage, {
  authorize(unitId, actor, edit) {
    // Throw unless the exact current credential can read/edit this generation.
  },
  async beforeSubmit(unitId, actor) {
    // Prepare history and evict recipients whose access changed.
  },
  validateSnapshot(unitId, native, actor) {
    // Check application-owned images and other native-content restrictions.
  },
});
const result = await server.submit(
  {
    unitId,
    actorId,
    mutationId, // Stable across reconnect/restart, supplied by the trusted adapter.
    baseRevision,
    mutations,
  },
  actor,
);
// Only now acknowledge result.edit; broadcast only when !result.duplicate.
```

## Durable boundary

`SyncStorage.commit` must synchronously run its `guard`, compare the head against
`expectedRevision`, append the accepted edit/receipt and replace the single live
snapshot in **one transaction**. Throwing leaves all durable state unchanged.
Storage methods are synchronous deliberately: authorization cannot yield between
the guard and the durable edit. SQL connections, sessions, grants, guest links,
Space ancestry and restore generations remain in the application adapter.

The server serializes submissions per unit. After asynchronous `beforeSubmit`,
it authorizes again and performs transformation, candidate validation and the
guarded transaction without another asynchronous gap. A failed native handler,
validation or commit disposes that candidate; the next operation starts from the
durable head. A receipt is bound to `(unitId, actorId, mutationId)` and the exact
request hash. Reusing it with different content is refused. Retried successful
requests return the original accepted revision, even after server restart or
before-image expiry, and do not create another edit. Reads and retries still
require current access.

`exactRevision: true` is for assistant writes: a stale new submission is refused
without a transform. The original receipt remains retryable. The adapter must
derive this flag and `actorId` from trusted ingress, not accept a claimed actor
from a socket body.

## Native snapshots and revision cells

`materialize(snapshot, kind, mutations?)` prepares a new/restored unit using only
open-source Univer handlers and resource APIs. Its public resource loader saves
current managed resources; opaque resource names survive without replacing live
plugin data. Formula custom ranges are native Doc metadata and survive replay.

Each accepted edit stores the exact transform output, including params, claims,
tails and triggers. Its `beforeCells` stores only cells that changed, with their
styles resolved inline. A structural edit records changed coordinates on both
sides, including removed sheets. Sparse rollback over the one live snapshot
reconstructs any retained base without storing a full snapshot per revision.
Each incoming edit transforms past the ordered accepted edits with `side: 'right'`
and the cells at each pair's exact common base. Even a current-head edit passes
the transform's sender validation.

Worksheet positions are also exact-base claims. Before any transform, the server
reconstructs that base's sheet order by reversing retained accepted insertion,
removal and reorder operations over the live order. Each remove index and move
`fromOrder` must name the stated sheet at that exact step, including earlier edits
in the same batch. The transformed candidate repeats this check on today's order.
This uses the accepted operations already retained in the log, with no additional
per-revision snapshot or order image. It prevents forged positional metadata from
making a later transform operate on a different sheet than the native handler.

An adapter retains at most **128 revisions / 16 MiB per unit** of the transform
working set, updating `retainedFrom` and nulling older before-images together.
Accepted mutations, receipts and hashes remain durable. A submission outside
that window resyncs; it is never transformed using today's cells. Missing or
discontinuous retained rows fail closed. `load` returns a native snapshot and its
revision; `SubmitResult.missing` contains the ordered accepted revisions through
the result. An old duplicate receipt may have an empty missing list and require
the adapter to send a fresh snapshot.

## Validation, limits and failures

The native cache holds at most **eight units**, evicting after **60 seconds idle**.
Every eviction and `close()` disposes its native runtime. The queue admits at
most 64 submissions in total. Requests and final native snapshots are bounded by
10 MiB, workbooks by **1,024 worksheets**, batches by 1,024 mutations, nested values by 64 levels / 500,000 nodes,
and the aggregate enumerated range area by 250,000 cells. Oversized requests resync
without attempting an unbounded transformation. These are conservative admission
limits, not a promise that every document below 10 MiB supports every selection.
Axis-only row/column ranges consume the same work budget. Coordinates and counts
must be bounded safe integers, including sparse metadata indices; a missing axis
endpoint cannot fall through to a native loop. Transformed output passes the same
admission again before replay.
Worksheet positions have the same finite bound before transformation, in addition
to their exact-base identity checks. The worksheet cap bounds native unit creation
and the transform's positional window; a compact forged insertion at position
one billion must not allocate its axis model before candidate validation runs.
Native merge caches have a separate **250,000 entry total across all worksheets**.
Initial and restored snapshots validate their compact merge ranges before any
native unit is created. Each later merge or worksheet addition checks the live
aggregate before the native cache rebuild, so many individually bounded edits
cannot accumulate an oversized cache. A preceding merge removal frees its budget.

Every mutation targets the admitted unit, including nested references and the
unit-keyed root of drawing JSON1 operations. Embedded rich-text Docs may refer to
their own embedded ID. Unsupported mutations, malformed/forged claims and every
transform refusal cause an explicit resync. A candidate may not remove every
sheet or hide every sheet. Worksheet IDs, map keys and order must agree, and names
must be unique case-insensitively. Requested final identities are validated before
native handlers can normalize them, and the serialized result is checked again.
Docs retain a string body ending in the native CRLF markers; forged JSONX edits
cannot commit a missing or unterminated body.

`SyncError.code` is fixed, content-free protocol data. Arbitrary native error
strings and document contents must not be returned by the transport or logged in
diagnostics. Application authorization exceptions remain the adapter's concern.

## Divergence and diagnostics

Each receipt stores a SHA-256 hash of its touched native cells (or the native Doc
body). It also stores the `touched` footprint so a pending-free client can compute
the same hash after applying that revision. Same-value writes still contribute
their addresses even when no before-image is needed. `hashTouched` sorts object keys and
cell addresses, resolves styles, ignores derived cell types and decoration
colors, and normalizes native empty Doc collections/text-run splits. Rich-text
and Formula metadata remain in the hash. It does not discard document content to
manufacture convergence. The SHA is a protocol check, never a metric label.

`verify` compares the client's hash against the exact stored revision. A mismatch
returns `false` and records `sync.divergence.detected`; the transport sends the
same resync response as for a refused edit. Invalid/unavailable revisions throw
`stale`. A client at initial revision 1 must load a snapshot before verification;
the first accepted edit is revision 2.

Optional `@spinel/diagnostics` observations use the strict registry and fixed
messages. Mutation labels are allowlisted; unknown sender strings become `other`.
`diagnosticsFor` lets the application enforce per-actor consent and guest rules.
Broken observers never change delivery. No refusal or divergence shapes are
collected: that separate owner decision remains unresolved.
Drop counts by rule and offset counts describe committed outcomes. The server
aggregates them across a submission's transforms and emits them only after its
durable transaction succeeds; failures and duplicate receipts emit neither.
Transform attempts, timing, growth and refusal/invariant observations remain immediate.
The headless native logger is set to `SILENT` through its public service before
plugins or snapshots load, so native warnings and parser errors cannot bypass
the content-free diagnostic boundary.

Browser pending state, presence and sender resync UX belong to SPN-058. Activation,
existing-unit cutover and Pro removal belong to SPN-059 after the retained
SPN-056 integrated review. This package does not enable that cutover.
