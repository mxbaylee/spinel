# Live collaboration

Sheets and Docs use Univer collaboration in the application server with SQLite
storage, authenticated access, presence and offline recovery. The integration
uses public SDK interfaces behind a TypeScript boundary. The owner chose this
approach on 2026-10-17 (decision #31), then on 2026-10-19 chose to replace it
with Spinel's own sync: SPN-056 (merging concurrent edits), SPN-057 (the sync
server), SPN-058 (the client) and SPN-059 (moving every document over and
removing Univer collaboration). That grooming retired the SPN-010 limits
experiment and the SPN-013 queue.

## Storage boundary

`src/server/collaboration/service.ts` is the TypeScript boundary around Univer's
public collaboration service and SQLite adapter. Versions are pinned to 1.1.0;
closed-source package implementations are not modified or inspected. Normal SDK
license and watermark behavior remains intact.

The adapter uses the exact application SQLite file. It owns its collaboration
tables; workspace ownership, grants, accounts and images retain their existing
stores. This keeps the online backup from SPN-030 consistent across all data,
without a second database archive or cross-database snapshot protocol. The
constructor refuses a different database path. This choice is recorded in
[decision #37](https://github.com/mxbaylee/spinel/issues/37): it simplifies
recovery for the Operator, preserves the Owner's documents, gives the Collaborator
durable shared state and keeps Link guests behind the same access rules.

Opening an existing Sheet or Doc will migrate its complete native snapshot once.
A persisted `preparing` marker fences old snapshot writes before asynchronous SDK
work starts. A retry uses an existing unit without replacing its edits; an
interrupted creation stays fenced and can be retried. The old snapshot remains
available as migration input. Old tabs must copy unsaved changes before reloading;
they cannot overwrite the new collaboration state. Native reads use the SDK's
public snapshot materializer/converters so confirmed changesets are included.

## Access and lifecycle

The transport authenticates every protocol HTTP request and WebSocket upgrade
against the current Spinel session. Mutation requests and upgrades require the
configured Origin. Tickets expire after 30 seconds, are single-use and are bound
to the same session cookie and one document. Ticket issuance and upgrade require
current read access to that Sheet or Doc; absent scope, missing/revoked grants,
Operator accounts and invalid sessions are refused before the HTTP 101 upgrade.
The browser supplies scope through the public socket URL extension point.
The SDK's connect hook compares ticket and upgrade cookie/scope after upgrade
but before HELLO or JOIN; a mismatch closes with no messages or document data.
Thus an account authorized for both scopes can receive HTTP 101 for a mismatched
ticket, but cannot enter either room with it. JOIN and presence recheck both scope and current access; no client-supplied user ID
can replace the authenticated session. Public links use the document-scoped guest identity described in [sharing](sharing.md);
they grant no account session or unrelated document access. Credentials do not
become a query-token authentication fallback.
HTTP payloads are capped at 10 MiB and socket frames at 64 KiB. At most 64 live
connections are tracked; connections without a room expire after 30 seconds.

[Decision #49](https://github.com/mxbaylee/spinel/issues/49) records the scoped
connection and audit policy. Permission-denied edits emit a structured stderr
`collaboration.edit_denied` event with a timestamp, stage and UUID-shaped account
and document identifiers. Requests, mutation contents, names, cookie values,
session hashes and tickets are never included in this audit. Treat the event as
access-denial evidence, not as a copy of the rejected change. Transport-level
unauthenticated requests are refused before they can reach the edit service.

Service middleware checks current sessions and workspace grants on reads,
submissions, application and final commit. Viewers cannot submit; Operators and
unrelated accounts cannot read. Cross-unit mutation targets are rejected. A
separate public materializer validates the aligned candidate before persistence:
the native document must stay within 10 MiB, and Doc drawing sources must refer
to images uploaded into that same document. Invalid content is a permanent
validation error, never a retryable database failure.

A serialized access scan runs every 500 ms and before final commits. It closes
revoked sessions and invalidates their room memberships before the next change
can broadcast. The SDK's public invalidation API is scoped to a user and unit,
not an individual login: revoking one login can also disconnect that user's
other tabs in the document. Those tabs must reconnect; stale access is never
retained to avoid that inconvenience. Access changes make editors read-only and
ask users to copy unsaved work before reloading. Read-only presentation uses local
permission points, never commands that modify shared document permission rules.

Trash and inherited grants remain governed by workspace access. Permanent
workspace deletion atomically queues an application-owned purge record before
its metadata cascades away. A trusted service call hard-deletes SDK data and
acknowledges the queue only afterward. Startup and a minute timer retry pending
purges; interruption leaves the record for retry. Raw protocol lifecycle calls
cannot invoke this trusted path. Soft trash/restore retains the live state.
These boundaries and the retryable purge were recorded in
[decision #43](https://github.com/mxbaylee/spinel/issues/43).

## Editor behavior

Sheets and Docs load through the public collaboration client. The public
synchronization status stream drives save messages and navigation warnings;
pending or disconnected changes never report saved. Offline editing is enabled
and a synchronized editor remains guarded until the public recovery-cache flush
finishes. A newer edit or access change invalidates an older flush completion;
pending recovery data is never cleared. Preparation warms the candidate validator
before opening the editor without dropping validation of subsequent changes
([decision #47](https://github.com/mxbaylee/spinel/issues/47)). Reconnect retries every second. A public session-service override returns
forwarding handles that omit only ephemeral cursor sends while offline; durable
changes, joins and status streams retain SDK behavior. SDK instances and prototypes
are untouched ([decision #45](https://github.com/mxbaylee/spinel/issues/45)). Renderer language dictionaries are bundled
with the renderer in development and production so first-time text layout never
needs a late network download ([decision #44](https://github.com/mxbaylee/spinel/issues/44)). Image insertion retains its upload and
insertion guard until the drawing mutation has entered synchronization.

Docs also wait for their own page layout, viewport and attached text input before
initial selection and readiness. The global plugin Rendered stage is earlier
than that work; an unresolved selection can intentionally blur the input. The
wait is cancelled on navigation and fails visibly after 30 seconds.

The SDK supplies remote cursors and selected ranges. Spinel adds stable default
profile colours and initial-letter circles in the header and at remote Sheet
cells. Hover/focus reveals the name in an overlay without shifting the layout.
Header and cell buttons select and scroll to a remote Sheet range. Body-text Doc
selections can also be selected from the header; unsupported cursor encodings
remain presence without an invented jump. SPN-036 adds profile customization.
These presence rules came from the owner in chat on 2026-10-17.

Each service/materializer runtime is capped at eight loaded units and evicts
idle units after a minute. This is a cache bound, not a measured capacity claim
for the production host. SDK licence checks and watermarks remain intact.

## Pinned open-source paragraph repair

`npm ci` runs `scripts/dependencies/patch-univer-core.ts` against Apache-2.0
`@univerjs/core` 1.1.0 only. The upstream paragraph composer merges attributes
when an operation requests replacement: leaving a bullet list can look correct
locally but restore a bullet or heading when saved. Its operation slicer also
loses explicit empty paragraph replacement arrays. The repair matches the tested
editor replacement semantics, preserves stable paragraph IDs, and leaves ordinary
COVER behavior unchanged ([decision #46](https://github.com/mxbaylee/spinel/issues/46)).
It is not a general proof of operation-algebra equivalence: removing a paragraph
and then reintroducing it without an ID retains the old ID in composition while
sequential application leaves it absent. The tested editor operations preserve
their IDs; content and formatting matched in the independent replacement matrix.

The installer validates the version and whole-file SHA-256 of both ESM and CJS
builds before writing either, accepts an already repaired installation, and
rejects unfamiliar bytes. It does not read or modify Pro packages. Docker copies
the installer before `npm ci`; the dependency's license stays with its package,
and the patch's attribution is in `THIRD-PARTY-NOTICES.md`.

When upgrading core, first test sequential versus composed replacements,
including missing/empty paragraph arrays and stable identities, and run the rich
Doc/reconnect browser regressions against the unmodified candidate. Remove the
installer and postinstall hook when upstream passes. Otherwise review the new
source and update the narrowly scoped repair and hashes explicitly; never bypass
the guard merely to make installation pass.

## Verification completed

`npm run e2e` builds once and runs development and production sequentially, with
only the matching app server alive and one browser worker. Development retains
Vite modules and HMR but omits Node’s server-file watcher: fixed-source tests do
not exercise autorestart, and watching adds import-tracking IPC, including worker
imports. The normal `npm run dev` command still watches server files. Each build retains
its own traces and disposable database. Tests that need a fresh setup/admin
instance launch and close a real server child rather than retaining a second
SDK/Vite module graph inside Playwright. These controls bound test resources;
both builds still enforce the first committed edit arriving within one second
([decision #48](https://github.com/mxbaylee/spinel/issues/48)).

For a focused run after building, use
`SPINEL_E2E_PROJECT=production npx playwright test e2e/collaboration.spec.ts --project production`;
substitute `development` in both places for the development server. The npm
wrapper deliberately rejects `--project` because it verifies both builds.
Traces are recorded on the first CI retry rather than every successful action,
following [Playwright's performance guidance](https://playwright.dev/docs/best-practices#debugging-on-ci).
A focused development first-edit test exceeded one second while recording every
action, then passed unchanged with tracing off. This is diagnostic evidence of
instrumentation overhead, not a relaxation of the limit: retries still enforce
the same assertions, and CI fails tests that pass only on a retry. Add `--trace on`
to a focused command when debugging locally.

The focused integration tests use the actual pinned service and SQLite adapter:

- Existing Sheet values/formulas and Doc text survive idempotent migration;
  stale snapshot writes are rejected.
- Interrupted migration retries preserve the existing unit and retain its fence.
- Viewer, unrelated-user, Operator, revoked-grant and direct lifecycle checks fail
  closed at the service boundary.
- A real Sheet mutation is committed, materialized as value 99, encrypted through
  SPN-030's archive, restored into a fresh database, reopened through the SDK and
  materialized as the same value. Native Doc data and grants survive as well.

Browser tests separately verify simultaneous Sheet and Doc edits through two
authenticated contexts, strictly within one second from committed input to both
peer views. They also verify name/colour/selection navigation, a full minute of
socket and HTTP disconnection, queued-edit merging in both open views, and
read-only/revocation behavior. The broader suite covers rich text and images,
formulas/formatting/tabs, reload persistence, sharing, trash and authentication.
Both development and production must pass; CI fails flaky-only successes.
Earlier local runs under additional instrumentation/resource pressure exceeded
the latency limit; retain those failures and the subsequent clean-run evidence
in the PR rather than treating the limit as a universal hardware guarantee.

The Sheet browser regression also loses both the HTTP submission response and
the corresponding socket acknowledgement after a real server commit. The client
stays offline and reports unsaved work until explicitly reconnected. Recovery
and a subsequent reload preserve the edit with exactly one durable revision
increment, so an idempotent cell value cannot conceal duplicate application.

## Merging concurrent edits

[`lib/sync-transform/`](../lib/sync-transform/README.md) (SPN-056) merges two
people's concurrent Sheet and Doc edits so both screens end with the same
document. It is the first of the four tickets replacing Univer collaboration,
because the owner chose to rewrite it rather than keep the closed-source
transforms (owner, chat 2026-10-19). It is written from the open-source
mutation definitions only; `@univerjs-pro/collaboration` was never read.

- **Its own package** with Univer as peer dependencies and no server or DOM
  imports, so the sync server (SPN-057) and the client (SPN-058) share it
  (AGENTS.md).
- **Unsupported mutations are rejected, never guessed at.** A wrong guess makes
  two screens drift silently; a rejection is visible and SPN-059 hides the menus
  that produce one. The package README lists them.
- **Conflicts go to the side the server accepted first**, per cell, index or
  key, so the other person's unrelated changes to the same cell survive.
- **Senders inline styles, keep doc paragraph ids, send a removed sheet's
  index, mark a shift's MoveRange and give new docs their drawing
  containers**, because the transforms are stateless and these facts differ
  per client or are missing from Univer's mutations (package README, "What a
  sender must do").
- **The server checks whole-workbook invariants.** Two edits that each keep at
  least one sheet, or one visible sheet, can together remove them all; no
  transform of the pair can see that.
- **Verified against Univer itself.** Each transform pair, and a seeded
  100,000-edit run of two clients and a server, are checked with the real
  open-source handlers running headless.

## Related work and limits

This integration does not establish an unlimited editor count or a
more-than-a-day soak. Rather than measure Univer's limits (the retired SPN-010)
or queue editors past them (the retired SPN-013), SPN-056 to SPN-059 replace it.
SPN-017's raw socket tests cover missing cookies, missing/foreign document scope,
stale sessions, hostile origins, single-use tickets, a second-document JOIN,
viewer edits with a forged owner ID, and downgrade/removal after JOIN. A positive
raw edit control commits the same mutation when authorized; denied writes leave
both the revision and native document unchanged. Mid-application revocation is
also tested before durable commit. Browser tests verify that the affected editor
becomes read-only and revoked sockets receive no later document changes. The SDK
submits durable changes over authenticated HTTP associated with the socket's
member ID; that ID is not an authorization credential. Public link access and history are implemented under [sharing](sharing.md) and
[history](history.md); profile customization remains SPN-036. The one-second browser
acceptance checks do not replace fresh-host capacity/deployment verification.

Public references:
[storage](https://docs.univer.ai/server/collaboration/database-adapters),
[identity](https://docs.univer.ai/server/collaboration/identity-and-authorization),
[middleware](https://docs.univer.ai/server/collaboration/middleware-and-events),
[presence](https://docs.univer.ai/server/collaboration/presence).
