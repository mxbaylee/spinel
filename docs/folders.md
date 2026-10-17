# Folders and empty documents

The dashboard is the landing page for an everyday account after sign-in. Admin
accounts land in Admin and cannot list, open, create, rename or move documents.
Each everyday account has its own private tree. Sharing is SPN-015; a link guest
has no access to this tree.

Choose **New**, a type (Folder, Sheet, Doc or Slides), and a name. Folders are
created inside the current folder. Documents are created there and immediately
open an empty document view. Their identity, type, name and location are saved;
Sheets open the [spreadsheet editor](spreadsheets.md); Docs and Slides editors
arrive in SPN-008 and SPN-009. Reloading or returning to
the view does not create another document.

Use the folder list or breadcrumb to navigate. **Rename** updates an item's name
in the list, tree and breadcrumb without reloading. **Move** offers My files (the
root) and owned folders; moving a folder also moves its existing subtree. Its own
folder and descendants are excluded from destinations, and the server rejects
such a request even if sent directly. A refused move changes nothing. Browser
Back and Forward restore navigation; copying the URL opens the same item for its
owner while signed in.

Names are trimmed and contain 1–120 characters, without control characters or
slashes. Duplicate names are allowed, since IDs identify items. The move picker
shows full paths to distinguish locations. Deleting, trash, tags, pins, search,
sharing and the remaining content editors remain separate tickets.

## Storage and access

`workspace_items` stores UUID, owner, parent folder (null at root), kind, name and
timestamps in the existing SQLite database. Spreadsheet snapshots use the
[native Univer format](spreadsheets.md). Parent validation, cycle detection and writes run
inside an immediate transaction; a failed rename/move combination rolls back.
SQLite connections wait up to five seconds for another local writer instead of
immediately rejecting a valid save on a brief lock. The owner cannot change an item's owner or kind through the API.

`/api/items` lists or creates items; `/api/items/:id` reads, renames or moves one.
All operations require a current, active, non-admin owner. Requests for another
account's ID return the same 404 as a missing ID. Mutations require the configured
origin and JSON. No public sharing endpoint exists. SQLite schema creation is
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
