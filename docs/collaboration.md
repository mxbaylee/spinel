# Live collaboration implementation checkpoint

SPN-012 is in progress. The application still uses its existing native snapshot
editors. The new server module is tested independently and is **not yet attached
to the application's HTTP server or browser editors**. Do not deploy this branch
as a completed collaboration feature.

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

Service middleware currently checks active users and workspace grants on reads,
submissions, application and commit. Viewers cannot submit; Operators and unrelated
accounts cannot read. Raw unit creation/deletion/recovery is denied except the
trusted migration path. These checks are one boundary, not a substitute for
HTTP/session and realtime room authorization.

## Verification completed

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

1. Attach authenticated HTTP and WebSocket transports, including strict Origin,
   bounded payloads, one-time session tickets, current session checks and room
   joins. Use the public endpoint session invalidation API for grant/account/
   session changes; test that a revoked connection cannot receive later edits.
2. Coordinate trash, folder moves, permanent purge and restore with live rooms
   and SDK storage. Do not leave permanently deleted document data in SDK tables.
   Test inherited permission changes and interrupted operations.
3. Wire native Sheet and Doc editors to the collaboration facade. Preserve image
   upload validation, save/unsaved navigation messages, readonly behavior and
   existing content; return current materialized data from existing native APIs.
   Validate changed drawing sources and cross-unit mutations on the server.
4. Implement named/coloured presence, remote cursors/selections and keyboard-
   accessible header controls that jump to a collaborator without layout shifts.
   Profile customization remains SPN-036; use documented defaults until it ships.
5. Exercise real two-context Sheet and Doc typing, simultaneous changes within a
   second, minute-long socket loss with offline edits, reconnect, server restart,
   permissions/revocation, image persistence and encrypted recovery. Check memory
   on the intended small host, preserve SDK limits/watermarks, and run full CI.
6. Independently review the full original ticket, fix in-scope findings, achieve
   at least 95/100 with no blockers, retire SPN-012/update dependents/index, and
   wait for all six checks at that exact SHA before squash merge.

SPN-010's separately running limits experiment is not a dependency. SPN-017 adds
adversarial hardening; it does not excuse missing baseline authorization here.

Public references:
[storage](https://docs.univer.ai/server/collaboration/database-adapters),
[identity](https://docs.univer.ai/server/collaboration/identity-and-authorization),
[middleware](https://docs.univer.ai/server/collaboration/middleware-and-events),
[presence](https://docs.univer.ai/server/collaboration/presence).
