# Live formulas in Docs

A Formula is a native object in the Doc's main body. Start an expression with
`=`: `=Budget.Summary.A1` displays one value,
`=Budget.Summary.A1:C30` displays a table,
`=SUM(Budget.Summary.A1,Forecast.Summary.A2)` calculates across documents, and
`={1,2;3,4}` displays a two-by-two array. Quote names with spaces or punctuation:
`='My Budget'.'FY 2026'.A1`; double an apostrophe inside a quoted name.

Insert and edit through the Formula control. The source picker shows only
spreadsheets the current viewer can read, including authorized Space children.
A Space guest's picker stays inside that Space. The expression identifies names for
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

If saving cannot finish because another calculation is running, the evaluator
times out or the service is temporarily unavailable, the dialog keeps the
expression, format and source choices. Retry explicitly after the failure; a
failed attempt is not a saved edit. Invalid expressions and inaccessible sources
keep their own correction/access messages without disclosing additional source
details. A pending Save admits only one insertion. Closing the dialog, navigating
away or losing access cancels unfinished evaluation before mutation; stale
completion cannot dismiss a newer attempt.

## Sharing and copies

Every source must be readable by the current viewer before a result is returned.
This includes every input to an aggregate: access to one input never permits a
partial total from another. Sharing the Doc does not share its sources.
An account reader without source access sees an access placeholder. A standalone
Doc guest link grants no source access; source-free formulas can work for guests.
A Space View or Edit guest link permits sources in the same Space, including
newly added Sheets. It grants no access to ordinary files or other Spaces, even
when the browser also has a signed-in account. Account and MCP credentials may
read external sources only through their own independent current access.
The [explicit source-sharing flow](sharing.md#doc-formula-sources) adds only
reviewed account grants: the per-recipient option starts unchecked and lists
exact source targets before confirmation. Existing source access is kept. An
external Space is disclosed and granted as a whole; same-Space sources inherit
their host Space's access. Unreadable sources stay generic, and another source's
Owner or File admin may still need to act. Public links never acquire external
source capabilities through this account-sharing option.

Source review reads stable references from current committed Doc snapshots,
including all live Docs when sharing a Space. It does not use a stale legacy
checkpoint after native collaboration starts, recurse through source formulas,
or copy source values into the host. Changed dependencies, authority, names or
Space boundaries require refreshed review and explicit confirmation. A sharing
result confirms access only; invalid expressions, missing worksheets and other
calculation errors retain their own states. Protocol and capacity limits are
recorded in [SPN-076](implementation/SPN-076.md#runtime-protocol-and-bounds).

The host and every source retain the credential selected when the request began.
Permissions and the live source generation are checked before materialization,
after every asynchronous read, and after calculation. Revoked or rotated links,
expired sessions, lost grants, trashed ancestors and disabled Space owners cannot
return an in-flight result. A new View guest session can still read after an Edit
link is downgraded; the old guest session is invalidated with its privacy epoch.

The Doc stores only authored expression text, stable bindings and display format.
It never stores calculated results in snapshots, history, native files, offline
copies or MCP content. Source labels deliberately written into the expression
are part of the host document, but denied lookups reveal no additional source
metadata. Offline copies show unavailable formulas and make no formula requests.
History previews evaluate against current source permissions and content, using
the exact Space root and host child when the historical Doc belongs to a Space.

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
heap limit. One calculation/materialization request runs at a time, with at most
two requests waiting in a shared FIFO across ordinary, Space and guest routes.
Later requests cannot overtake an admitted waiter; overflow remains busy. Waiting
has a 12-second deadline and cancellation removes the waiter without materializing sources.
Session, host and source access are checked before admission and again on promotion.
The queue stores bounded validated input, never snapshots; there is no result cache.
Clients briefly retry read-only busy admission with a bounded, cancellable wait;
authorization failures, an expired queued wait and native insertion are not
automatically retried. A timeout
terminates the worker, including synchronous calculation. Access and source
generations are checked again after asynchronous work.

Space source discovery validates each complete readable tree in one authorization
transaction. Its shared 10,000-row work budget counts retained membership rows,
including tombstones and recovery metadata, across all discovered roots. An
over-budget discovery request fails without returning a partial catalog. Existing
stable bindings are authorized directly and do not require a discovery scan.

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
2026-10-20. [Decision #113](implementation/SPN-033.md#legacy-decision-113-live-authorized-document-formulas) weighs
the Owner's report workflow, Collaborator's independent source access, Link
guest's host-only access and Operator's two-GB server. Existing access and restore
rules remain from decisions [#23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming), [#72](implementation/SPN-016.md#legacy-decision-72-scoped-anonymous-link-capabilities) and [#92](implementation/integration-boundaries.md#legacy-decision-92-stable-integration-boundaries). The interaction is specified in
[the design playbook](design/formulas.md). Bounded waiting and retained explicit
recovery follow [SPN-103](implementation/SPN-103.md#bounded-admission-and-recovery).
