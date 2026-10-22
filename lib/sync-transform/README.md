# @spinel/sync-transform

Operational transforms for concurrent [Univer](https://github.com/dream-num/univer)
1.1.0 Sheet and Doc mutations, so a central sync server can merge two people's
edits the same way on every screen. Pure TypeScript with no server, DOM or
rendering dependency. At runtime it imports `@univerjs/core` and, to type
cell values exactly as Univer does, `getCellType` and `getCellValue` from
`@univerjs/sheets`; `docs` and `drawing` are peers too, because the transforms
implement their 1.1.0 mutation formats.

It is written from the open-source mutation definitions in `@univerjs/sheets`,
`@univerjs/docs` and `@univerjs/drawing`, not from Univer's closed-source
collaboration packages.

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
merge in a shift's area, and a row or column edit that cuts the area. It also
throws for a number-format change and a concurrent write to one of its cells
that sets no value, such as a style (`'format-race'`), since a write under
text format `@` loses the value's type and only the sender knew it; and for a
transform whose output would grow past its limit (`'growth'`, below). That is
a race, not a sender bug: the server refuses the later edit, and its sender
drops its pending edits from it on and reloads the document (SPN-057,
SPN-058).

## What it covers

| Family                    | Mutations                                                                                             | Conflict rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure                 | row and column insert, remove, move; sheet insert, remove, reorder                                    | Both edits keep their intent: removals stick, a moved block stays with the side that moved it, inserts land before the first surviving row at or after their position. Every other family is re-addressed through the same index mapping.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Cells                     | set range values (values, formulas, inline styles), number formats, range moves within a sheet        | Per cell and key, the winner's write stands; the loser keeps the keys the winner did not write. A dragged range or a shift and a concurrent edit in its area are refused (`RefusedEditError`, `'moved-cells'`): a drag's area is its source and target, a shift's its band from its start to the sheet's edge, and what meets it there is a cell write, a number format, another drag or shift, a merge in a shift's area, or a row or column edit that cuts the area. Edits outside the area pass unchanged, and a row or column edit wholly outside it moves the move. A number-format change against a concurrent write of no value to one of its cells is refused too (`'format-race'`). |
| Row and column properties | height, width, hidden, auto height, row and column data                                               | Per index and key, the winner's write stands. A width is re-sent as column data where visibility could differ between orders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Merges                    | add, remove                                                                                           | Intersecting edits conflict and the winner's stands. Merges move as Univer's merge listener moves them; a merge added while someone else's row or column edit cuts through it is dropped on both screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Sheet settings            | frozen panes, row and column count, default style, gridlines, name, tab colour, hidden, workbook name | Two of the same setting: the winner's value stands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Drawings                  | sheet drawings (insert, remove, move, z-order), background image                                      | The drawing op is transformed whole with ot-json1; the winner wins a write conflict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Docs                      | rich-text editing (body, headers, footers, notes, doc drawings), rename, hyperlinks                   | `JSON1` with the `TextX` subtype from `@univerjs/core`; the winner wins a write conflict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Each rule above that was a choice, not a consequence of Univer's model, is
marked `Decision (owner, …)` where the code makes it, with the option not
taken and why.

## What a sender must do

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
  ones drops a batch it already sent**, as the tests do. That is safe because
  the server refuses that batch too: `'moved-cells'` and `'format-race'`
  refuse a pair in either order. `'growth'` is not shown to, so for a growth
  refusal SPN-058's client should wait for the server's answer to its batch in
  flight before reloading.

## Not supported

Rejected with `UnsupportedMutationError`:

- Any id not in `supportedMutationIds`: defined names (the name box and its
  manager; a row or column edit also emits one when a name refers to the rows),
  range and sheet protection, copying a sheet of 6000 cells or more,
  calculation settings, permission rules on sheets and docs, a sheet's
  right-to-left direction, doc shapes, and range themes and sort, which no
  menu Spinel loads sends today.
- A range move to another sheet (cut and paste across sheets): it edits two
  sheets, and every transform addresses one.
- Formula results (`sourceFormulaData`), which each client computes locally
  and never sends.

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
- Refusals. Measured 2026-10-21 with captured Univer commands: 300 seeds,
  each run until two clients have made 40 mutations, with intent checks on.
  The `refusals on a real sheet` test in `tests/cells.test.ts` prints the
  counts when run with `REFUSAL_SEEDS=300`. An edit is one command's mutations (one
  `generate` call); a batch is a client's pending edits sent together. A
  refusal is the server refusing a batch; a resync is a client whose pending
  edits an incoming edit cannot pass, which resyncs before the server sees
  them. Either drops the client's unacknowledged mutations.

  | Edits, sheet                                        | Refused / edits     | Refused + resynced / edits | Refused / batches at the server | Mutations discarded / all made |
  | --------------------------------------------------- | ------------------- | -------------------------- | ------------------------------- | ------------------------------ |
  | `realEdit`, `realBook()` (200×26, content in 30×10) | 213 / 8,151 = 2.61% | 689 / 8,151 = 8.45%        | 213 / 3,074 = 6.93%             | 4,185 / 12,127 = 34.51%        |
  | `commandEdit`, the dense tests' 4×3 sheet           | 326 / 8,359 = 3.90% | 1,079 / 8,359 = 12.91%     | 326 / 2,958 = 11.02%            | 5,347 / 12,108 = 44.16%        |
  | `commandEdit`, `realBook()`                         | 35 / 9,824 = 0.36%  | 176 / 9,824 = 1.79%        | 35 / 3,927 = 0.89%              | 1,080 / 12,058 = 8.96%         |

  `realEdit` (`tests/generate-cells.ts`) aims at `realBook()`'s content: 40%
  values, 10% bold, 10% drags, 40% inserts and deletes with a shift. A common
  cause is an insert with shift's own row or column insert, which Univer sends
  just past the content and so cuts the area of a concurrent shift along the
  same axis in any other band. The simulated clients hold many unsent edits,
  so one refusal discards several.
  The owner accepted these rates (chat 2026-10-21): a refused edit is visible
  and its sender can redo it, while a merged one could be lost silently.

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
- Many concurrent edits of one cell can make a transform's output grow
  exponentially. A write that loses on a cell whose number format either side
  changes keeps its own write, replays the winner's and retypes the value,
  since a stateless transform can't know the type Univer will give it. So one
  write becomes three, and each later write to the cell meets all three.
  `transform` throws `RefusedEditError` (`'growth'`) once a sequence holds
  more than 50 mutations per input, rather than running for hours: the trip
  is refused like any other race, and its sender reloads. Measured
  2026-10-21: no trips in `tests/fuzz.test.ts` (100 seeds × 1,000 edits), and
  1 trip each in 1,000 seeds × 40 and × 100 edits of `cellEdit` on the dense
  tests' 4×3 sheet. The owner chose this (chat 2026-10-21) over dropping the
  retype, which could leave a value with the wrong type.

