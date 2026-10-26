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
uses `{ onlyLocal: true, fromCollab: true }`. This prevents capture echo and lets
native formula handlers recalculate. The native adapter clears local undo/redo
history after a nonempty remote change, including the Doc history manager's
debounced cache: OSS history contains inverse coordinates that a remote row or
text insertion can make stale. Local undo/redo works until another person's
change arrives; this package does not claim to rebase native history.

`NativeReplica` creates the same OSS headless handlers and resource-loading
boundary as the server. It preserves unknown resources, reads inline native
cells, and saves via the public resource loader. New Docs use the prepared
snapshot's native `drawings` and `drawingsOrder` containers.

## Bounds, verification and persistence

Outbound frames fit 64 KiB and at most 1,024 mutations. The optimistic queue is
bounded by 8,192 mutations and 10 MiB; the held incoming history by 128 revisions
and 16 MiB. An indivisible group that exceeds a wire limit fails visibly instead
of splitting a required tail. Snapshot admission, style expansion, native cell
reads and lazy intermediate cell caches have 10 MiB budgets checked before
cloning or retaining expanded values. Long identifiers are charged as part of
addresses, not merely once in the source snapshot.

When pending work is empty, the client hashes the **visible** native model over
the last acknowledged/applied revision's declared footprint. Browser Web Crypto
SHA-256 uses the exact canonical normalization shared with the server. An async
generation fence discards verification results invalidated by a newer edit,
connection change or disposal. The server receives `verify` and decides whether
the authoritative hash agrees.

An optional `persist(checkpoint)` hook receives the confirmed snapshot, revision,
immutable sent envelope, rebased inflight and buffered groups. The immutable
request reaches the hook before its first send. Writes are serialized and create
their snapshot only when starting, so a slow store cannot retain a whole
snapshot for every queued keystroke. A failed store keeps the state dirty and
can be retried. This is the integration seam for the later offline outbox;
browser storage, restoring checkpoints and cross-tab ownership belong to that
host feature.

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
