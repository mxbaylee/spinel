# Spreadsheets

Create a Sheet from the dashboard to open the Univer editor. Enter values and
formulas, format cells, and add worksheet tabs. Changes save automatically; the
status above the editor distinguishes an active cell edit, pending saves, saved
changes and failures. Press Enter or finish the cell edit to commit its value.
The saved workbook opens again after reload or on another signed-in device.

When disconnected, keep the tab open. Pending changes remain in browser memory
and retry when the connection returns. They are not durable offline storage.
Navigation, sign-out and closing/reloading the page warn about unsaved changes.
If another tab or device has saved a newer revision, the stale tab keeps its
edits and reports the conflict without overwriting the newer document. Copy any
needed changes before reloading. Authentication failures also leave the editor
open so the user can preserve edits. No save button is needed; failed saves have
a retry action.

## Storage and access

The open-source sheets core preset, presets and core packages are pinned together
at Univer 1.1.0. The editor loads only when a Sheet opens. Its current production
chunk is approximately 6.5 MB before compression, so Vite reports a size warning.
Docs, history, imports/exports and co-editing remain separate tickets.
No Pro package or collaboration service is used here.

`sheet_snapshots` stores the complete native `IWorkbookData` JSON produced by
`FWorkbook.save()`, including styles, worksheet order and plugin resources. IDs
match the parent workspace item. The public collaboration server's
`createUnitFromData` accepts this workbook format. Spinel's own sync (SPN-056 to
SPN-059) must load and store the same format. There is no custom cell-only
conversion to migrate.

GET `/api/items/:id/sheet` requires an active, non-admin account with read access;
PUT requires owner/editor access. [Sharing](sharing.md) defines direct and inherited
grants. Viewers use the native read-only editor; link guests have no access. Mutations also require the
configured origin and JSON. Each request is capped at 10 MiB; an oversized save
fails visibly and leaves the previous saved workbook intact.

Floating, cell and background images in existing Sheets render from item-scoped
stored bytes under the same access checks as Doc images; see [Files](files.md).
Inserting new Sheet images is not available yet.

Autosave debounces committed changes for 500 ms and serializes requests. Each
save carries its expected revision and a unique write ID. SQLite updates the
snapshot, revision and item's modification time in one transaction. A retry of
the last identical request returns its existing revision, so a lost HTTP response
does not duplicate a save. Older revisions return 409; newer local edits wait for
the outstanding request's acknowledgement before using the next revision.

These rules preserve SPN-007's single-user editing, native storage compatibility
and visible unsaved-state requirements. [Decision #19](implementation/SPN-007.md#legacy-decision-19-revision-checked-native-sheet-snapshots),
2026-10-17, favours a small SQLite service for the Operator, explicit preservation
of edits for the Owner, conflict detection for the Collaborator's separate tabs,
and continued isolation for the Link guest.

Sources: [Univer preset setup](https://docs.univer.ai/guides/sheets/getting-started/installation),
[workbook facade](https://docs.univer.ai/reference/facade/workbook),
[collaboration snapshot input](https://docs.univer.ai/server/collaboration/quick-start).

## Verification

Unit tests cover complete snapshot round trips, access restrictions, malformed and
oversized input, transactional failure, stale writers, idempotent retries,
serialized edits and retry cleanup. Playwright drives the actual editor to enter
values and formulas, apply bold formatting, add a tab, compare the saved workbook
after reload and open another browser. It also edits offline, rejects navigation
while unsaved, reconnects, loses a committed save's response and tries a stale
write from the other browser. The scenarios run against development and production.
