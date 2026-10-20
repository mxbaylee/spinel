# Formulas in Docs

SPN-033 adds one native Formula object in a Doc's main body. It follows the
owner's approved direction from 2026-10-20 and [decision #113](https://github.com/mxbaylee/spinel/issues/113).
The result determines its presentation: a single value fits into a sentence;
multiple cells form a table inside the document.

## Expression and references

Every expression starts with `=`. Examples:

- `=Budget.Summary.A1` — one value.
- `=Budget.Summary.A1:C30` — a table.
- `=SUM(Budget.Summary.A1,Forecast.Summary.A2)` — a calculation across documents.
- `={1,2;3,4}` — a two-by-two table.
- `='My Budget'.'FY 2026'.A1` — names containing spaces or punctuation.

Autocomplete offers only Sheets and worksheets the current account can read.
Names are labels; stored references bind to stable item and worksheet IDs.
Renaming a source does not break a saved formula. A deleted source stays
unavailable rather than binding to a new file with the same name.

## Insert and edit

**Insert formula…** belongs in the editor's existing actions/menu, never in a
second toolbar. Until SPN-049 consolidates today's editor controls, a collapsed
Formula control may sit with the existing collapsed controls.

The dialog contains a labelled expression field, source suggestions, a labelled
format selector (General, Number, Currency, Percent, Date), and a result preview.
The single primary action is **Insert** or **Save changes**, followed by Cancel.
The expression stays visible while editing; the document shows its result.
Selecting an existing result offers **Edit formula…** to editors. Readers get
the result and access status but no mutation controls. Keyboard users can reach
the same actions; Escape cancels and focus returns to the editor.

Editing uses the document's normal undo, redo, selection and collaboration.
Copy/paste preserves definitions within Docs and exposes the expression as
plain text where rich content is unsupported. The saved document contains no
calculated values. Viewer-specific presentation is transient.

## Results and states

- **Scalar:** ordinary text aligned to the surrounding sentence, with an
  understated focus/selection treatment.
- **Table:** a readable grid inside the page, with consistent cell padding and
  subtle theme-token borders. Do not invent headers from the first data row.
  The 30-row reference example must render fully; no clipped or silently omitted
  rows. Unsupported sizes get a clear limit message before insertion.
- **Empty:** a labelled empty-value state while selected/editing so an empty
  cell is not mistaken for a missing object.
- **Loading:** a compact status at the object's position; a previous viewer's
  or previously authorized value must not remain visible during reauthorization.
- **Private:** “You need access to this formula's sources.” A missing source
  and a source the viewer cannot discover must not reveal additional source metadata.
  Source labels explicitly authored in the expression are host document content. Guests
  get “Source unavailable.” No private cached value or partial aggregate.
- **Invalid:** “Check this formula.” Keep the expression editable and give
  useful syntax or size guidance without exposing server internals.
- **Offline:** “Formula unavailable offline.” Definitions remain intact; no
  stale result is presented as authorized or live.

Number formatting is independent of expression and result shape. Results must
remain readable at phone width, using existing page zoom/viewport behavior and
44 px touch targets in the dialog. Do not shrink large tables into illegibility.

## Access and output

Every source is checked for the viewer, including every input of a scalar
aggregate. Sharing the host never grants source access. The optional source
sharing flow is SPN-076; SPN-033 adds no automatic grant or access request.
History, native files, offline copies and MCP reads carry definitions without
computed values. A rendered export may include only freshly authorized results;
private results remain placeholders. Social previews remain title/type only.

## Evidence

The Formula dialog and result states get Storybook stories in both themes and
phone width. Native insertion, selection, undo/redo, copy/paste, co-editing and
page layout are exercised in Playwright. PR screenshots show an inline value,
the 30-row table, cross-document calculation and unavailable state.

## Reference

[obsidian-sheet-plus PR #168](https://github.com/ljcoder2015/obsidian-sheet-plus/pull/168)
demonstrates inline scalar results, table results and separate number formatting.
It is inspiration for the interaction, not an access model or a native Docs
implementation. No third-party code or assets are copied by this design.
