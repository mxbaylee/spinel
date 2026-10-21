# Spaces and file roles

Proposed in SPN-047, awaiting [decision #126](https://github.com/mxbaylee/spinel/issues/126).
Spaces are planned files (SPN-078), not new top-level workspaces. Delegated file
Admin follows separately in SPN-079. Neither is a live route in this redesign.

## Comparison and adopted layout

| Existing / planned friction | Reference pattern | Spinel proposal |
| --- | --- | --- |
| A collection could add another dashboard/sidebar layer | Notion's page hierarchy and Numbers' sheet organization | One internal content sidebar replaces outer file navigation while a Space is open |
| Child sharing could suggest separate access | Google sharing separates people/links; Spinel has one Space boundary | One Share action on the outer Space; child pages have no permissions controls |
| Phone trees can consume the whole screen | Dropbox's collapsible navigation | A labelled Pages button opens a modal drawer; choose a page and return to content |
| Admin can be mistaken for server access | No consumer comparison establishes Spinel's policy | “File admin” in file sharing, “Server Operator” in administration |

Sources and access date: [review evidence](redesign.md#evidence-and-comparisons).
Mockups: PlannedSpace, PlannedSpaceGuest, PlannedFileAdmin.

## Navigation and recovery

A Space opens at its remembered/deep-linked page. Its title identifies the Space;
the current page title is subordinate. The internal sidebar supports nested
pages/sheets, explicit expand controls and selection. Add page offers Doc or Sheet.
A page's always-visible More menu exposes Rename, Move/reorder and Trash.
Move has destination and position controls so drag-and-drop is never required.
Back/Forward restores selection. Outer file rename/move/trash remain owner-only
until SPN-079; editing internal structure is an Edit capability.

Space trash is internal, recoverable and reachable by account editors. Restore
returns content without altering its stable IDs/formula bindings. Viewers cannot
mutate the tree. Guest editors may edit/manage the current Space's contents under
SPN-078; guests never see outer folders or account-only recovery/history controls.
Guests navigating a revoked link lose the whole Space, including titles and values.

## Capability matrix

| Capability | View | Edit | File admin (SPN-079) | Owner | Server Operator |
| --- | --- | --- | --- | --- | --- |
| Read authorized content | Yes | Yes | Yes | Yes | No |
| Edit content / Space internal tree | No | Yes | Yes | Yes | No |
| Grant/revoke View, Edit, Admin | No | No | Yes | Yes | No |
| Manage guest links | No | No | Yes | Yes | No |
| Rename/move/trash outer file | No | No | Yes, authorized destinations | Yes | No |
| Permanent deletion / ownership handover | No | No | No | Existing owner rules | Existing recovery rules only |
| Server accounts / backup health | No | No | No | No, everyday account | Yes |

Before SPN-079, only Owner has the file administration capabilities. There is
exactly one Owner, inheriting all file Admin capabilities. Inherited roles use
the most generous effective grant. The UI shows provenance only when readable.
Links are View/Edit only, never Admin. Every Space child inherits the same role,
including future additions; no per-child override or child guest link exists.
Sources outside a Space still require independent access, including formulas.
The Operator's account recovery role never implies permission to browse content.

The optional tree occupies one 224 px column with a visible collapse/reopen
control. It defaults to a drawer at tablet/phone widths. It never appears beside
a second permanent rail. Owner feedback and persona walkthrough, 2026-10-20.
