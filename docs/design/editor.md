# Editor chrome

## SPN-047 composed redesign proposal

Awaiting [owner approval](https://github.com/mxbaylee/spinel/issues/126).
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Doc, Sheet, ViewOnly, OfflineEditor, FormulaInContext, History.

| Current friction                                                                                                                | Public reference pattern                                                                                          | Adopted proposal                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The Dashboard title and search remain above the document; file actions, versions and export consume most of the first viewport. | Google and Excel group file identity/actions above content; Numbers discloses contextual details in an inspector. | A compact document header plus the existing Univer toolbar. Document content begins immediately below. |

Static screen mockups show chrome placement; the connected walkthrough runs real
Univer Doc and Sheet editors with local fixture data. Production keeps Univer's
toolbar and literal document colors, including white paper where authored.
More holds owner-only Share, Versions and Export; Doc formula insertion opens its
task UI. Fill controls stay in Univer. Named versions, Before restore checkpoints,
UTC dates and restore confirmation retain docs/history.md semantics. No dashboard
search or pinned column persists in standalone editor views.

The proposal above governs placement after approval. Existing behavioral and
permission rules below still apply; production migrations remain separate tickets.

SPN-049 builds this default layout and theatre mode. It applies to Sheets and
Docs.

## How others do it

|             | Google Sheets                                                         | Excel for the web                    | Numbers for iCloud                     | Zoho Sheet                    |
| ----------- | --------------------------------------------------------------------- | ------------------------------------ | -------------------------------------- | ----------------------------- |
| Title       | Inline-editable title, top left                                       | Title in the header, click to rename | Title centred in the toolbar           | Inline title, top left        |
| Save status | Small cloud icon beside the title; detail on hover/click              | "Saved" beside the title             | Implicit; no persistent indicator      | "Saved" text beside the title |
| Share       | Share button top right, avatars to its left                           | Share top right, avatars beside it   | Collaborate button in the toolbar      | Share top right               |
| Tools       | Menu bar plus one toolbar row                                         | Ribbon with tabs                     | Sparse toolbar plus a Format inspector | Menu bar plus toolbar         |
| Focus       | View → Full screen hides menus and toolbar (Ctrl+Shift+F hides menus) | "Focus" / hide ribbon                | Inspector can be hidden                | Hide toolbar                  |
| View-only   | "View only" chip near Share, with request access                      | "View only" in the header            | Read-only banner                       | "Read only" label             |

The shared pattern: one header row with an inline title and a small, fixed-size
status beside it; access and presence top right; tools in a single row below;
detail (version history, export) behind menus.

## Spinel today

Collaborators, the fill-preset bar, the save-status line, version names and
exports all stack above the canvas in normal flow inside `.sheet-editor`. The
status line grows when a message or Retry appears, which moves the sheet
(SPN-043). Univer's own toolbar sits inside the canvas container.

## Adopted layout

```
┌ header (fixed height) ───────────────────────────────────────────────────┐
│ ← Budgets / Q3 forecast ✎   ✓ Saved  ● Online      (SR)(AK) [Can edit] ⋯ │
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
  SPN-053 adds local-save states to the connection slot.
- **Right:** collaborators (up to three avatars, then "+n", with names in a
  popover), then a compact access badge and the More menu. Share remains owner-only
  and lives in the More menu.
- **More menu:** Share (owners), Versions (SPN-024, SPN-026), Export
  (Download Univer file, Export as PDF; SPN-031/SPN-075, later Office files
  SPN-035), and Insert formula for editable Docs. Version naming lives inside
  Versions, with a Back button immediately left of its title; it is disabled
  until current edits are saved and the connection is available. SPN-049 adds
  theatre mode and the applicable owner Move…/Trash actions during migration.
  `VersionNames` and `FileExports` move out of permanent inline sections.
- **Tools** are Univer's toolbar, untouched. Spinel never adds a second toolbar
  row. Remove the extra Fill presets entry; Univer owns its fill controls.
  Any later preset integration must use a supported public API.
- **Formulas** (SPN-033) render inline values or tables inside the canvas;
  insertion and editing follow [formulas.md](formulas.md).
- **Inline errors** that belong to the canvas, such as the Doc image-upload
  failure ("… Try inserting the file again."), show as an
  [inline error](states.md#inline-errors) in a fixed slot between the toolbar
  and the canvas that reserves one line, so the page doesn't move when it
  appears. The same slot holds the Doc help line ("Click the page to write. Type
  / for commands."), which the error replaces while shown.

**Export as PDF** (SPN-075) downloads a PDF directly for anyone with current
read access, including account viewers and guests. There is no separate Print
action or browser print dialog in this planned flow. Guests use the control
in [their header](guest.md#adopted-pattern). Owner, chat 2026-10-20, decision
[#103](https://github.com/mxbaylee/spinel/issues/103).

### Always visible / behind a menu

| Always visible                                | Behind a menu                                               |
| --------------------------------------------- | ----------------------------------------------------------- |
| Breadcrumb, document name (rename for owners) | More → versions, export, theatre mode, move, trash          |
| Save slot, connection slot                    | Status popover → message detail, Retry saving               |
| Collaborator avatars (max 3 + n)              | Avatar popover → names                                      |
| Compact access badge                          | More → Share dialog, owners only ([sharing.md](sharing.md)) |
| Univer's toolbar                              | Versions → Name this version                                |
| Help line or inline error slot (Docs)         |                                                             |

## Theatre mode (SPN-049)

The editor fills the browser window, like YouTube's theatre mode, without the
browser Fullscreen API. The rail and the header hide; Univer's toolbar stays. A
slim strip at the top keeps the save and connection slots, in compact icon-only
form with their labels as accessible names, and an **Exit theatre mode** button.
**Esc** or that same button exits; Esc only exits when focus isn't in a Univer
cell editor or dialog, where Esc already means cancel. The selection is kept
across entering and exiting. The choice is remembered per device. Any keyboard
shortcut is checked against Univer's before it ships.

## Phone

Under 900 px with a coarse pointer, Sheets use Univer's mobile controls
(docs/mobile.md). On phones, the title has a full first row and status/More use
the second row. Presence avatars are hidden; owner-only Share remains in More.

## Stories

Existing production stories include `Editor/Collaborators`, `Editor/FillPresets`,
`Editor/VersionNames` and `Editor/FileExports`. The redesign's native editor stories
and connected walkthrough boot Univer against local fixtures; Playwright also
checks the production editors (SPN-060).

## Persona walkthrough refinements

Ordinary editors have a compact horizontal utility header, not a permanent
file-navigation column. The phone document header has a full title row and a
second row for status/actions. Editable collaborators show Can edit without an
additional routine access explanation; only owners see Share in More. Editable
collaborators retain version naming and restore. Back to files preserves
retrieval context. History highlights the selected checkpoint and names its
date/time in preview and restore confirmation; Return to document stays visible.

At phone/tablet widths History keeps the selected-version summary above the
preview; its chooser expands on request. Older days show an aligned weekday
calendar and checkpoints for the selected date, including named/before-restore
entries, rather than reusing today's list.

Space editors keep the compact utility header across the full width, with their
internal page/folder tree below. Its collapse/reopen chevrons are separate from
My files, which exits the Space. Link guests retain scoped Pages navigation
without account destinations. Routine editable-access/footer text is omitted;
view-only and actionable error/recovery feedback remain. Owner, chat 2026-10-20.
