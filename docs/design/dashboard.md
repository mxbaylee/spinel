# File list (dashboard)

SPN-048 builds this page's layout. Design changes made while building go back
into this page, not only into the PR.

## How others do it

| | Google Sheets / Drive | Excel for the web / OneDrive | Numbers for iCloud | Zoho Sheet / WorkDrive |
|---|---|---|---|---|
| Create | One "New" button, top left | "Create or upload" / "+ New" | "+" (create) at top | "New" button |
| Search | Wide field across the top, filter chips under it | Search box in the header | Search field in the toolbar | Search in the header |
| Shared items | "Shared with me" in the left nav | "Shared" view | "Shared" in the sidebar | "Shared with me" |
| Row actions | `⋮` per row, always tappable; more on right-click | `⋯` per row | `⋯` per file | `⋯` per row |
| Views | List / grid toggle | List / tile | Grid / list | List / grid |
| Import | Inside "New" (File upload), plus drag and drop | Inside "Create or upload" | Upload button | Inside "New" |

The shared pattern: one New button that also holds import, a wide search with
filter chips, "Shared with me" as a place in the nav rather than a panel, and
one menu button per row.

## Spinel today

Search panel above everything; a "Shared with me" toggle that opens a drawer
over the list; New, Refresh folder and Import as three separate buttons; and up
to six text buttons on every row (Pin, Tags, Share, Rename, Move, Trash). A
shared row adds a `↗` drag button, its access label and "File into folder". All
four areas are cluttered (owner, chat 2026-10-19).

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
- **Pinned** (SPN-020) is a short list in the sidebar; a pinned row also shows
  a pin badge.
- **Trash** sits at the bottom of the sidebar, above the connection indicator
  (SPN-042), which states online/offline/reconnecting and never claims anything
  is saved on the device.
- **Rows** follow the [row pattern](README.md#row). The secondary column is the
  edited date in My files and the shared date in Shared with me.
- **Folder actions** (Rename, Move, Share, Refresh folder, Trash) are the More
  menu next to the breadcrumb title, the same items as the folder's row menu.
- **Grid view:** not adopted. With about two people's documents, a list is
  enough; revisit only if Slides thumbnails land (SPN-009).

### Always visible / behind a menu

| Always visible | Behind a menu |
|---|---|
| New (primary), search, breadcrumb | New → Folder, Sheet, Doc, Import file… |
| Sidebar: My files, Shared with me, Pinned, folders, Trash, connection | Row ⋯ → Open, Pin/Unpin, Tags…, Share…, Rename…, Move…, File into folder… (shared), Trash |
| Row: icon, name, shared/view-only/pinned badges, two tags, date, ⋯ | Folder ⋯ → the same items, plus Refresh folder |
| Filter chips while searching or filtering | Tags chip → tag list |

Access ("View only", "Can edit") stays a visible badge because it decides what
the person can do once they open the item.

## Offline (SPN-039, SPN-051, SPN-052)

The words come from [docs/offline.md](../offline.md); this page only places
them. The row menu's **Available offline on this device** is the toggle (Google
Drive is the only one of the four with a per-file toggle, and puts it in the
same place). A downloaded row shows an "Available offline" badge (icon plus
label); a row with pending local edits shows the save state from the contract
instead ("Saved on this device — waiting to sync", "Needs attention"). Known
items that aren't downloaded stay listed and say "Needs a connection" when
offline. Items created offline (SPN-051) show "Not synced yet" until the server
accepts them. An offline copy, `<title> (offline copy, <local date and time>)`,
lands in the person's own files and its row links to the original. See
[states.md](states.md#offline).

## Stories

`Dashboard/Dashboard`, `Dashboard/SearchPanel`, `Dashboard/PinnedSidebar`,
`Dashboard/PinButton`, `Dashboard/SharedBadge`, `Dashboard/TagLabels`,
`Dashboard/DocumentTags`, `Dashboard/Trash`, `Dashboard/ImportFile`.
