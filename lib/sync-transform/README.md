# @spinel/sync-transform

Operational transforms for concurrent [Univer](https://github.com/dream-num/univer)
1.1.0 Sheet and Doc mutations, so a central sync server can merge two people's
edits the same way on every screen. Pure TypeScript with no server, DOM or
rendering dependency. At runtime it imports `@univerjs/core` and, for the cell
merge, `@univerjs/sheets`; `docs`, `drawing` and `engine-formula` are peers
too, because the transforms implement their 1.1.0 mutation formats,
engine-formula's for defined names. The list of commands that make Univer
rewrite names and formulas comes from `@univerjs/sheets-formula`'s
`UpdateDefinedNameController` and `UpdateFormulaController`.

It is written from the open-source mutation definitions in `@univerjs/sheets`,
`@univerjs/docs`, `@univerjs/drawing` and `@univerjs/engine-formula` (defined
names), not from Univer's closed-source collaboration packages.

```ts
import { transform, UnsupportedMutationError } from '@spinel/sync-transform';
import type { BaseCells } from '@spinel/sync-transform';

// `mine` and `theirs` were both made from the same revision, and `cells`
// reads that revision's cells. The server's copy of an edit it accepted
// first wins ('right' for an incoming edit).
const cells: BaseCells = (unitId, subUnitId, row, col) =>
  snapshotAt(revision, unitId, subUnitId, row, col);
const rebased = transform(mine, theirs, 'right', { cells });
```

## Contract

For mutation lists `a` and `b` made from the same document,

```
apply(b) then apply(transform(a, b, side, { cells }))
  ==  apply(a) then apply(transform(b, a, flip(side), { cells }))
```

in Univer's own model, side effects included, where `cells` reads that
document. `side: 'left'` means `a` wins a conflict. This is the property a
central server needs (TP1): it orders edits and transforms each against those
it accepted since the sender's revision; each client transforms incoming edits
past its own unacknowledged ones.

**`options.cells`** is a `BaseCells`: `(unitId, subUnitId, row, col)` returns
the cell of the document both lists were made from, with its style inline
(`s` an object, never a style id), or null or undefined where there is none.
The transform reads it only where two writes meet one cell, and in the cell
of each absolute write either list holds (see "What a sender must do"), each
cell at most once; it applies the earlier mutations of both lists to what it
reads itself, row and column edits and moves included. It throws a
`TypeError` where two writes meet one cell, or a list holds an absolute
write, and no `cells` was given. The
answers must be exact for that revision (see "What a server must do"): the
transform cannot tell a wrong cell from a right one, and two screens that
read different cells diverge.

Reading the cells is the replay merge (decision 29 in
[SPN-056](../../docs/implementation/SPN-056.md), accepted).

**Approaches tried.** Two merges of same-cell writes were built and compared
by an independent judge: a stateless rule-based merge, which modelled
Univer's cell merge rule by rule, and this replay merge, which lands both
writes through Univer's own merge on the base cell. The replay merge won, 89
to 70, on convergence. Both designs, their round history and results, and
why the rule-based merge was not taken, are in
[Two merge strategies compared](../../docs/implementation/SPN-056.md#two-merge-strategies-compared).

`transform` throws `UnsupportedMutationError` for any mutation it has no rule
for, even when the other side is empty, so a sync client can refuse it before
sending rather than let two screens drift. `supportedMutationIds` lists the ids
it understands.

It throws `RefusedEditError` for two concurrent edits it can merge only by
losing, duplicating or miscomputing content. Its `reason` names the rule, and
"What it covers" gives each in full:

- `'moved-cells'`: a drag, shift or cut and a concurrent edit in its area, or a
  removal of a cut's target sheet (Cells).
- `'name-race'`: a defined-name edit and a concurrent edit that makes Univer
  rewrite names, two defined names given the same text, or colliding worksheet
  names/inserted IDs (Defined names, Worksheet identities).
- `'formula-race'`: a formula write and a concurrent edit that makes Univer
  rewrite formulas, or a command's rewrite of a formula and a concurrent write
  that replaces its cell's formula with none (Cells, Defined names).
- `'growth'`: a transform whose output would grow past its limit (Known
  limits).

That is a race, not a sender bug: the server refuses the later edit, and its
sender drops its pending edits from it on and reloads the document (SPN-057,
SPN-058).

A `TypeError` is a sender bug: a malformed or forged batch. Among them, a
batch that fails the base check (`checkBases`, run on both lists before
anything is transformed): an absolute write that changes a key, style key or
border edge of its cell that it does not claim, read from `cells` after the
earlier mutations of its list, or an absolute write given no `cells`. Then
`transform` throws a `TypeError` naming the mutation and key. The server refuses the batch, resyncs its sender, and logs it, as
for any edit the transform throws on; SPN-057 already refuses an edit the
transform throws on, whatever the error.

## Optional observations

`transform(a, b, side, { cells, observe })` accepts an optional content-free
observer. It reports aggregate dropped counts by six fixed rules, possible offsets
beside clipped shift bands and peak intermediate mutation count. Reverse transforms
used only to align later pairs do not count as delivered losses. If a later pair
refuses the batch, earlier tentative drops are omitted. Observer exceptions cannot
change the result or error; omitting it preserves the original transform behavior.

`MalformedEditError` is a `TypeError` with a stable `check` code.
`RefusedEditError` includes `mutationId` and `againstMutationId` when a pair is
known. The caller must use an allowlist before exporting mutation ids, and must
never export error text or params. The server supplies timing, refusal and invariant
observations through `@spinel/diagnostics`; no shape capture is enabled here.

## What it covers

| Family                    | Mutations                                                                                                     | Conflict rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Structure                 | row and column insert, remove, move; sheet insert, remove, reorder                                            | Both edits keep their intent: removals stick, a moved block stays with the side that moved it, inserts land before the first surviving row at or after their position. Every other family is re-addressed through the same index mapping. Colliding sheet names or inserted IDs are refused (Worksheet identities).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Cells                     | set range values (values, formulas, inline styles), number formats, range moves, within a sheet or to another | Two writes to one cell resolve on the cell (the replay merge, decision 29). The transform reads the cell from `options.cells`, as both edits left it after the earlier mutations of their lists, lands the loser's write and then the winner's on it with Univer's own merge (`prepareSetRangeValuesMutation`; a number format sets or deletes style key `n` as NumfmtService does, and retypes nothing), and sends the loser's side the result as an absolute write: one SetRangeValues with `isOverrideStyle` that names every cell key, null where absent, and the whole style, and holds under `sync-transform.cells.claim` the keys, style keys and border edges that are the loser's own edit. Where the result is what the winner already left, nothing is sent for the cell. Univer's merge deletes `ft` and `fd` for a write that clears `f` with no formula id, so a result that keeps them with no formula is followed by a second write of them, its tail. The transform reads an absolute write and its tail as one write of the cell, and rebuilds the tail from the cell it resolves, so a tail never keeps the `ft` or `fd` of a cell resolved again past a later write (decision 36). An absolute write that wins a cell again lands its claims over the cell, key by key, rather than its whole cell, so a key it never claimed keeps what landed under it. A write of `t` alone, the retype SetNumfmtCommand sends for the values its sender saw, loses to a concurrent write of a value either way round, so where the server accepted the retype first both screens still end with the value, as its own write typed it (decisions 31 and 35). A value with a style and no rich text restyles the cell's rich text where the value is its text, and deletes it otherwise (Univer's handleStyle), so past a concurrent deletion of that rich text, named, by a value of another text with a style, or by rich text of another text, it ends with its style and no `p` in either order, as one person doing both edits in that order would (decision 32). Writes to different cells pass each other unchanged and read nothing. A dragged range or a shift and a concurrent edit in its area are refused (`RefusedEditError`, `'moved-cells'`): a drag's area is its source and target, a shift's its band from its start to the sheet's edge, and what meets it there is a cell write, a number format, another drag or shift, a merge in a shift's area, or a row or column edit that cuts the area. Edits outside the area pass unchanged, and a row or column edit wholly outside it moves the move. A cut to another sheet is transformed as two moves, one clearing its source and one writing its target, so its area is its source on one sheet and its target on the other; `transform` joins them again, so other screens receive one move to the other sheet, or only the move that writes its target where a concurrent removal of its source sheet dropped the other. A cut and a concurrent removal of its target sheet are refused (`'moved-cells'`), since the cells would be lost; a removal of its source sheet leaves them on the target. A write of a formula (`f`, or a shared formula's `si`), including one in a sheet that a sheet copy or a restored sheet inserts, against a concurrent edit that makes Univer rewrite formulas, anywhere in the workbook, is refused (`'formula-race'`), since it was written for the cells before the other edit: row and column edits, range moves, inserts and deletes with shift (at the content's edge too, where they send no MoveRange), sheet removal, sheet and workbook renames, and name sets and removals, except where the formula is a rewrite by its own edit of the same name (see Defined names). That includes the formulas a command rewrites, and a row, column or shift command re-sends each formula that reads its sheet, moved or not, so on a sheet one formula reads two row inserts are refused wherever they land. Such a rewrite is also refused against a concurrent write that replaces its cell's value or formula with none, such as a value typed over it or a clear; a style or a number format on the cell merges. |
| Defined names             | set, remove                                                                                                   | Of two edits of one name, the first accepted stands: the loser's set or removal is dropped, whole, and the cell formulas a rename rewrites follow the cells' own rule, so they name the name that stands. A name edit against a concurrent formula write is refused (`'formula-race'`, see Cells), except where the write is the rewrite of an edit of the same name in its own batch: after that edit, one formula per cell, and only in cells the other edit's command also rewrites. So renames of two names one formula uses are refused, and so is a rename against a batch that types a formula and edits the name, unless the formula is typed after the rename into a cell where the other side also typed a formula after its own rename. Two names added or renamed to the same text, in any case or scope, are refused (`'name-race'`), since Univer could resolve them differently on each screen. Other edits of different names pass each other. A set or a removal against a concurrent edit that makes Univer rewrite names (row and column edits, range moves, inserts and deletes with shift, sheet removal, sheet and workbook renames) is refused (`'name-race'`): a set's references were written for the cells before the other edit, and a removal's command rewrites the formulas that use the name to `#REF!`, and those writes would stand where the other edit, accepted first, sets the name it moved and so drops the removal. That includes a shift at the content's edge, which sends no MoveRange, and a set or removal another command sent as its rewrite of the name, told from a person's name edit by the `trigger` Univer gives it (see "What a sender must do"). One with no `trigger`, or an undo's or redo's, counts as a rewrite, so an undone rename is refused against any concurrent name edit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Row and column properties | height, width, hidden, auto height, row and column data                                                       | Per index and key, the winner's write stands. A width is re-sent as column data where visibility could differ between orders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Merges                    | add, remove                                                                                                   | Intersecting edits conflict and the winner's stands. Merges move as Univer's merge listener moves them; a merge added while someone else's row or column edit cuts through it is dropped on both screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sheet settings            | frozen panes, row and column count, default style, gridlines, name, tab colour, hidden, workbook name         | Two of the same setting: the winner's value stands. Different sheets assigned the same name are refused (Worksheet identities).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Drawings                  | sheet drawings (insert, remove, move, z-order), background image                                              | The drawing op is transformed whole with ot-json1; the winner wins a write conflict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Docs                      | rich-text editing (body, headers, footers, notes, doc drawings), rename, hyperlinks, formulas (SPN-033)       | `JSON1` with the `TextX` subtype from `@univerjs/core`; the winner wins a write conflict. Where both edits name one paragraph, the first accepted edit's paragraph id stands, since Univer's delete can give a paragraph the deleted one's id. A formula is its source text under one whole-entity custom range. It stays whole past a style in or over it and text typed beside it, and an edit of it, which re-inserts it under its id, wins over concurrent typing, deletes and styles inside it. Of two edits of one formula, the first accepted stands: the loser's re-insert is dropped. Hyperlinks, formulas, and a format painter's style against a concurrent style converge only with Spinel's patched `@univerjs/core` (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Each rule above that was a choice, not a consequence of Univer's model, is
marked `Decision (owner, …)` or `Decision (agent, …)` where the code makes
it, with the option not taken and why. Spinel lists them all in
[docs/implementation/SPN-056.md](../../docs/implementation/SPN-056.md).

### Worksheet identities

Concurrent additions, copies, restores or renames that assign the same
case-insensitive name to different sheets are refused as `'name-race'`.
Two inserts restoring the same sheet ID are refused too, even with different
names. Native commands choose a name against the sender's own snapshot, so
two ordinary Add Sheet commands can collide. Keeping both would make formulas
ambiguous; adding a suffix without rewriting the sender's pending formulas
would silently redirect them. The server keeps the first accepted batch and
refuses the later one; its sender reloads under the existing refusal contract.

The guard checks every assignment in both original batches, including an
intermediate rename later overwritten in its own batch. That conservative
rule can refuse a pair whose final names would be unique. Different names and
different workbooks remain independent. Concurrent renames of the same sheet
retain their existing first-accepted and formula-race rules. See
[decision 37](../../docs/implementation/SPN-056.md#37-refuse-concurrent-worksheet-identity-collisions).

### Undo and redo reference edits

A SetRangeValues mutation sent by undo or redo counts as a possible reference
rewrite. Univer replaces the original command's `trigger` with the history
command's ID, and a shift at the content's edge can send only cell writes,
with no MoveRange or defined-name mutation revealing the shift. The guard
therefore applies even when the history edit contains no formula: it may still
move the cells a concurrent new formula refers to.

Such a batch is refused against a concurrent formula or defined-name edit in
the same workbook. A formula it restores is also refused against a concurrent
value or clear replacing that formula; a concurrent style still merges.
This conservatively refuses some ordinary cell undos/redos too, since the
original command cannot be recovered from these mutation payloads. It avoids
the previously documented stale-rewrite loss without adding sender metadata
or rewriting references ([decision 39](../../docs/implementation/SPN-056.md#39-refuse-ambiguous-undo-and-redo-reference-rewrites)).

## What a server must do

- **Pass `{ cells }` to every transform**, read from its snapshot at the
  revision the incoming batch was made on: the document both the batch and
  the edits accepted since were made from. A server that keeps no snapshot
  per revision rebuilds the one it needs, from an older snapshot and the
  edits after it (SPN-057).
- **Keep the cells exact.** Styles inline, as the document holds them at that
  revision, and nothing else. A wrong cell gives a wrong merge that every
  screen then applies, and a client that rebases past the same edit on the
  right cell disagrees with it.
- **Store and broadcast what `transform` returns, as it returns it**,
  `sync-transform.cells.claim` included: a later transform of the stored edit
  reads its claims.
- **Refuse a batch `transform` throws on**, resync its sender and log it. A
  `TypeError`, such as a batch that fails the base check, is a malformed or
  forged batch; a `RefusedEditError` is a race and logs its `reason`
  (SPN-057).
- **Validate the final candidate before committing or broadcasting it.**
  Sheet IDs, their snapshot keys and order must agree, and worksheet names
  must be unique case-insensitively. The concurrent guard sees assignments
  in the two batches, not unchanged sheet names: malformed input can still
  collide with one of those. Refuse the whole batch rather than relying on
  Univer to rename duplicate sheets when a snapshot reopens (SPN-057).

## What a sender must do

The server and every client run `@univerjs/core` 1.1.0 with Spinel's patch
(`scripts/dependencies/patch-univer-core.ts`, applied on install). Stock 1.1.0
splits a link where a style lands inside it, leaves `$n` range ids that differ
between screens, can throw `duplicate-custom-range-id` for a single user,
builds a negative retain when a new link crosses a paragraph break inside an
old one, and lets a concurrent bold survive on one screen only past a format
painter's style that sets `bl: 0` and was accepted first. A copy of this lib
published on its own needs the same patch, until upstream ships the fixes (the
link fixes are [dream-num/univer#7938](https://github.com/dream-num/univer/pull/7938))
and SPN-099 removes it.

Capture the public `ICommandService.onMutationExecutedForCollab` stream and
exclude events marked `onlyLocal`, `fromCollab` or `fromChangeset`. Keep
`syncOnly` events: they are intended for collaboration even though their local
execution happens separately. The general `onCommandExecuted` hook includes
local formula-cache/normalization work and omits `syncOnly` events, so it does
not represent outgoing edits. Exclude two additional, verified render-only
events: `sheet.operation.clear-drawing-transformer` and
`doc.operation.clear-drawing-transformer`. Univer 1.1.0 registers these as
mutations, but their public handlers only refresh drawing selection controls;
they change no document data. Do not generalize these exceptions to an
operation prefix or a supported-ID filter. Every other outgoing mutation
still reaches strict admission, and both render-only IDs remain unsupported
if sent to `transform` ([decision 40](../../docs/implementation/SPN-056.md#40-exclude-the-native-render-only-drawing-refresh-from-outgoing-edits)).
This branch's native Sheet recorder exercises the Sheet exception. The Doc
counterpart is verified from pinned public source; actual Doc UI capture is
an explicit SPN-058 integration check, followed by SPN-056's integrated review.

The transforms read the base cells and nothing else of the document, so some
facts must travel with the mutation, and the client must keep a base of its
own:

- **A client keeps a confirmed copy of the document**: the server's state as
  of the last revision it applied, before its own pending edits. It passes
  `{ cells }` from that copy when it transforms an incoming edit past its sent
  batch, and from that copy with the sent batch applied when it transforms
  past its unsent edits. The copy must match the server's snapshot at that
  revision exactly, or the guarantee is lost (SPN-058).
- **A client sends its rebased edits as `transform` returned them**, absolute
  writes and claims included. `check` rejects a claim without
  `isOverrideStyle`, a claim of a key, style key or border edge the cell does
  not write, a claim in a range move, and any other `sync-transform.` key in
  a cell. `transform` also rejects (`TypeError`) an absolute write that
  changes a key, style key or border edge it does not claim from the cell it
  lands on, read from `cells` after the earlier mutations of its list: the
  transform's own restate their cell wherever they claim nothing. So a
  sender that forges a claim can only make its write count as the plain
  write of the keys it changes would, and a formula it writes is still a
  formula write (`'formula-race'`). The type `t` is not checked: Univer
  types each value it writes, so the restated type can differ from the
  base's, and no refusal reads it. Nor are `ft` and `fd` where the write
  clears `f` with no formula id: Univer's merge drops them there, and the
  tail that follows claims the ones it writes back. An absolute write that
  needs a tail and is not directly followed by it, as `transform` returns
  them, is rejected (`TypeError`), since the transform reads the two as one
  write (decision 36). An absolute write therefore needs
  `cells` even where no two writes meet; without them no claim can be
  checked, so none is taken on trust. A batch that fails this check is
  refused: `transform` throws, and the server refuses the batch, resyncs its
  sender and logs it (see "Contract"). The transform's own absolute writes
  are made to pass it, and `tests/simulate.ts` checks every one it returns.
- **`RemoveSheetMutation` carries `index`**, the removed sheet's position, which
  Univer's mutation omits. The transform throws a `TypeError` without it.
- **Styles are inline objects, never style ids.** Each client allocates style
  ids at random, so an id means nothing on another screen.
- **Doc inserts keep their paragraph ids.** Mark them with Univer's
  `PRESERVE_INSERTED_PARAGRAPH_IDS`, or each client generates its own.
- **An insert or delete with shift marks its MoveRange**
  `shift: {axis, kind, at, count}`: the range's start and size on the shift
  axis. A move's mutations alone cannot tell a shift from a drag of the same
  cells, and a shift's area runs past the cells they name, to the sheet's
  edge. A MoveRange with an empty `from.value` stays unmarked. The transform
  throws a `TypeError` for a mark on one, or a mark that disagrees with the
  ranges.
- **Every mutation keeps the `trigger` Univer gives it**, the id of the
  command that sent it (`IMutationCommonParams`). A delete with shift that
  reaches the content's last line sends no MoveRange, so only `trigger` marks
  its cell writes and name sets as that command's rewrites. A name set or
  removal with no `trigger` counts as another command's rewrite and is refused
  against any concurrent name edit, while such a delete whose other mutations
  carry none merges as typed edits would. The transform keeps `trigger` on
  what it returns: each cell write carries the `trigger` of the edit it
  transformed, or none, even where it replays the other side's write, so a
  stored edit counts as its own sender's command and no other.
- **A doc gets its `drawings` and `drawingsOrder` containers when it is
  created.** Two first drawings made at once would otherwise each create them.
- **A client that reloads because an incoming edit cannot pass its pending
  edits still waits for the server's answer to the batch it already sent.**
  The server may accept that batch: it pairs it only with the incoming edit,
  and the refusal may have come from a later edit still in the client's
  buffer. So the client keeps the batch it sent and reloads once the server
  has answered it, whatever the refusal's reason.
- **A mutation is copied before it is applied.** Univer's handlers can write
  into the params they apply (a rich-text mutation adds `oldBody` to its
  actions), so the copy sent or transformed must not be the one applied.

## Not supported

Rejected with `UnsupportedMutationError`:

- Any id not in `supportedMutationIds`: range and sheet protection, copying a sheet of 6000 cells or more,
  calculation settings, permission rules on sheets and docs, a sheet's
  right-to-left direction, doc shapes, and range themes and sort, which no
  menu Spinel loads sends today.
- Formula results (`sourceFormulaData`), which each client computes locally
  and never sends. The cell merge passes none to
  `prepareSetRangeValuesMutation` either: there it only makes the merge skip
  a cell whose formula changed since the result was computed
  (`isStaleFormulaResult`), and no write the transform merges can carry it.

Univer also registers `sheet.mutation.empty`, which no command sends, and
`sheet.mutation.mark-dirty-filter-change`, from filters, which Spinel does not
load. Both are rejected like any other unsupported id.

### Loaded preset mutation exclusions

The actual Sheet, mobile Sheet and Doc editors are inventoried in browser CI by
observing public command registration before their normal presets start. Every
mutation-typed registration, including IDs named `.operation.`, must either be
in `supportedMutationIds` or explicitly listed here. The inventory is evidence
only and never changes outgoing admission. An unexpected ID fails the test.

These native cache/service entries are local or worker coordination. They have
no transform and are refused if submitted as document edits:

- `formula.mutation.register-function`
- `formula.mutation.remove-feature-calculation`
- `formula.mutation.remove-other-formula`
- `formula.mutation.remove-super-table`
- `formula.mutation.set-array-formula-data`
- `formula.mutation.set-cell-formula-dependency-calculation`
- `formula.mutation.set-cell-formula-dependency-calculation-result`
- `formula.mutation.set-feature-calculation`
- `formula.mutation.set-formula-calculation-notification`
- `formula.mutation.set-formula-calculation-result`
- `formula.mutation.set-formula-calculation-start`
- `formula.mutation.set-formula-calculation-stop`
- `formula.mutation.set-formula-data`
- `formula.mutation.set-formula-dependency-calculation`
- `formula.mutation.set-formula-dependency-calculation-result`
- `formula.mutation.set-formula-string-batch-calculation`
- `formula.mutation.set-formula-string-batch-calculation-result`
- `formula.mutation.set-image-formula-data`
- `formula.mutation.set-other-formula`
- `formula.mutation.set-query-formula-dependency`
- `formula.mutation.set-query-formula-dependency-all`
- `formula.mutation.set-query-formula-dependency-all-result`
- `formula.mutation.set-query-formula-dependency-result`
- `formula.mutation.set-super-table`
- `formula.mutation.set-super-table-option`
- `formula.mutation.set-trigger-formula-calculation-start`
- `sheet.mutation.data-validation-formula-mark-dirty`

The preset packages also contain unsupported document features. Registering a
handler does not enable it for collaboration. Range/worksheet protection and
permission changes, range themes/sort, large-sheet copy completion, calculation
settings and right-to-left worksheets remain refused. SPN-059 owns their final
menu audit before activation:

- `doc.mutation.set-permission-rule`, `doc.mutation.set-permission-rules`
- `sheet.mutation.add-range-protection`, `sheet.mutation.set-range-protection`,
  `sheet.mutation.delete-range-protection`
- `sheet.mutation.add-worksheet-protection`, `sheet.mutation.set-worksheet-protection`,
  `sheet.mutation.delete-worksheet-protection`, `sheet.mutation.set-worksheet-permission-points`
- `sheet.mutation.add-range-theme`, `sheet.mutation.set-range-theme`, `sheet.mutation.remove-range-theme`
- `sheet.mutation.register-worksheet-range-theme-style`, `sheet.mutation.unregister-worksheet-range-theme-style`,
  `sheet.mutation.set-worksheet-range-theme-style`, `sheet.mutation.remove-worksheet-range-theme-style`
- `sheet.mutation.reorder-range`, `sheet.mutation.copy-worksheet-end`
- `sheet.mutation.set-workbook-calculation-settings`, `sheet.mutation.set-worksheet-right-to-left`

Finally, `sheet.operation.clear-drawing-transformer` and
`doc.operation.clear-drawing-transformer` are native mutation-typed renderer
refreshes. Exact-ID sender exclusions keep these two local; they are still
unsupported if received over the wire. Actual drawing writes remain supported.

## Known limits

Invariants over the whole workbook cannot be kept by transforming two edits
that each kept them. The server has to check the merged result:

- Two people removing the last two sheets at once leave no sheet.
- Two people hiding the last two visible sheets at once leave none visible,
  and Univer then fails the next sheet removal.
- A malformed name assignment can collide with an unchanged sheet: the
  transform reads base cells, not a full worksheet-name registry. The server
  validates worksheet identities and case-insensitive name uniqueness on the
  final candidate, in addition to the concurrent guard described above.

Also:

- The cell merge is only as right as `options.cells` (see "What a server must
  do"). The transform cannot check the cells it is given, so a server or
  client that reads the wrong revision, or a client copy that drifted from
  the server's, makes screens diverge with no error.
- Two writes to one cell end as Univer makes them in the server's order, and
  that can differ from what either sender saw. A number format no longer
  retypes a concurrent value (decision 30): a value `7` and a concurrent text
  format `@` end a number under `@` where the format was accepted first, and
  text where the value was.
- A drawing anchored below rows that another person inserts at the same moment
  keeps its anchor cell rather than following them: Univer's row commands move
  drawings with separate mutations computed from the sender's own layout.
- Frozen panes do not follow a concurrent row or column insert: Univer's row
  commands send their own SetFrozen from the sender's layout, and two of those
  conflict like any setting. Both screens agree; the frozen line may sit one
  row off from where the sender meant it.
- Univer 1.1.0 can retain a sheet drawing with zero or negative size after
  structural work. Spinel's pinned open-source drawing patch preserves that
  finite geometry through native resize and queued refresh, so following edits
  continue. It does not clamp the image, remove its identity, or allow invalid
  new placement requests. The mixed native-command fuzz no longer skips these
  states; focused native queue/reopen and ES/CJS patch controls cover the repair.
- Locked SDT blocks and footnote edits in docs depend on document state and are
  not fuzz-tested. Clear contents, clear formats, clear all and pasting a style
  act on the selection or clipboard, so the fuzz builds their mutations by hand
  rather than capturing the commands.
- The doc fuzz edits body text, its styles (merged, or replaced as the format
  painter does), bullets, paragraph styles,
  hyperlinks (added and removed with Univer's own link builders), formulas
  (inserted at the caret or over a selection, and edited in place, as
  SPN-033's adapter does), doc drawings and the doc's name. It checks only that
  clients converge: typing inside a formula or deleting part of it breaks the
  formula on both screens, as it would for one person alone. Headers, footers and notes travel in the same ot-json1 op
  and transform the same way, but no test edits them.
- A name set or removal is refused against any concurrent edit that could make
  Univer rewrite names, wherever the name points, so a rename on one sheet and
  a row insert on another are refused though they would merge. Two people
  giving two names the same text at once are refused, in any scope, though
  Univer would hold both.
- In a book with names, that refusal reaches edits that never touch a name.
  Every row, column or shift command on a sheet re-sends each name that
  refers to that sheet, moved or not, as a name set among its own mutations,
  and that set races every concurrent row or column edit, range move or
  rename anywhere in the workbook. So in a book with one named range, every
  row, column or shift edit on its sheet, even one far below it, is refused
  against any concurrent row or column edit or drag, on any sheet: a row
  insert on Two and a column insert on the name's sheet are refused
  (`'name-race'`). Edits on a sheet no name refers to send no name set. The
  refusal table below has a row for such a book.
- A formula write is refused against any concurrent edit that could make
  Univer rewrite formulas, wherever the formula points and whatever it reads,
  so a formula with no references, or one on another sheet, is refused against
  a row insert, and any formula against a name added at once. In a book with
  formulas, every row, column or shift command on a sheet re-sends each
  formula that reads that sheet, wherever it sits and moved or not, and each
  formula in cells it moves, so each such command races every concurrent row
  or column edit, range move, rename or name edit in the workbook. So a book
  with one formula on a sheet, such as `=A1`, refuses every row, column or
  shift edit there against every such concurrent edit (`'formula-race'`): two
  row inserts below all content are refused, and so is a value typed over the
  formula against one of them. A formula with no references, or one that reads only
  a name, is re-sent only where its cell moves.
- A command's rewrite of a formula is also refused against a concurrent write
  that replaces the cell's value or formula with none, such as a value typed
  over it (which sends `v` and `f: null`) or a clear (`'formula-race'`):
  accepted first, the rewrite would put the formula back over the value. A
  style or a number format on the cell merges. Rewrites are told apart batch
  by batch: every formula write in a batch that also holds an edit that
  rewrites formulas counts as one, so a formula typed in the same batch as an
  unrelated row insert is refused against a value typed into its cell at once.
- Two edits of one name are exempt from the formula rule only for their
  commands' rewrites of formulas both senders had, since each name command
  rewrites only the cells it saw. So a batch that types a formula and edits a
  name is refused against a concurrent edit of the same name, though only a
  formula that uses the name, or one typed over a cell that does, would break.
  The one exception is harmless: a formula typed after the rename, into a cell
  where the other side also typed a formula after its own rename.
- Refusals. Measured 2026-10-23 with captured Univer commands: 300 seeds,
  each run until two clients have made 40 mutations, with intent checks on.
  These historical measurements predate the corrected collaboration-event
  capture and the additional worksheet/history guards; they are not current
  refusal rates. SPN-056's integrated review measures the resulting accepted
  and refused edits by family again.
  The `refusals on a real sheet` test in `tests/cells.test.ts` prints the
  counts when run with `REFUSAL_SEEDS=300`. An edit is one command's mutations (one
  `generate` call); a batch is a client's pending edits sent together. A
  refusal is the server refusing a batch, which drops it and the edits after
  it. A resync is a client whose pending edits an incoming edit cannot pass: it
  drops its unsent edits and reloads once the server has answered the batch it
  already sent, which the server may accept or refuse. A resync whose sent
  batch is then refused counts in both, so the third column counts such an
  episode twice.

  | Edits, sheet                                                         | Refused / edits     | Refused + resynced / edits | Refused / batches at the server | Mutations discarded / all made |
  | -------------------------------------------------------------------- | ------------------- | -------------------------- | ------------------------------- | ------------------------------ |
  | `realEdit`, `realBook()` (200×26, content in 30×10)                  | 417 / 8,146 = 5.12% | 881 / 8,146 = 10.82%       | 417 / 3,361 = 12.41%            | 3,960 / 12,118 = 32.68%        |
  | `realEdit`, `realBook()` with one name (A3:B5)                       | 469 / 6,458 = 7.26% | 967 / 6,458 = 14.97%       | 469 / 2,687 = 17.45%            | 5,089 / 12,237 = 41.59%        |
  | `commandEdit`, the dense tests' 4×3 sheet                            | 635 / 7,642 = 8.31% | 1,308 / 7,642 = 17.12%     | 635 / 3,157 = 20.11%            | 5,080 / 12,191 = 41.67%        |
  | `commandEdit`, `realBook()`                                          | 299 / 8,223 = 3.64% | 679 / 8,223 = 8.26%        | 299 / 3,376 = 8.86%             | 3,043 / 12,157 = 25.03%        |
  | `commandEdit`, `realBook()` with one name and formulas on two sheets | 338 / 5,773 = 5.85% | 740 / 5,773 = 12.82%       | 338 / 2,483 = 13.61%            | 4,388 / 12,508 = 35.08%        |

  `realEdit` (`tests/generate-cells.ts`) aims at `realBook()`'s content: 40%
  values, 10% bold, 10% drags, 40% inserts and deletes with a shift. A common
  cause is an insert with shift's own row or column insert, which Univer sends
  just past the content and so cuts the area of a concurrent shift along the
  same axis in any other band. The simulated clients hold many unsent edits,
  so one refusal discards several. With one defined name, each row, column or
  shift command on One also sends a name set, moved or not (see above), so an
  edit holds more mutations and races more of the other side's. `commandEdit` also types
  formulas (`=A1&"…"`), which race every concurrent shift (`'formula-race'`).
  The book with formulas (`formulaBook()` in `tests/cells.test.ts`) is the named
  book with three formulas beside One's content, one of them a sum of the name,
  and a second 200×26 sheet, Two, with two formulas that read One; each row,
  column or shift command on One also re-sends them, moved or not. The table
  was measured with captured commands, so its rows already count these
  re-sends, and each refusal they cause.

  The owner accepted these rates (chat 2026-10-21 and 2026-10-22, decision
  16), including the rows with a name and with formulas: a refused edit is
  visible and its sender can redo it, while a merged one could be lost
  silently. Later rounds moved some rows by less than a point each, accepted
  by the agent under the owner's delegation (decision 22).
  Re-measured 2026-10-23 once same-cell writes resolved on the cell
  (decision 29, the replay merge): the `realEdit` rows did not move, and the three
  `commandEdit` rows fell, from 8.80%, 3.65% and 5.87% refused per edit, as
  no format race is left to refuse. Accepted by the agent under the owner's
  delegation (chat 2026-10-23): every row that moved went down, and only
  because a refusal rule went; the owner reviews it with the PR.

- A shift is refused only against edits in the cells its MoveRange names, and
  Univer's shift commands name only cells up to the sheet's content. The band
  stops at the sheet's last column with content, or for a shift left or right
  its last row. A delete that reaches the content's last line sends no
  MoveRange. A shift on lines with no content sends an empty one, which stays
  unmarked and moves nothing. A concurrent write beyond the content, in the part
  the MoveRange leaves out, is therefore merged. It lands where it was made
  rather than moving with the shift. For example, inserting J2:K2 shifted down
  on a sheet whose content ends at column J, while someone else writes K5,
  leaves the write at K5 while J5 moves to J6. Both screens agree and nothing
  is lost. Inside the content the same race is refused. The intent checks
  cannot see this: they check that keys keep their values and that clients
  agree, not where a write onto an empty cell lands. The owner accepted this
  (chat 2026-10-21) over making the sender mark the command's whole band
  (`src/shifts.ts`, `areasOf`).
- A shift at the content's edge is told by its mutations' `trigger`, since a
  delete that reaches the content's last line sends no MoveRange, so it races
  name edits and formula writes as a shift inside the content does
  (`'name-race'`, `'formula-race'`). Undo/redo replaces that trigger, so its cell
  writes conservatively count as possible rewrites even without a MoveRange,
  name edit or existing formula. This also refuses some ordinary cell history
  edits against concurrent formula/name edits; see "Undo and redo reference
  edits" above. The earlier stale-rewrite loss is repaired by decision 39.
- Growth. Each mutation of one list can split into several past the other
  (a write into the cells only it writes, an absolute write and its tail),
  and each later mutation meets all of them, so many concurrent edits could
  make a transform's output grow. `transform` throws `RefusedEditError`
  (`'growth'`) once a sequence holds more than 50 mutations per input, rather
  than running for hours: the trip is refused like any other race, and its
  sender reloads (owner, chat 2026-10-21, decision 15). Under the rule-based
  merge a loser on a cell whose format either side changed kept its write,
  replayed the winner's and retyped the value, one write becoming three;
  resolved on the cell, that retype is gone. Measured 2026-10-23 by counting
  every `'growth'` throw: none in `tests/fuzz.test.ts`'s 100 seeds × 1,000
  mutations, 1,000 seeds × 40 and × 100 of `cellEdit` on the dense 4×3
  sheet, or 1,000 × 40 of each schema generator, and none in the four schema
  sweeps of 2,000 seeds × 40; the largest output was 2 mutations per input.

## Tests

`tests/` runs every pair against a headless Univer with the real open-source
handlers (`tests/harness.ts`), so convergence is checked against the model the
editors use, not a re-implementation of it. The harness loads
`@univerjs/sheets-formula`, as Spinel's editor does, so a captured row edit or
range move sends the defined-name rewrites it sends there. `liveCells` reads a
replica's cells as `BaseCells`, and `snapshotCells` a snapshot's.
Native Sheet command fixtures use the public collaboration-event boundary
described above. The undo/redo regression explicitly observes local formula
cache updates, proves they stay off the wire, and retains exact assertions for
the outgoing cell formula rewrites.

- One file per family with unit tests for each transform pair.
- `tests/state.test.ts`: the cell state the merge reads, on its own:
  `difference` and `overlay`, the number-format effect (set, removal, and a
  value's type under each), absolute writes and their tail, the claim check,
  and `Cells.after` through cell writes, row and column inserts, removals and
  moves, range moves, sheet inserts and removals, and other sheets.
- `tests/transform.test.ts`: `check`, including every claim it rejects, the
  base check of an absolute write's unclaimed keys, and the transform's own
  absolute writes passing both again. `tests/simulate.ts` runs the base
  check on every transform's output too, on the cells after the edits it
  was transformed past, so every fuzz run checks that the transform's own
  absolute writes restate their cells.
- `tests/fuzz.test.ts`: two simulated clients and a server with random message
  delays make 100,000 mutations from every family at once, and all three replicas
  must end identical, and a client must match the server whenever it has
  nothing pending and has applied every revision. The server reads its
  snapshot at each batch's base revision, and each client its confirmed copy,
  as SPN-057 and SPN-058 will. A failure names its seed; `FUZZ_SEED=<n>`
  replays it. The comparison ignores an empty `bullet.textStyle`, which
  Univer's own apply adds on one replica and no command writes.
- `tests/cells.test.ts` and `tests/cells-dense.test.ts` also fuzz small sheets
  densely and check intent, not only agreement: no token is ever in two cells,
  and every key of a cell (value,
  formula, rich text, each style key and border edge, number format) keeps its value, following
  moves, unless an edit that saw it wrote that key or deleted the cell. An edit
  saw what its sender had applied when it made it, not what it was transformed
  past before it was sent, and the server checks each mutation of a batch on
  its own, so a write the batch's later one overwrites is checked too. A client
  must also agree with the server on the keys an incoming edit wrote. Two
  rules of the Cells merge are accepted there: a write of `t` alone accepted
  first holds no value against a concurrent write of the value (decision
  35), and a restyle of the cell's rich text accepted first keeps no `p`
  against a concurrent deletion of it (decision 32). A refused
  edit resyncs its sender, as SPN-058's client will, and a resyncing client's
  sent batch still gets the server's answer. The checks do not see
  where a write onto an empty cell lands if both screens agree on it (see
  "Known limits").
- `tests/schema.test.ts` fuzzes cell writes built from Univer's own types
  (`tests/generate-schema.ts`): every `ICellData` key and every `IStyleData`
  key, each border edge too, left out, null, falsy or set to a value Univer's
  sanitizers keep, sometimes as a style override, among editor commits,
  commands and cuts. They meet a book seeded with a formula with `ft` and
  `fd`, a shared formula (`si`), a `custom`, bordered rich text and numbers
  under the text format `@`, with the intent checks on and the 50× growth budget. A forced
  type (`t`) comes only beside the value it types, as Univer's writers send
  it. Two generators run: `schemaEdit`, every key, over 200 seeds × 40
  mutations, and `schemaEdits(['ft', 'fd'])`, without `ft` and `fd`, over
  1,000. `SWEEP=<first>-<last>` (with `SWEEP_SKIP=ft,fd` for the second)
  runs a range of seeds without stopping and prints each failure and the
  counts. Each finding's minimal case is a test there (F1 to F12, and round
  19's value with a format clear against the 14 shapes). None is open; an
  open one would be a `test.fails`, so a fix fails it until it becomes a
  plain test. F8 and F12 are the two rules above (decisions 32 and 35) that
  the intent checks accept, and each also has a test that a planted fault
  just outside its rule is still flagged (`tests/simulate.ts`, `yields`).
  `SHRINK_SEED=<n>` (with `SHRINK_SKIP=ft,fd` for its second run) prints a
  failing seed's smallest steps as JSON mutations (`tests/shrink.ts`: delta
  debugging over its edits, steps, mutations, cells and keys).
- `tests/rule-based.test.ts`: the rule-based merge's tests and the final
  comparison's probes, ported as convergence tests with the intent checks
  on, each named "rule-based …" after where it came from (F-numbers collide
  between the two trees): the 1,920-case forced-text class, the F5, F6, F12
  and format-race cases the rule-based merge refused, its F13 to F16, the 11
  pairs of round 20's matrix it diverged on, and the forced-text three-edit
  matrix, reduced to 1,372 runs (`FORCED_MATRIX=1` runs all 8,232). Small
  outputs are pinned cell by cell.
- `tests/docs.test.ts` does the same for text-run styles: every `ITextStyle`
  key left out, null, falsy or set, merged in (COVER) or replacing (REPLACE).
- `tests/ids.test.ts`: every supported id is one Univer registers, so a renamed
  mutation in an upgrade fails here instead of passing through untransformed.

CI runs the dense-cell file, the remaining cell tests plus mixed-family fuzz,
and every other library test on three separate runners. Each keeps one Vitest
worker and a 15-minute job budget. The required `Lib tests` aggregate passes
only when every expected partition passes, or when classification explicitly
finds no relevant library change. New library test files enter the complement
automatically. This changes execution layout without reducing seed sets,
mutation counts or assertions; the [runtime record](../../docs/implementation/SPN-056.md#ci-runtime-and-parallel-execution)
explains the partition and the simulator work removed.

```bash
npx vitest run lib/sync-transform
```
