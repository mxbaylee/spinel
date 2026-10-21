# File list (dashboard)

## SPN-047 composed redesign proposal

Awaiting [owner approval](https://github.com/mxbaylee/spinel/issues/126).
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Dashboard, Search, SharedFiles, Trash, EmptyFolder, LoadingFiles, FileError.

| Current friction | Public reference pattern | Adopted proposal |
| --- | --- | --- |
| Separate pins, folders and shared panels; a wall of row actions; a large heading above search. | Dropbox separates file navigation from actions; Notion combines favorites and hierarchy in a sidebar. | One file sidebar; search above rows; one New menu and one always-visible row menu. Access labels remain visible. |

The redesigned header places search in its own tools row below the title, rather than squeezing it beside the breadcrumb. File type remains a compact selector; extra filters are disclosed with active values shown. At phone width Browse files opens a modal navigation drawer. The selected folder becomes the page title, with ancestors as a compact breadcrumb. No second pinned column.

The proposal above governs placement after approval. Existing behavioral and
permission rules below still apply; production migrations remain separate tickets.


SPN-048 builds this page's layout. Design changes made while building go back
into this page, not only into the PR.

## How others do it

|              | Google Sheets / Drive                             | Excel for the web / OneDrive | Numbers for iCloud          | Zoho Sheet / WorkDrive |
| ------------ | ------------------------------------------------- | ---------------------------- | --------------------------- | ---------------------- |
| Create       | One "New" button, top left                        | "Create or upload" / "+ New" | "+" (create) at top         | "New" button           |
| Search       | Wide field across the top, filter chips under it  | Search box in the header     | Search field in the toolbar | Search in the header   |
| Shared items | "Shared with me" in the left nav                  | "Shared" view                | "Shared" in the sidebar     | "Shared with me"       |
| Row actions  | `⋮` per row, always tappable; more on right-click | `⋯` per row                  | `⋯` per file                | `⋯` per row            |
| Views        | List / grid toggle                                | List / tile                  | Grid / list                 | List / grid            |
| Import       | Inside "New" (File upload), plus drag and drop    | Inside "Create or upload"    | Upload button               | Inside "New"           |

The shared pattern: one New button that also holds import, a wide search with
filter chips, "Shared with me" as a place in the nav rather than a panel, and
one menu button per row.

## Spinel today

Search panel above everything; a "Shared with me" toggle that opens a drawer
above the list; New, Refresh folder and Import as three separate buttons; and up
to six text buttons on every row (Pin, Tags, Share, Rename, Move, Trash). A
shared row adds a `↗` drag button, its access label, "File into folder" and,
once filed, "Remove from my folder". All four areas are cluttered (owner, chat
2026-10-19).

## Adopted layout

```
┌ sidebar ─────────┬ header ───────────────────────────────────────────┐
│ My files         │ My files / Budgets              [ Search… ] [ New ▾]│
│ Shared with me   ├───────────────────────────────────────────────────┤
│ Pinned  (list)   │ [All] [Sheets] [Docs] [Tagged ▾]       ← filter chips │
│ Folders (tree)   ├───────────────────────────────────────────────────┤
│                  │ ▦ Q3 forecast   Shared · View only  #ops  Oct 12  ⋯ │
│                  │ ▤ Notes                            #ops  Oct 10  ⋯ │
│ Trash            │                                                    │
│ ● Online         │                                                    │
└──────────────────┴───────────────────────────────────────────────────┘
```

- **Header:** the breadcrumb is the title. Search on the right, then the single
  primary **New** button. New opens a menu: Folder, Sheet, Doc, then a divider
  and Import file…. Dropping files on the list still imports (SPN-031).
- **Filters:** chips under the header, shown only while searching or when a
  filter is active, so an unfiltered folder has no chip row. Kind chips, a Tags
  chip with a menu, and in search "Shared with me" (SPN-022). Clear filters is
  the last chip when any is on.
- **Shared with me** is a sidebar place, like My files. It lists shared items
  with "Shared by" and the share date in the secondary column. Filing a shared
  reference into a folder (SPN-018) is **File into folder…** in the row menu,
  and dragging the row onto a sidebar folder still works. The `↗` handle goes.
- **Pinned** (SPN-020) is a short list in the sidebar; a pinned row also shows a
  pin badge.
- **Trash** sits at the bottom of the sidebar, above the connection indicator
  (SPN-042), which states online/offline/reconnecting and never claims anything
  is saved on the device.
- **Rows** follow the [row pattern](README.md#row). The secondary column is the
  edited date in My files and the shared date in Shared with me.
- **Folder actions** (Rename, Move, Share, Refresh folder, Trash) are the More
  menu next to the breadcrumb title, the same items as the folder's row menu.
- **Grid view:** not adopted. With about two people's documents, a list is
  enough.

### Always visible / behind a menu

| Always visible                                                             | Behind a menu                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| New (primary), search, breadcrumb                                          | New → Folder, Sheet, Doc, Import file…                                                                              |
| Sidebar: My files, Shared with me, Pinned, folders, Trash, connection      | Owned row ⋯ → Open, Pin/Unpin, Tags…, Share…, Rename…, Move…, Available offline on this device, Trash               |
| Row: icon, name, shared/view-only/pinned/offline badges, two tags, date, ⋯ | Shared row ⋯ → Open, Pin/Unpin, Tags…, File into folder… or Remove from my folder, Available offline on this device |
|                                                                            | Folder ⋯ → the owned-row items that apply to folders, plus Refresh folder                                           |
| Filter chips while searching or filtering                                  | Tags chip → tag list                                                                                                |

Access ("View only", "Can edit") stays a visible badge because it decides what
the person can do once they open the item. The shared-row menu never offers
Share, Rename, Move or Trash: only the owner can (docs/sharing.md). "Remove from
my folder" removes the person's filed reference, not the item, so it isn't
grouped with the destructive items.

## Slides removal before the redesign (SPN-074)

SPN-074 removed Slides entirely before SPN-047. The existing New type selector
and search type filter offer only Folder, Sheet and Doc; SPN-048's new menu
layout is not a prerequisite. Spinel has never been in production, so there is
no legacy Slides placeholder or compatibility requirement. The owner approved
this removal and waived screenshots for it; the general UI review rule remains.
Owner correction and approval, chat 2026-10-20, decision
[#104](https://github.com/mxbaylee/spinel/issues/104).

## Offline (SPN-039, SPN-053, SPN-054, SPN-051, SPN-052)

The words come from [docs/offline.md](../offline.md); this page only places
them. The row menu's **Available offline on this device** is the toggle; Google
Drive puts its per-file offline toggle in the same place. Once downloaded, the
same menu item reads **Remove from device**; with pending changes it opens the
recovery choices from the contract instead of removing. A downloaded row shows
an "Available offline" badge (icon plus label); a row with pending local edits
shows the save state from the contract instead ("Saved on this device — waiting
to sync", "Needs attention"). Known items that aren't downloaded stay listed and
say "Needs a connection" when offline. While offline or after a failed refresh,
the sidebar's connection indicator popover says when the list was last updated
("Files as of 14:05"), so a stale catalog never looks like an empty one. Items
created offline (SPN-051) show "Not synced yet" until the server accepts them;
if their folder was deleted or access was lost meanwhile, the row says "Needs
attention" and its menu offers **Choose another folder…** (SPN-051). An offline
copy, `<title> (offline copy, <local date and time>)`, lands in the person's own
files and its row links to the original. See [states.md](states.md#offline).

**Today (SPN-039).** Row actions are still inline buttons until the row menu
lands, so **Available offline on this device** and **Remove from device** sit
with them. Badges are `OfflineBadge`. SPN-042's connection indicator doesn't
exist yet, so local mode shows the [banner](README.md#banner) (`OfflineBanner`):
"Offline. Files as of 14:05. Downloaded documents open read-only until you
reconnect." When SPN-042 lands, its popover takes over the "Files as of" line and
the banner goes. Pending-edit states arrive with SPN-053 and SPN-054.

`OfflineViewer` has no story: like the editors and version previews, it hosts
Univer. Its states are plain text ("Opening offline copy…", "Read only on this
device. Reconnect to edit." or the problem) and `e2e/offline.spec.ts` covers them.

## Stories

`Dashboard/Dashboard`, `Dashboard/SearchPanel`, `Dashboard/PinnedSidebar`,
`Dashboard/PinButton`, `Dashboard/SharedBadge`, `Dashboard/TagLabels`,
`Dashboard/DocumentTags`, `Dashboard/Trash`, `Dashboard/ImportFile`,
`Dashboard/OfflineBadge` (also the banner and the "You're offline" page). Local
mode: `Dashboard/Dashboard` `LocalMode`, `LocalNeedsConnection` and
`LocalFolderNotOpened`.
