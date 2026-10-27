# @spinel/sync-client

A browser-safe collaboration queue and public Univer 1.1.0 native adapter for
`@spinel/sync-server`. The package owns revision ordering, optimistic rebasing,
native mutation capture and touched-value verification. The host owns transport,
authentication, access rules, presence, editor creation and reload UI. It has no
imports from Spinel's application or the server package at runtime.

## Native editor integration

Create the visible Sheet or Doc with the OSS local history services enabled
(`collaboration: false` in the native preset). Start from the server-prepared
snapshot and revision, then install capture immediately after `createUnit`:

```ts
import { createNativeSyncClient } from '@spinel/sync-client';

const client = createNativeSyncClient({
  univer,
  unitId: snapshot.id,
  kind: 'sheet', // or 'doc'
  snapshot,
  revision,
  send: (frame) => socket.send(JSON.stringify(frame)),
  onState: (state) => updateStatus(state),
  onResync: (reason) => reloadAuthoritativeSnapshot(reason),
});
```

Open each socket with `afterRevision=client.confirmedRevision`. Call
`setConnected(true)` when the transport opens, forward the protocol's `resume`,
`edit`, `ack` and `resync` messages to `receive`, and call `setConnected(false)`
when it closes. Forward presence messages to the host's presence adapter instead.
Opening a socket does not release new unsent edits: a complete ordered `resume`
must first establish the current room state. `retry()` retries the exact original
request, or starts the next buffered batch when the connection is ready.

`state.pending` remains true until the server has acknowledged every queued
document edit and an installed persistence hook has completed. `state.connected`
means transport availability; the host separately establishes room readiness.
`onResync` fires once it is safe to replace the visible editor. It does not fire
while a sent batch still has an unknown outcome, even when the triggering error
was an unrelated stale resume, capacity limit or incoming edit conflict.

`dispose()` removes capture listeners and disposes the private confirmed model.
The host still owns the visible Univer instance and socket.

## Three distinct states

The confirmed native replica contains only server-ordered revisions. One
immutable `SubmitFrame` records the original base revision, mutations and UUID
of the request awaiting an answer. Its separate local `inflight` copy can be
rebased without changing retry identity. Unsent `buffer` groups follow it in
the visible optimistic state.

For a remote edit, both sides of the inflight transform read the confirmed
cells. Both sides of the buffer transform read confirmed cells after the **old**
inflight sequence. Every confirmed advancement applies the exact durable server
output. The visible editor receives the remote output transformed past its
optimistic work; an acknowledgment advances the confirmed copy without applying
the local edit to the visible editor twice.

The protocol broadcasts an `edit` before its corresponding `ack`, and edits do
not identify their sender. While a request is inflight, the client holds ordered
edit frames until `ack.revision` identifies its own edit. It then processes
earlier remote revisions, confirms its own revision once, and drains later
revisions. Reconnect replay uses the same rule. A lost acknowledgment therefore
cannot repeat a row insertion, deletion or other non-idempotent native mutation.

A transformed output is sent unchanged and in order. The transform's
`atomicMutationGroups` helper keeps an absolute cell write and its required tail
together while allowing a larger buffered sequence to drain in bounded batches.

## Native capture and application

`captureNative` uses only public `ICommandService.onMutationExecutedForCollab`
events as its outgoing source. It excludes `onlyLocal`, `fromCollab` and
`fromChangeset`, and retains `syncOnly`. The exact public render-only mutation
IDs `sheet.operation.clear-drawing-transformer` and
`doc.operation.clear-drawing-transformer` are excluded; every other mutation must
pass strict supported-ID and sender-parameter admission. Unknown operation-shaped
mutations are refused rather than silently ignored.

