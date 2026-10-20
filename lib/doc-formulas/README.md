# Doc formulas

An open-source Univer Docs adapter for live spreadsheet calculations. The host owns
identity, source access, transport, and the surrounding dialog; this package never
imports Spinel application code.

Use the public `index.ts` (package name `@spinel/doc-formulas`). Formula parsing and
formatting are synchronous. `evaluateFormula` lazily loads the headless open-source
formula engine; `installDocFormulas` lazily loads the browser adapter. Await both.

## Persistence and rendering

`formulaBody` returns readable source text with one `CustomRangeType.CUSTOM`,
`wholeEntity` annotation. Its `properties.spinelFormula` holds the expression,
format, and stable item/worksheet bindings. Evaluated values, formatted results,
font overrides, glyph keys, and layout measurements are never saved in the Doc.

The native adapter uses public SDK APIs: `InsertTextCommand` for edits and undo,
`registerDocumentLayoutPresentation` for transient glyph style, the custom-range
interceptor for layout dimensions, and `registerDocCustomGlyphRenderer` for canvas
paint. The source remains useful as plain text when copied or opened without the
adapter. Rich clipboard behavior follows Univer's custom-range transport.

Scalar values occupy one inline object. Arrays/ranges occupy a measured table
object in the document paragraph flow, not an external overlay. Tables are atomic:
they do not split over pages. Before insertion and after evaluation, the adapter
checks the current layout's font, column width, margins, and page height. Results
that cannot fit show an explicit size error; cells are never scaled down or silently
truncated. Input/result bounds are exported as `FORMULA_LIMITS`.

`installDocFormulas` accepts an abortable viewer-authorized evaluator plus click
and state callbacks. `refresh()` clears the old result before resolving current
sources. The host must refresh when source permissions/content may change, clear
on identity changes/backgrounding, and dispose the adapter before the editor.
The returned state supports an accessible semantic rendering alongside the canvas.
Only the main body is supported; insertion in headers and footers is rejected.

## Security boundary

Definitions are untrusted data. The server validates all bindings and checks every
source against the current viewer before and after evaluation. The package does
not authorize references itself. Never reuse one viewer's result for another,
embed results in offline snapshots, or cache rendered values in shared resources.
An export renderer must independently authorize/recalculate, or retain only the
source expression/placeholder. It must not serialize the live presentation.

Tests cover source-only persistence, transient presentation, formatting, expression
bindings, evaluator limits and results. Application browser tests cover actual
native layout, collaboration, and permissions.
