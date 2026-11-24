# ⌨️ Spaces editor and formula-builder experiment

**Specification, 2026-11-23.** Owner direction and reference screenshots from the SPN-172 conversation. This records the new pattern before implementation; it is not a claim that prototypes or current screenshots exist. [SPN-172](../implementation/SPN-172.md) owns five local-only candidates and the complete acceptance matrix; [SPN-173](../implementation/SPN-173.md) owns subsequent collaboration sizing.

## Product boundary

Formula authoring and execution belong to Space pages. Standalone Docs are prose-only; retained legacy annotations display literal source without calculation and survive archival/recovery until deliberate conversion/removal. Standalone Sheets remain spreadsheets. The prototype route preserves native Spaces and clearly identifies drafts as saved on this device.

Use the current Space shell, Pages navigation, theme tokens and Base UI controls. A compact candidate selector changes the page surface without duplicating global navigation. Lazy-load one candidate. Phone navigation remains a drawer. Do not expose the experimental route to Link guests or Operators.

## Prose interaction

- Markdown prefixes convert at the start of a paragraph without opening slash UI: H1/H2/H3, bullet/numbered list, quote and code fence. Undo reverses the conversion.
- `/` opens a small caret-anchored menu anywhere in ordinary prose, including immediately after a word. Offer Formula and Divider, with optional Live Sheet only when implemented. Arrow keys select, Enter commits and Escape cancels. A divider splits the paragraph and keeps both text halves.
- `=` opens the formula builder at the current caret. A formula pill remains part of the sentence; arrows/deletion/selection/copy work across it. Mouse and keyboard activation reopen it for editing. Cancellation preserves the sentence and trigger text; commit returns focus after the object.
- Do not intercept code editing, active IME composition or keystrokes inside the formula builder. Dismissed literal slash/equal characters remain typeable. Avoid hover-only controls and cursor traps.

## Formula builder

The supplied Superhuman references show a compact named-expression popover and a larger editor with token colors, inline references, a live result row and active-argument help. Adopt those interaction ideas in Spinel's visual language. Use synthetic `MonthlyTotal`, `Expenses` and `TaxRate` examples; do not copy the user's financial content or third-party assets.

| Region | Required behavior |
| --- | --- |
| Header | Optional custom formula name; usage/backlink count with an accessible label; help; expand/collapse. A count of zero is valid. Label counts as local prototype references until production indexing exists. |
| Expression | Syntax highlighting for function names, literals, operators and reference tokens; matching parentheses; keyboard autocomplete of authorized worksheets, names and supported tables. Reference labels distinguish workbook/range/formula kinds without relying on color. |
| Hints | Function signature and active argument, optional/repeated parameter markers and concise help. Show known value/shape badges such as number, text, boolean, date/format or range; unknown remains unknown. Currency is formatting, not a new engine type. |
| Result row | Authorized live preview, format selector and pending/error/unavailable state in a stable layout. No last-known private number while reauthorizing. Number/date/percent/currency options reuse existing formatting. |
| Footer | Cancel and one primary Done action, clear keyboard guidance and inline recovery for busy/timeout/save failure. A pending commit cannot insert twice. |

The compact popover opens immediately without waiting for source discovery or calculation. It fits the viewport at 390 px and uses the existing dialog fallback when a caret overlay cannot fit the virtual-keyboard viewport. Expanded mode shares the same draft, selection, help and preview; collapsing must not reset edits. Use bounded scrolling and existing theme spacing.

Within the builder, Up/Down navigate suggestions, Enter accepts a selected suggestion, and Escape dismisses that suggestion first, then cancels the builder when no subordinate popup is open. In the expanded expression editor, Enter inserts a newline. Tab accepts an active completion; otherwise Tab/Shift+Tab follow normal focus navigation. Use an explicit indent/outdent command (Cmd/Ctrl+] and Cmd/Ctrl+[) rather than trapping keyboard focus. Cmd/Ctrl+Enter commits from either mode. Show these shortcuts in help. Native text selection and composition remain intact.

Auto-format is an explicit action, preserves formula semantics and undo, and never reformats during normal typing. Multiline builder input compiles to the supported expression representation; strings and quoted names retain exact semantics. The screenshots' Coda `WithName` and chained `.Filter` syntax do not define Spinel's language; calculation remains Univer-compatible.

## Names and backlinks

An optional formula name is reusable by ID-bound references in other local pages of the same account/Space/candidate. Renaming changes the label, not the target. Resolve collisions with function names, workbook names and other formula aliases visibly. Names and actual worksheet defined names have different icons/help.

Count incoming reference occurrences, not outgoing sources or visits. Backlinks group occurrences by page/formula; activate one to navigate to its local page and focus the reference. Unmounted saved pages still count. Preview/cancel does not change committed counts; delete/undo/rename does. Broken targets stay explicit. A view must not expose inaccessible source names or imply knowledge of other users' drafts.

## Accessibility and review

Apply current 44 px touch targets, text contrast, focus indicators, reduced motion and light/dark tokens. Syntax color always has token text/type support. Screen readers receive a meaningful formula label, value or error, and a keyboard edit action; preview announcements are bounded so typing is not narrated on every recalculation. Opening/closing menus preserves selection and scroll position.

Every production component/state gets a story. UI evidence covers compact and expanded builders, named zero/multiple usages, active-argument help, source suggestions, pending/error/offline states, inline selection, each candidate shell and legacy standalone content in light/dark/phone plus the existing tablet review. Independent visual approval is agent review only. No visual implementation or runtime acceptance is claimed by this documentation PR.