The before-command hook records a removed worksheet's position before removal
and the actual range of insert/delete shift commands. The captured copy carries
that `index`, exact nonempty MoveRange `shift` metadata, and the original
`trigger`. Native `rowInfo`/`colInfo` arrays become equivalent sparse numeric-key
maps for wire admission. Styles are inlined only in native style slots; custom
metadata is opaque. Doc paragraph IDs are realized once before the visible
insertion and inserts carry `PRESERVE_INSERTED_PARAGRAPH_IDS`. Sender-provided
`derived` or transform-private parameter keys are refused.

`applyNative` copies params before each public synchronous handler invocation and
uses `{ fromCollab: true }` for the live editor. That prevents capture echo while
allowing native formula registration and dependent calculation. `onlyLocal` would
skip both for received cell writes, leaving another person's formulas blank or
stale. The confirmed revision replica keeps its separate local-only application
path; it does not drive visible calculation. A two-peer real-engine regression
proves automatic scalar/shared/array results, missed-input recalculation on resume,
authored hashes and absence of echo without forcing a calculation.
The native adapter clears local undo/redo
history after every accepted remote revision, including the Doc history
manager's debounced cache. A remote edit hidden by an optimistic deletion still
invalidates its saved inverse: undoing that deletion could restore pre-peer
content. OSS history also contains inverse coordinates that a remote row or text
insertion can make stale. Own acknowledgments preserve local history. Local
undo/redo works until another person's change arrives; this package does not
claim to rebase native history.

`NativeReplica` creates the same OSS headless handlers and resource-loading
boundary as the server. It reads inline native cells and saves via the public
resource loader. The public Docs drawing plugin manages `DOC_DRAWING_PLUGIN`,
keeping its serialized drawing map and order aligned with the canonical
`drawings` and `drawingsOrder` fields through insertion, updates, deletion and
save/reopen. Loading uses the same native resource contract as the visible
editor, so a stale opaque copy cannot restore earlier drawing data. Unrelated
opaque resources retain their original bytes without replacing managed data.

## Bounds, verification and persistence

Outbound frames fit 64 KiB and at most 1,024 mutations. The optimistic queue is
bounded by 8,192 mutations and 10 MiB; the held incoming history by 128 revisions
and 16 MiB. An indivisible group that exceeds a wire limit fails visibly instead
of splitting a required tail. Snapshot admission, style expansion, native cell
reads and lazy intermediate cell caches have 10 MiB budgets checked before
cloning or retaining expanded values. Long identifiers are charged as part of
addresses, not merely once in the source snapshot.

The capture before-hook and remote adapter check compact native geometry before
each handler runs. They enforce the server's 250,000-cell range and aggregate merge
cache budgets, axis dimensions and 1,024-sheet limit. Merge additions and sheet
insertions include the current workbook's existing merges in that budget, so an
earlier removal can free capacity without letting a compact request allocate an
oversized native `SpanModel`. A server-valid replay is also checked against the
visible optimistic model, whose pending work can already consume that capacity.
`syncOnly` emissions do not execute this handler, so the local capture check does
not count a second structural effect for them.

When pending work is empty, the client hashes the **visible** native model over
the last acknowledged/applied revision's declared footprint. Browser Web Crypto
SHA-256 uses the exact canonical normalization shared with the server. An async
generation fence discards verification results invalidated by a newer edit,
connection change or disposal. The server receives `verify` and decides whether
the authoritative hash agrees.

For a cell with a native formula or shared-formula identity, its calculated `v`
is a local cache and does not enter this authored-content hash. Formula text,
shared identity, array metadata, styles, rich text and custom metadata still do.
Ordinary values remain hashed, including cells with array metadata but no formula
identity. Pinned Univer supplies array spill values through its display
interceptor; they do not replace ordinary raw values in the saved snapshot.

