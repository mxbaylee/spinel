# Folders and empty documents

The dashboard is the landing page for an everyday account after sign-in. Admin
accounts land in Admin and cannot list, open, create, rename or move documents.
Each everyday account has its own private tree. [Sharing](sharing.md) grants
chosen signed-in people access to specific items; a guest link grants only its explicitly shared file, never folder discovery.

Choose **New**, a type (Folder, Sheet or Doc), and a name. Folders are
created inside the current folder. Documents are created there and immediately
open an empty document view. Their identity, type, name and location are saved;
Sheets open the [spreadsheet editor](spreadsheets.md), Docs open the
[document editor](documents.md). Reloading or returning to
the view does not create another document.

Slides are unsupported: neither creation nor the search type filter offers them,
and the API refuses new `slides` items with "Choose Folder, Sheet or Doc."
Spinel was never in production, so there is no legacy Slides type, placeholder or
migration to maintain. Spinel dropped Slides because Univer's Slides package is
closed Pro software and Spinel is moving off Pro without watermarks (owner, chat
2026-10-19). The owner requested complete removal before the redesign in
[decision #104](https://github.com/mxbaylee/spinel/issues/104), 2026-10-20.

Use the folder list or breadcrumb to navigate. **Rename** updates an item's name
in the list, tree and breadcrumb without reloading. **Move** offers My files (the
root) and owned folders; moving a folder also moves its existing subtree. Its own
folder and descendants are excluded from destinations, and the server rejects
such a request even if sent directly. A refused move changes nothing. Browser
Back and Forward restore navigation; copying the URL opens the same item for its
owner or an authorized recipient while signed in.

Names are trimmed and contain 1–120 characters, without control characters or
slashes. Duplicate names are allowed, since IDs identify items. The move picker
shows full paths to distinguish locations. Owners can [trash and restore](trash.md)
items for 30 days. Tags, pins, search and both content editors are available; see [search](search.md).

## Storage and access

`workspace_items` stores UUID, owner, parent folder (null at root), kind, name and
timestamps in the existing SQLite database. Spreadsheet snapshots use the
[native Univer format](spreadsheets.md). Parent validation, cycle detection and writes run
inside an immediate transaction; a failed rename/move combination rolls back.
SQLite connections wait up to five seconds for another local writer instead of
immediately rejecting a valid save on a brief lock. The owner cannot change an item's owner or kind through the API.

`/api/items` lists or creates items; `/api/items/:id` reads, renames or moves one.
All operations require a current, active, non-admin account. Listing returns owned
items; reading an item, its children and its accessible ancestor chain uses the
[sharing resolver](sharing.md). Organization and sharing changes require ownership.
Inaccessible IDs return the same 404 as missing IDs. Mutations require the configured
origin and JSON. Ordinary item routes require accounts; separate [guest-link routes](sharing.md#guest-links) authorize only the shared document. SQLite schema creation is
additive and keeps existing users, credentials and other data.

These rules retain SPN-006's private ownership and dashboard requirements
(original PRD §2 and SPN-003). [Decision #14](https://github.com/mxbaylee/spinel/issues/14),
2026-10-17, chose one owned tree: a small operational footprint for the Operator,
stable locations and safe moves for the Owner, isolated personal folders for the
Collaborator, and no discovery surface for the Link guest. Univer Workspace is a
useful data-model reference; this implementation copies no code from it.

## Verification

Workspace unit and HTTP tests cover subtree moves, transactional cycle rejection,
invalid parents/names, all document kinds, duplicate names, owner/admin/disabled
account boundaries, origin validation, payload restrictions and SQLite reopen.
Playwright builds a three-level tree, renames a folder, creates and opens each
document type, moves a document, rejects a direct cycle request, follows browser
history, reloads the saved location, and checks mobile width in development and
production.

Tests also verify that creation and search reject Slides, and existing browser
flows check the supported creation and search choices. Dashboard, shell and search
stories use only supported types. The owner approved this removal and waived
screenshots for it in chat on 2026-10-20; the general UI review rule still applies.