## Tests

`tests/` runs every pair against a headless Univer with the real open-source
handlers (`tests/harness.ts`), so convergence is checked against the model the
editors use, not a re-implementation of it.

- One file per family with unit tests for each transform pair.
- `tests/fuzz.test.ts`: two simulated clients and a server with random message
  delays make 100,000 edits from every family at once, and all three replicas
  must end identical. A failure names its seed; `FUZZ_SEED=<n>` replays it.
- `tests/cells.test.ts` also fuzzes small sheets densely and checks intent, not
  only agreement: no token is ever in two cells, and every key of a cell (value,
  formula, rich text, each style key, number format) keeps its value, following
  moves, unless an edit that saw it wrote that key or deleted the cell. An edit
  saw what its sender had applied when it made it, not what it was transformed
  past before it was sent, and the server checks each mutation of a batch on
  its own, so a write the batch's later one overwrites is checked too. A client
  must also agree with the server on the keys an incoming edit wrote. A refused
  edit resyncs its sender, as SPN-058's client will. The checks do not see
  where a write onto an empty cell lands if both screens agree on it (see
  "Known limits").
- `tests/ids.test.ts`: every supported id is one Univer registers, so a renamed
  mutation in an upgrade fails here instead of passing through untransformed.

```bash
npx vitest run lib/sync-transform
```
