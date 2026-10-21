# Live formulas in Docs

A Formula is a native object in the Doc's main body. Start an expression with
`=`: `=Budget.Summary.A1` displays one value,
`=Budget.Summary.A1:C30` displays a table,
`=SUM(Budget.Summary.A1,Forecast.Summary.A2)` calculates across documents, and
`={1,2;3,4}` displays a two-by-two array. Quote names with spaces or punctuation:
`='My Budget'.'FY 2026'.A1`; double an apostrophe inside a quoted name.

Insert and edit through the Formula control. The source picker shows only
spreadsheets the current account can read. The expression identifies names for
people; saved references bind to item and worksheet IDs. A rename does not
retarget a formula, and restoring a Sheet resolves its new live unit generation.
Deleting a source makes it unavailable rather than binding to a namesake.

General, Number, Currency, Percent and Date formats affect presentation, not
the calculation. Currency is USD; dates use Excel serial values and a consistent
UTC display. Univer's formula semantics apply: a reference to an empty cell
evaluates as zero, while a formula returning an empty string remains empty.
Spreadsheet error values such as `#NAME?` and `#DIV/0!` remain recognizable
cell results; malformed definitions and unavailable calculations have separate
error states.

## Sharing and copies

Every source must be readable by the current viewer before a result is returned.
This includes every input to an aggregate: access to one input never permits a
partial total from another. Sharing the Doc does not share its sources.
An account reader without source access sees an access placeholder; a host guest
link never grants access to another Sheet. Source-free formulas can work for guests.
The separate source-sharing flow is tracked in SPN-076.

The Doc stores only authored expression text, stable bindings and display format.
It never stores calculated results in snapshots, history, native files, offline
copies or MCP content. Source labels deliberately written into the expression
are part of the host document, but denied lookups reveal no additional source
metadata. Offline copies show unavailable formulas and make no formula requests.
History previews evaluate against current source permissions and content.

Importing a native file keeps source-bound expressions as ordinary text and
removes their active bindings, so foreign IDs cannot attach to unrelated local
files. Source-free formulas can remain active. Reinsert a source-bound expression
using local sources to activate it. Bulk import/remapping is SPN-067.
MCP plain-text edits cannot split a Formula object; replacing its whole range
removes the annotation along with its text.

Current printing uses unavailable/source-expression output for formulas rather
than cached results. The replacement PDF renderer (SPN-075) and optional format
plugins (SPN-094) must authorize all sources before emitting any calculated result.
Social cards continue to show only the host title and document type.

## Bounds and layout

Expressions are limited to 2,048 characters, 16 references and four source
workbooks. Evaluation accepts at most 20,000 populated cells and 8 MiB of source
data in total, at most 32 worksheets per workbook, and source dimensions no larger
than 100,000 rows or 1,024 columns. Results are limited to 30 rows, 12 columns,
360 cells and 64 KiB. These are explicit errors, never silent truncation.

A disposable worker has a five-second deadline and a 256 MiB old-generation
heap limit. One calculation/materialization request is admitted at a time;
there is no result cache or unbounded queue. Clients briefly retry busy admission
with a bounded, cancellable wait; authorization failures are not retried. A timeout
terminates the worker, including synchronous calculation. Access and source
generations are checked again after asynchronous work.

Scalar results participate in normal paragraph flow. A table is a measured
atomic object: it can move to another page but does not split across pages.
The standard page supports the 30-row example. If the current font, column or page
dimensions cannot fit a result, insertion or refresh reports a size error.
While recalculating, an unchanged formula keeps its measured space and shows a
neutral loading marker; its previous values are cleared immediately. Normal
selection, undo/redo and collaboration carry the source definition.

## Implementation and decisions

Reusable SDK integration lives in `lib/doc-formulas/`, imported as
`@spinel/doc-formulas`. It uses public open-source Univer APIs, including transient
layout presentation and custom glyph rendering. It adds no Pro dependency and
does not modify or inspect Pro implementations. The app owns identity, access,
transport, worker admission and dialogs.

The owner approved scalar, range, cross-document and array formulas in chat on
2026-10-20. [Decision #113](https://github.com/mxbaylee/spinel/issues/113) weighs
the Owner's report workflow, Collaborator's independent source access, Link
guest's host-only access and Operator's two-GB server. Existing access and restore
rules remain from decisions #23, #72 and #92. The interaction is specified in
[the design playbook](design/formulas.md).
