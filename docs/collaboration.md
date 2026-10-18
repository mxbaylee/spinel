# Live collaboration implementation checkpoint

SPN-012 is in progress. The service, HTTP/WebSocket transport and browser editors are
now integrated. Browser regressions and full acceptance verification are still
in progress; do not deploy this branch as a completed collaboration feature.

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
to the same session cookie at upgrade. Operators cannot enter document rooms.
HTTP payloads are capped at 10 MiB and socket frames at 64 KiB. At most 64 live
connections are tracked; connections without a room expire after 30 seconds.

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
only the matching app server alive and one browser worker. Each build retains
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

These tests do not establish the two-browser acceptance criteria below.

## Work remaining before review and merge

1. Finish real two-context Sheet and Doc typing, within-a-second remote updates,
   minute-long socket loss, reconnect and live-revocation assertions.
2. Complete rich-text/image, formatting/formula/tab and sharing regressions; run
   full unit, type, lint, backlog and development/production browser checks.
3. Independently review the original ticket, repair in-scope findings, reach at
   least 95/100 with no blockers, retire SPN-012/update dependents/index, and wait
   for all six checks on that SHA before squash merge.

SPN-010's separately running limits experiment is not a dependency. SPN-017 adds
adversarial hardening; it does not excuse missing baseline authorization here.

Public references:
[storage](https://docs.univer.ai/server/collaboration/database-adapters),
[identity](https://docs.univer.ai/server/collaboration/identity-and-authorization),
[middleware](https://docs.univer.ai/server/collaboration/middleware-and-events),
[presence](https://docs.univer.ai/server/collaboration/presence).
