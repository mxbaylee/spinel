# @spinel/sync-transform

Operational transforms for concurrent [Univer](https://github.com/dream-num/univer)
1.1.0 Sheet and Doc mutations, so a central sync server can merge two people's
edits the same way on every screen. Pure TypeScript with no server, DOM or
rendering dependency. At runtime it imports only `@univerjs/core`; `sheets`,
`docs`, `drawing` and `engine-formula` are peers too, because the transforms
implement their 1.1.0 mutation formats, engine-formula's for defined names.
The list of commands that make Univer rewrite names and formulas comes from
`@univerjs/sheets-formula`'s `UpdateDefinedNameController` and
`UpdateFormulaController`.

It is written from the open-source mutation definitions in `@univerjs/sheets`,
`@univerjs/docs`, `@univerjs/drawing` and `@univerjs/engine-formula` (defined
names), not from Univer's closed-source collaboration packages.

```ts
import { transform, UnsupportedMutationError } from '@spinel/sync-transform';

// `mine` and `theirs` were both made from the same revision. The server's
// copy of an edit it accepted first wins ('right' for an incoming edit).
const rebased = transform(mine, theirs, 'right');
```

## Contract

For mutation lists `a` and `b` made from the same document,

```
apply(b) then apply(transform(a, b, side))
  ==  apply(a) then apply(transform(b, a, flip(side)))
```

in Univer's own model, side effects included. `side: 'left'` means `a` wins a
conflict. This is the property a central server needs (TP1): it orders edits
and transforms each against those it accepted since the sender's revision; each
client transforms incoming edits past its own unacknowledged ones.

`transform` throws `UnsupportedMutationError` for any mutation it has no rule
for, even when the other side is empty, so a sync client can refuse it before
sending rather than let two screens drift. `supportedMutationIds` lists the ids
it understands.

It throws `RefusedEditError` for two concurrent edits it can merge only by
losing or duplicating content: a dragged range or a shift (below) and a
concurrent edit in its area (`reason: 'moved-cells'`). A drag's area is its
source and target; a shift's is the band its MoveRange names, from the
shift's start to the sheet's edge, past the band's last cell with content
(but see "Known limits"). The edits that meet it
there are cell values, styles and number formats, another drag or shift, a
merge in a shift's area, and a row or column edit that cuts the area. A cut
to another sheet is refused against a removal of its target sheet too, which
would lose its cells on both screens. It also
throws for a number-format change, by a numfmt or a style that names `n`, and
a concurrent write to one of its cells that sets no value, such as a style
(`'format-race'`), since a write under text format `@` loses the value's type
and only the sender knew it; for a defined-name set or removal and a
concurrent edit that makes Univer rewrite names, such as a row insert, a range
move or a sheet rename (`'name-race'`), since the set's references were
written for the cells before it, and the removal's rewrite of the formulas
that use the name to `#REF!` would outlive the removal; for two names given
the same text, in any scope, which Univer could resolve differently on each
screen (also `'name-race'`); for a write of a cell formula and a concurrent
edit that makes Univer rewrite formulas, which is any of those that rewrite
names and any name set or removal, unless the formula's own edit sets or
removes that name too (`'formula-race'`), since the formula, or a command's
rewrite of it, was written for the cells before the other edit; and for a
transform whose output would grow past its limit (`'growth'`, below). That is a race,
not a sender bug: the server refuses the later edit, and its sender
drops its pending edits from it on and reloads the document (SPN-057,
SPN-058).

## What it covers

| Family                    | Mutations                                                                                                     | Conflict rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure                 | row and column insert, remove, move; sheet insert, remove, reorder                                            | Both edits keep their intent: removals stick, a moved block stays with the side that moved it, inserts land before the first surviving row at or after their position. Every other family is re-addressed through the same index mapping.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Cells                     | set range values (values, formulas, inline styles), number formats, range moves, within a sheet or to another | Per cell and key, the winner's write stands; the loser keeps the keys the winner did not write. A dragged range or a shift and a concurrent edit in its area are refused (`RefusedEditError`, `'moved-cells'`): a drag's area is its source and target, a shift's its band from its start to the sheet's edge, and what meets it there is a cell write, a number format, another drag or shift, a merge in a shift's area, or a row or column edit that cuts the area. Edits outside the area pass unchanged, and a row or column edit wholly outside it moves the move. A number-format change against a concurrent write of no value to one of its cells is refused too (`'format-race'`). A cut to another sheet is transformed as two moves, one clearing its source and one writing its target, so its area is its source on one sheet and its target on the other; `transform` joins them again, so other screens receive one move to the other sheet, or only the move that writes its target where a concurrent removal of its source sheet dropped the other. A cut and a concurrent removal of its target sheet are refused (`'moved-cells'`), since the cells would be lost; a removal of its source sheet leaves them on the target. A write of a formula (`f`, or a shared formula's `si`) against a concurrent edit that makes Univer rewrite formulas, anywhere in the workbook, is refused (`'formula-race'`): row and column edits, range moves, sheet removal, sheet and workbook renames, and name sets and removals other than of a name the formula's own edit sets or removes. That includes the formulas a command rewrites, so two row inserts that each move a formula are refused, and such a rewrite is refused against a concurrent write of no formula to its cell, such as a value typed over it. |
| Defined names             | set, remove                                                                                                   | Of two edits of one name, the first accepted stands: the loser's set or removal is dropped, whole, and the cell formulas a rename rewrites follow the cells' own rule, so they name the name that stands. A name edit against a concurrent formula write is refused (`'formula-race'`, see Cells), unless that write's own edit sets or removes the same name, so renames of two names one formula uses are refused. Two names added or renamed to the same text, in any case or scope, are refused (`'name-race'`). Other edits of different names pass each other. A set or a removal against a concurrent edit that makes Univer rewrite names (row and column edits, range moves, sheet removal, sheet and workbook renames) is refused (`'name-race'`): a removal's command rewrites the formulas that use the name to `#REF!`, and those writes would stand where the other edit, accepted first, sets the name it moved and so drops the removal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Row and column properties | height, width, hidden, auto height, row and column data                                                       | Per index and key, the winner's write stands. A width is re-sent as column data where visibility could differ between orders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Merges                    | add, remove                                                                                                   | Intersecting edits conflict and the winner's stands. Merges move as Univer's merge listener moves them; a merge added while someone else's row or column edit cuts through it is dropped on both screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sheet settings            | frozen panes, row and column count, default style, gridlines, name, tab colour, hidden, workbook name         | Two of the same setting: the winner's value stands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Drawings                  | sheet drawings (insert, remove, move, z-order), background image                                              | The drawing op is transformed whole with ot-json1; the winner wins a write conflict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Docs                      | rich-text editing (body, headers, footers, notes, doc drawings), rename, hyperlinks, formulas (SPN-033)       | `JSON1` with the `TextX` subtype from `@univerjs/core`; the winner wins a write conflict. Where both edits name one paragraph, the first accepted edit's paragraph id stands, since Univer's delete can give a paragraph the deleted one's id. A formula is its source text under one whole-entity custom range. It stays whole past a style in or over it and text typed beside it, and an edit of it, which re-inserts it under its id, wins over concurrent typing, deletes and styles inside it. Of two edits of one formula, the first accepted stands: the loser's re-insert is dropped. Hyperlinks and formulas converge only with Spinel's patched `@univerjs/core` (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Each rule above that was a choice, not a consequence of Univer's model, is
marked `Decision (owner, …)` or `Decision (agent, …)` where the code makes
it, with the option not taken and why. Spinel lists them all in
[docs/implementation/SPN-056.md](../../docs/implementation/SPN-056.md).

## What a sender must do

The server and every client run `@univerjs/core` 1.1.0 with Spinel's patch
(`scripts/dependencies/patch-univer-core.ts`, applied on install). Stock 1.1.0
splits a link where a style lands inside it, leaves `$n` range ids that differ
between screens, can throw `duplicate-custom-range-id` for a single user, and
builds a negative retain when a new link crosses a paragraph break inside an
old one. A copy of this lib published on its own needs the same patch, until
upstream ships the fixes ([dream-num/univer#7938](https://github.com/dream-num/univer/pull/7938))
and SPN-095 removes it.

The transforms are stateless, so some facts must travel with the mutation:

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
- **A sender never sets `derived` in a mutation's params.** The transform marks
  the retype writes it emits with it, and a marked write loses to any unmarked
  one, so a sender's edit marked so would lose to every concurrent edit.

## Not supported

Rejected with `UnsupportedMutationError`:

- Any id not in `supportedMutationIds`: range and sheet protection, copying a sheet of 6000 cells or more,
  calculation settings, permission rules on sheets and docs, a sheet's
  right-to-left direction, doc shapes, and range themes and sort, which no
  menu Spinel loads sends today.
- Formula results (`sourceFormulaData`), which each client computes locally
  and never sends.

Univer also registers `sheet.mutation.empty`, which no command sends, and
`sheet.mutation.mark-dirty-filter-change`, from filters, which Spinel does not
load. Both are rejected like any other unsupported id.

## Known limits

Invariants over the whole workbook cannot be kept by transforming two edits
that each kept them. The server has to check the merged result:

- Two people removing the last two sheets at once leave no sheet.
- Two people hiding the last two visible sheets at once leave none visible,
  and Univer then fails the next sheet removal.

Also:

- A drawing anchored below rows that another person inserts at the same moment
  keeps its anchor cell rather than following them: Univer's row commands move
  drawings with separate mutations computed from the sender's own layout.
- Frozen panes do not follow a concurrent row or column insert: Univer's row
  commands send their own SetFrozen from the sender's layout, and two of those
  conflict like any setting. Both screens agree; the frozen line may sit one
  row off from where the sender meant it.
- Univer 1.1.0's own row and column commands can leave a sheet drawing with a
  zero or negative size, and its resize listener then throws on the next row
  or column change. The size comes from the sender's command, not a transform,
  so the fuzz skips those edits.
- Locked SDT blocks and footnote edits in docs depend on document state and are
  not fuzz-tested. Clear contents, clear formats, clear all and pasting a style
  act on the selection or clipboard, so the fuzz builds their mutations by hand
  rather than capturing the commands.
- The doc fuzz edits body text, its styles, bullets, paragraph styles,
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
  Any row, column, drag or rename command that rewrites a name sends a name
  set with its own mutations, and that set races every concurrent row or
  column edit, range move or rename anywhere in the workbook. So in a book
  with one named range, a row insert above it is refused against any
  concurrent row or column edit or drag, on any sheet. The refusal table
  below has a row for such a book.
- A formula write is refused against any concurrent edit that could make
  Univer rewrite formulas, wherever the formula points and whatever it reads,
  so a formula with no references, or one on another sheet, is refused against
  a row insert, and any formula against a name added at once. In a book with
  formulas, each command that moves the cells a formula reads sends that
  formula's rewrite, so it races every concurrent row or column edit, range
  move, rename or name edit in the workbook.
- A command's rewrite of a formula is also refused against a concurrent write
  of no formula to the same cell, such as a value typed over it (which sends
  `f: null`), a style or a clear (`'formula-race'`): accepted first, the
  rewrite would put the formula back over the value. So a style on a cell
  whose formula a concurrent row insert rewrites is refused, though it would
  merge.
- Refusals. Measured 2026-10-22 with captured Univer commands: 300 seeds,
  each run until two clients have made 40 mutations, with intent checks on.
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
  | `commandEdit`, the dense tests' 4×3 sheet                            | 652 / 7,641 = 8.53% | 1,352 / 7,641 = 17.69%     | 652 / 3,154 = 20.67%            | 5,167 / 12,192 = 42.38%        |
  | `commandEdit`, `realBook()`                                          | 282 / 8,179 = 3.45% | 656 / 8,179 = 8.02%        | 282 / 3,387 = 8.33%             | 2,999 / 12,168 = 24.65%        |
  | `commandEdit`, `realBook()` with one name and formulas on two sheets | 317 / 5,782 = 5.48% | 681 / 5,782 = 11.78%       | 317 / 2,520 = 12.58%            | 4,012 / 12,502 = 32.09%        |

  `realEdit` (`tests/generate-cells.ts`) aims at `realBook()`'s content: 40%
  values, 10% bold, 10% drags, 40% inserts and deletes with a shift. A common
  cause is an insert with shift's own row or column insert, which Univer sends
  just past the content and so cuts the area of a concurrent shift along the
  same axis in any other band. The simulated clients hold many unsent edits,
  so one refusal discards several. With one defined name, each command that
  moves the named cells also sends a name set (see above), so an edit holds
  more mutations and races more of the other side's. `commandEdit` also types
  formulas (`=A1&"…"`), which race every concurrent shift (`'formula-race'`),
  so its rows rose under that rule: from 8.25% and 1.51% refused per edit. The
  book with formulas (`formulaBook()` in `tests/cells.test.ts`) is the named
  book with three formulas beside One's content, one of them a sum of the name,
  and a second 200×26 sheet, Two, with two formulas that read One; each command
  that moves the cells they read also sends their rewrite.
  The owner accepted these rates (chat 2026-10-22), including the rows with a
  name and with formulas, and the `commandEdit` rows as the formula rule raised
  them: a refused edit is visible and its sender can redo it, while a merged
  one could be lost silently.

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
- For the same reason a shift at the content's edge does not race a name set.
  A delete that reaches the content's last line, or an insert wholly past the
  content, sends only cell writes and the command's own name set, no
  MoveRange, so a concurrent name set is merged rather than refused. Both
  screens still agree, but a name added at the same moment can point at
  deleted or shifted cells.
- Many concurrent edits of one cell can make a transform's output grow
  exponentially. A write that loses on a cell whose number format either side
  changes keeps its own write, replays the winner's and retypes the value,
  since a stateless transform can't know the type Univer will give it. So one
  write becomes three, and each later write to the cell meets all three.
  `transform` throws `RefusedEditError` (`'growth'`) once a sequence holds
  more than 50 mutations per input, rather than running for hours: the trip
  is refused like any other race, and its sender reloads. Measured
  2026-10-22, counting each `'growth'` refusal at the server and each growth
  resync at a client, so one race can count twice: no trips in
  `tests/fuzz.test.ts` (100 seeds × 1,000 mutations); 2 in 1,000 seeds × 40 mutations
  (both seed 893) and 2 in 1,000 seeds × 100 mutations (both seed 893) of
  `cellEdit` on the dense tests' 4×3 sheet. The owner chose this (chat 2026-10-21) over dropping the
  retype, which could leave a value with the wrong type.

## Tests

`tests/` runs every pair against a headless Univer with the real open-source
handlers (`tests/harness.ts`), so convergence is checked against the model the
editors use, not a re-implementation of it. The harness loads
`@univerjs/sheets-formula`, as Spinel's editor does, so a captured row edit or
range move sends the defined-name rewrites it sends there.

- One file per family with unit tests for each transform pair.
- `tests/fuzz.test.ts`: two simulated clients and a server with random message
  delays make 100,000 mutations from every family at once, and all three replicas
  must end identical, and a client must match the server whenever it has
  nothing pending and has applied every revision. A failure names its seed;
  `FUZZ_SEED=<n>` replays it. The comparison ignores an empty
  `bullet.textStyle`, which Univer's own apply adds on one replica and no
  command writes.
- `tests/cells.test.ts` also fuzzes small sheets densely and checks intent, not
  only agreement: no token is ever in two cells, and every key of a cell (value,
  formula, rich text, each style key, number format) keeps its value, following
  moves, unless an edit that saw it wrote that key or deleted the cell. An edit
  saw what its sender had applied when it made it, not what it was transformed
  past before it was sent, and the server checks each mutation of a batch on
  its own, so a write the batch's later one overwrites is checked too. A client
  must also agree with the server on the keys an incoming edit wrote. A refused
  edit resyncs its sender, as SPN-058's client will, and a resyncing client's
  sent batch still gets the server's answer. The checks do not see
  where a write onto an empty cell lands if both screens agree on it (see
  "Known limits").
- `tests/ids.test.ts`: every supported id is one Univer registers, so a renamed
  mutation in an upgrade fails here instead of passing through untransformed.

```bash
npx vitest run lib/sync-transform
```