An optional `persist(checkpoint)` hook receives the confirmed snapshot, revision,
immutable sent envelope, rebased inflight and buffered groups. The immutable
request reaches the hook before its first send. Writes are serialized and create
their snapshot only when starting, so a slow store cannot retain a whole
snapshot for every queued keystroke. A failed store keeps the state dirty and
can be retried, including while disconnected. `state.localPersistence` is
`saving`, `saved` or `failed` when a hook exists; `saved` requires every queued
hook call to have completed. The hook must resolve only after its storage
transaction commits. `persistNow()` checkpoints an editor newly opted into local
storage and rejects a failed write. Browser storage, account/access fencing and
cross-tab ownership remain the host's responsibility.

### Restoring an offline queue

Call `validateRecoverySnapshot(checkpoint)` and choose
`checkpoint.recoverySnapshot ?? checkpoint.snapshot` for the visible unit.
Before creating any visible native unit, call `validateNativeSnapshot(snapshot, kind)`
to bound its bytes and compact geometry before the SDK allocates a model.
Pass the checkpoint,
its `revision`, and `preservePendingOnFailure: true` plus
`requireUnchangedResume: true` to `createNativeSyncClient`. The adapter validates
identity and queue budgets, creates the canonical confirmed replica, and applies
the saved inflight/buffer mutations once before capture is installed. Never
pre-apply those mutations in the host. A complete recovery snapshot already
contains the optimistic edits, so the adapter skips queue application for it.
The confirmed replica always starts from `checkpoint.snapshot`. Invalid
checkpoints fail closed.

The preserve policy retains a coherent base and every pending group on refusal,
persists a `failure` marker and stops capture/transport. If an incoming native
application partially fails, recovery uses the checkpoint from before that
frame. A local refusal can happen after a supported native edit has applied but
before its queue admission, such as an edit larger than a wire envelope. In
that case the same checkpoint write retains a canonical, bounded complete
`recoverySnapshot` and the failure marker. If capturing it fails,
`checkpoint.recoveryMissing` and `state.recoveryMissing` remain true and
`state.localPersistence` stays `failed`, even when the marker itself was saved.
Only the original live renderer can retry that capture; a restarted editor
cannot claim that the missing edit was recovered. The host must keep its
unsaved-change warning active while recovery is missing. A restored failure is
attention state and never replays automatically.
The host owns its recovery UI; this does not provide a conflict-copy operation.

An unchanged-resume policy refuses any advanced pending base, including a
crash after server commit but before local acknowledgement cleanup. After an
equal resume, the first replay transport frame carries `expectedRevision`.
The server checks this admission-only fence atomically, before looking up a
receipt; it excludes the fence from the mutation's durable retry identity.
`checkpoint.sent` keeps its original ID, base and mutation body. Peer advancement
before the first send or a raced server commit stops replay. After the first
successful acknowledgement, ordinary live collaboration/rebasing resumes.
This deliberately retains an unneeded attention copy after some lost
acknowledgements rather than replaying an advanced offline base.

Both policies also accept callbacks so a host can enable them when a mounted
editor is downloaded without replacing its optimistic model. The native
adapter's optional `toVisible` and `toCanonical` mappers keep local image URLs in
the displayed editor only: restored/remote mutations use `toVisible`; captured
mutations and visible verification snapshots use `toCanonical`. The confirmed
replica, persisted checkpoints and wire mutations stay canonical.

For another native host, construct `SyncClient` with a `SyncReplica`, a visible
snapshot reader and a remote-application callback. `enqueue` takes a mutation
group already applied optimistically. The normal host should use
`createNativeSyncClient`, which wires that boundary itself.

## Tests

The package tests use real pinned OSS Sheet/Doc handlers and the actual durable
server with an in-memory storage adapter. They cover confirmed/inflight/buffer
rebasing, generated claims and tails, delayed acknowledgments, immutable retries,
stale resumes, refusals, persistence and hash fences, repeated socket loss,
structural native capture, paragraph/undo replay, drawing writes and exact
renderer exclusions, stale inverse invalidation, and expanded-value bounds.
Browser stories separately exercise native drawing UI producers and controls.

Run the repository's guarded serial Lib tests workflow; do not start an
additional local runtime alongside another agent's validation workload.
