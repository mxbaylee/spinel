# Offline SDK integration probe — in progress

This is the first bounded investigation for [SPN-039](todo/SPN-039.md), not an
offline feature or acceptance claim. The full [contract](offline.md) remains open.

`e2e/offline-probe.spec.ts` runs against the loopback HTTPS production fixture
with pinned Univer 1.1.0 and Playwright Chromium. It prepares one fresh owned
Sheet or Doc, records its authorized read responses in the test process, then
disconnects HTTP and WebSockets. It commits an edit, closes the entire persistent
browser, opens the same profile offline, commits a second edit and closes/reopens
again. Finally it reconnects, reloads and compares exact content through an
independent authenticated HTTP client that bypasses the browser's fixture cache.

The response fixture stands in for a future local read adapter. It deliberately
includes this synthetic account's bootstrap metadata and permission responses;
production must use the explicit account-scoped store and access lifecycle in
the contract, never cache credentials/authentication responses. Only successful
allowlisted reads/preparation for this one unit are recorded. Session tickets,
write acknowledgements, licensing responses and other origins are not replayed.
The test does not replace document snapshots or pending operations. The SDK's
existing recovery store must survive real browser shutdown and replay normally.

The exact baseline revision is also prepared because the public DataLoaderService
loads pending edits from their cached revision. The fresh fixture has no restored
generation offset. A five-second settling period observes existing SDK behavior;
it is not a durable-save signal or a product guarantee. Unique clipboard sentinels
require fresh copies, and final server reads prevent a local-only false pass.

Run after `npm run build`, with only one guarded local workload, or use the
owner-approved CI-first path when local memory pressure prevents safe testing:

```sh
SPINEL_E2E_PROJECT=mobile-https npx playwright test --project=mobile-https e2e/offline-probe.spec.ts
```

Each scenario logs its last stage, missing fixture reads and response count, and
saves a screenshot. There are no retries. A failed stage is integration evidence,
not grounds to close the ticket. The initial text-only probe must be extended to
existing images, concurrent peers, lost acknowledgements and the remaining
storage/access lifecycle. Actual Android and iPhone installed-app evidence is
still required. No actual-device acceptance result has yet been recorded.

## Initial fixture diagnosis

CI 39196316063 on `25366cd` passed 228 unit tests and the 54 desktop browser
tests, but the Sheet probe failed before its first online saved state. It recorded
19 fixture responses and no cache misses; the Doc probe and PWA case were stopped
by the configured first-failure limit. This is not cold-start evidence.

