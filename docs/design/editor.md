# Editor chrome

SPN-049 builds this default layout and theatre mode. It applies to Sheets and
Docs, and to Slides when SPN-009 lands.

## How others do it

| | Google Sheets | Excel for the web | Numbers for iCloud | Zoho Sheet |
|---|---|---|---|---|
| Title | Inline-editable title, top left | Title in the header, click to rename | Title centred in the toolbar | Inline title, top left |
| Save status | Small cloud icon beside the title; detail on hover/click | "Saved" beside the title | Implicit; no persistent indicator | "Saved" text beside the title |
| Share | Share button top right, avatars to its left | Share top right, avatars beside it | Collaborate button in the toolbar | Share top right |
| Tools | Menu bar plus one toolbar row | Ribbon with tabs | Sparse toolbar plus a Format inspector | Menu bar plus toolbar |
| Focus | View → Full screen hides menus and toolbar (Ctrl+Shift+F hides menus) | "Focus" / hide ribbon | Inspector can be hidden | Hide toolbar |
| View-only | "View only" chip near Share, with request access | "View only" in the header | Read-only banner | "Read only" label |

The shared pattern: one header row with an inline title and a small, fixed-size
status beside it; Share and presence top right; tools in a single row below;
detail (version history, export) behind menus.

## Spinel today

Collaborators, the fill-preset bar, the save-status line, version names and
exports all stack above the canvas in normal flow inside `.sheet-editor`. The
status line grows when a message or Retry appears, which moves the sheet
(SPN-043). Univer's own toolbar sits inside the canvas container.

## Adopted layout

```
┌ header (fixed height) ───────────────────────────────────────────────────┐
│ ← Budgets / Q3 forecast ✎   ✓ Saved  ● Online      (SR)(AK)  [Share] ⋯ │
├ Univer toolbar (Univer's own) ───────────────────────────────────────────┤
│                                                                          │
│ canvas                                                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Left:** the breadcrumb back to the folder, then the document name. The name
  is the rename control for owners (a button that turns into a field; Enter
  saves, Escape cancels). For everyone else it is plain text.
- **Status cluster,** right after the title: the save slot (SPN-043) and the
  connection slot (SPN-042), each following
  [status changes never move the layout](README.md#status-changes-never-move-the-layout).
  SPN-039 adds local-save states to the connection slot; SPN-013 adds a queue
  position there too.
- **Right:** collaborators (up to three avatars, then "+n", with names in a
  popover), then **Share** (primary, owners only) or a **View only** badge,
  then the More menu.
- **More menu:** Name this version… and Versions (SPN-024, SPN-026), Export
  (Univer file, PDF; SPN-031, later Office files SPN-035), Print, Theatre mode,
  then for owners Move… and Trash. `VersionNames` and `FileExports` move from
  inline sections into this menu's dialogs.
- **Tools** are Univer's toolbar, untouched. Spinel never adds a second toolbar
  row. Fill presets belong in Univer's fill picker (SPN-050); until then they
  stay a collapsed `<details>` in the header's More menu.
- **Embedded ranges** (SPN-033) render inside the canvas. The header doesn't
  change.

### Always visible / behind a menu

| Always visible | Behind a menu |
|---|---|
| Breadcrumb, document name (rename for owners) | More → versions, export, print, theatre mode, move, trash |
| Save slot, connection slot | Status popover → message detail, Retry saving |
| Collaborator avatars (max 3 + n) | Avatar popover → names |
| Share (owner) or View only | Share dialog ([sharing.md](sharing.md)) |
| Univer's toolbar | Fill presets (until SPN-050) |

## Theatre mode (SPN-049)

The editor fills the browser window, like YouTube's theatre mode, without the
browser Fullscreen API. The rail and the header hide; Univer's toolbar stays.
A slim strip at the top keeps the save and connection slots, in compact
icon-only form with their labels as accessible names, and an **Exit theatre
mode** button. The choice is remembered per device. Any keyboard shortcut is
checked against Univer's before it ships.

## Phone

Under 900 px with a coarse pointer, Sheets use Univer's mobile controls
(docs/mobile.md). The header keeps the title, the status cluster and More;
collaborators and Share move into More. No other phone-specific chrome.

## Stories

`Editor/Collaborators`, `Editor/FillPresets`, `Editor/VersionNames`,
`Editor/FileExports`. `SheetEditor` and `DocEditor` boot Univer, so their layout
is checked by Playwright screenshots (SPN-047), not stories.