A separate guarded HTTPS/WebSocket echo fixture reproduced Chromium's
`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` when its HTML was fulfilled by
Playwright. Granting `local-network-access` only to that loopback origin made the
same test connect, with its original cookie and Origin present. The SDK probe now
grants that test-only permission on every browser launch. It also lets online
non-fixture requests use the normal browser path and records sanitized connection
errors. Application authentication and explicit offline blocking are unchanged.
The revised SDK probe must still run; the echo result alone proves no SDK behavior.
The permission API is documented in
[Playwright's browser context reference](https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions).

The corrected transport run (39197669664, bf20705) completed the online Sheet
connection, edit and reload with exact content verification. It then stopped
before disconnection because the probe incorrectly treated any truthy protocol
error code as failure; the public protocol defines `ErrorCode.OK` as `1`. The
probe now checks the exported success value and the returned snapshot unit ID.
This was a harness assertion defect, not evidence of an offline SDK failure.
No cold restart result was obtained from that run. Development and production
passed all 54 existing browser cases; the remaining HTTPS cases did not run.

Run 39198764871 (2d520b9) reached the second cold offline browser launch. The
first cold recovery and second offline edit passed exact copy checks. The
second-launch screenshot shows both expected cell values, but copying left the
fresh clipboard sentinel unchanged, so reconnect/server agreement did not run.
An injector error was recorded without a stage; it cannot yet be attributed to
copying, loading or teardown. There were no missing cached reads, although the
fixture had omitted the shared-items catalog read. The next probe explicitly
waits for Spinel's post-loader accessibility/readiness markers, brings the page
to the foreground, and records stage/stack/focus diagnostics without weakening
the fresh clipboard or exact content assertions. The shared-items read is now
part of the same single-account fixture allowlist. This evidence demonstrates
rendered retained values, not completion of the offline contract.

Run 39199924068 (6a1c809) completed the Sheet probe: both offline browser
restarts, the second edit, reconnect, reload and independent server agreement
passed. Its diagnostics, cache misses and blocked requests were empty. This is
a text-only fixture result, not the full offline feature or device acceptance.
The Doc probe stopped before going offline: after its initial reload the page
was blank with zero words, and copying did not replace the sentinel. Its saved
status could still describe the pre-input state when the reload began. The
probe now waits for editor readiness before input and for exact independent
server content before the baseline and reconnect reloads. It still requires
fresh exact copies after every restart; no assertion has been removed. The
54 development/production cases passed without retries; the later PWA case
did not run because of the first-failure limit.

The next probe adds an existing Doc image through the normal upload/insert UI.
Only that fixture item's image GETs join the allowlist. Every reload and cold
launch must render the solid-color fixture image on the editor canvas; successful
HTTP responses alone cannot pass this check. Final server checks preserve the raw baseline text stream (including its image
marker), the inserted prefix, shifted custom-block links, and the original
drawing ID, source and dimensions. This is not a full rich-body equality claim. Sheet image support, concurrent peers and the remaining
contract are still outstanding. CI 39202913905 exercised the image through the first cold launch; the second-launch text failure prevented its later image/server assertions.

Run 39201195300 (84dc808) established the Doc baseline and reached its second
cold restart, where fresh copying and the screenshot both showed duplicated
text: `Cold-secondOffline-retainedOffline-retainedBaseline`, instead of
`Cold-secondOffline-retainedBaseline`. The first restart and immediate second
edit checks had passed; the divergence appeared during the next persistence/
replay cycle. There were no misses, blocked requests or diagnostics. Sheet passed
end to end again, and all 56 development/production cases passed without retries.
This is an unresolved Doc recovery defect; reconnect did not run for Docs.

Temporary CI-only instrumentation reads the public `ILocalCacheService` before
loading and at the probe's settling/restart checkpoints. It requires the compiled
`SPINEL_RECOVERY_PROBE=1` flag, exact loopback HTTPS origin and explicit probe query.
It records only the newly created synthetic fixture's public recovery payload.
It does not modify SDK instances, flush tasks, edit cache data or inspect Pro
implementation/storage internals. Remove this diagnostic bridge before landing;
normal builds compile it disabled. Exact content assertions remain required.

Run 39202913905 (9ef1b98) reproduced the exact Doc duplicate with the retained
image. All 242 unit and 56 desktop browser cases passed; Sheet passed its full
bounded probe again. Public cache records isolate the divergence: revision 3,
no awaiting changeset, one `Offline-retained` mutation before and just after the
first cold load; after entering `Cold-second`, the stored mutations are
`[Offline-retained, Offline-retained, Cold-second]`. The second cold load reads
that already duplicated queue. This does not yet distinguish cache aliasing/
write ordering from duplicate arguments supplied by the collaboration entity.

The next diagnostic uses a host implementation of the public `ILocalCacheService`
through the UI plugin's supported dependency override. It clones input arguments
immediately, returns fresh clones, serializes IndexedDB record replacements and
traces public method calls. It preserves every operation and awaiting identity;
it never deduplicates text, drops mutations or creates acknowledgements. This is
restricted to the same CI flag and loopback origin plus `host-cache=1`, and stores
only synthetic pending records, not complete downloads. The original native-cache
failure remains evidence. Remove diagnostic code before landing, and repeat any
passing fix without extra cache reads before calling it verified.

The Doc diagnostic also observes public rich-text command attempts and the OSS
`DocStateEmitService` / `DocStateChangeManagerService` event streams. It projects
only actions, unit/segment, trigger and synchronization flags, excluding transient
layout objects. Each observer has its own ID and monotonic sequence; the CI log
adds launch-stage context. Observers never alter parameters, state or cache data.
An instrumentation error cannot interrupt a command and is a test failure. A
before-command event proves only attempted execution; correlate it with state
emissions, persisted records and exact rendered/server content. Logging and extra
reads can affect timing, so any eventual fix still needs an uninstrumented run.

Run 39204554726 (eae44d5) reproduced the Doc duplicate with the asserted host
cache installed. Its public update call already contains two `Offline-retained`
mutations immediately after the first cold load, before the second user edit;
the next restart similarly appends another copy of `Cold-second`. Thus the
adapter receives duplicated input; changing its serialization did not repair it.
The exact content assertion still fails at the second cold launch. Sheet's
bounded text probe passed again; Doc reconnect and final image checks did not run.
The new public event diagnostic above is the next experiment, not a fix.

That run also found replay image validation consuming Sheet block bytes; validation
now receives deep copies and the regression asserts provider-input immutability.
Two new unit assertions incorrectly expected thrown submission errors instead of
the SDK's structured rejected result and are corrected. These repairs need CI.
The imported Sheet-image browser cases rendered all three images on live/reload/
preview paths, but did not pass: desktop's immediate post-interaction canvas
sample was flaky (the failure screenshot still shows the unchanged image), and
mobile expected a desktop-only Bold toolbar button. The test now waits for the
exact original bounds after each Delete/drag attempt and keeps those image checks
on mobile. Those revised tests also need CI; no new image acceptance pass is claimed.

Run [39211791687](https://github.com/mxbaylee/spinel/actions/runs/39211791687)
(09ac401) passed all 291 unit tests, all 30 development and 30 production browser
cases without retries, and the expanded Sheet probe with three offline launches
and existing images. The Doc probe failed at the newly added redo step: its
Windows-style browser fixture used Ctrl+Shift+Z, while the public OSS UI binds
redo to Ctrl+Y on that platform. The fixture now uses that binding. The expanded
Doc run and subsequent PWA case still require fresh passing evidence.

The next bounded transport probe uses `transport-probe=1`, the same compile flag
and HTTPS loopback restriction. It installs the prepared access gate at the
public HTTP implementation and collaboration socket-service extension points.
It requires a real saved Sheet/Doc edit, account-bound requests, stale ticket
rejection, connection closure and no further frames/requests after locking.
These adapters do not yet provide downloads, local persistence or app startup.
Pure contract tests cover an SDK hook bypass, overlapping attempts and a delayed
ticket that ignores cancellation across a new access epoch; real SDK engagement
is separately required from the browser probe. Server account binding supplements
ordinary cookie, document and generation authorization and is never a credential.

Run [39213868958](https://github.com/mxbaylee/spinel/actions/runs/39213868958)
(6194b77) passed 335 unit tests, all 60 development/production browser cases,
both expanded cold-restart probes and the HTTPS PWA scenario. The Doc redo fix
passed, including the later lost-acknowledgement replay and unchanged final server
state. The new Sheet transport probe stopped before loading because network was
registered both by the core preset and the explicit plugin list; the Doc transport
probe did not run. Configure the existing network registration with a final public
preset instead. This repair still needs a fresh real-SDK browser pass.

## Recovery completion experiment

The next bounded fixture enables `recovery-ledger=1` alongside the existing
loopback-only, build-time recovery flag. It uses `RecoveryCommands` to account
for exact original entries for both document types. Diagnostic reads bypass the
SDK loader; repeated SDK reads receive separate registered parameter objects.
The editor container stays inert while the facade loader and public
`CollaborationController.readyForCollab(unitId)` promise resolve.

During that interval, public cache saves, updates and clears write separate
IndexedDB staging keys. The original pending record remains unchanged. The probe
drains observed transactions, reads the final staged record and repeats when a
new cache invocation arrived during that read. It requires successful execution
of every original entry and an actual complete cache callback equal to the
original queue, including revision and awaiting identity. Absent, cleared or
changed final queues fail the experiment. A late duplicate or access failure
invalidates its evidence and quarantines subsequent writes. No staged result
opens `OfflineAccess` remote approval.

This is an experiment awaiting CI, not the production store or a documented SDK
completion guarantee. A stable observed sequence cannot prove no future callback
exists. Deferred-execution/write and complete local-adapter/transport-barrier
experiments still have to establish that boundary before product integration.
No protected collaboration-state fields, timer-based completion assumptions,
content deduplication or synthetic acknowledgements are used.
