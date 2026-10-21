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
losing or duplicating content: a dragged range and an edit of any cell it
moves, in its source or its target (`reason: 'moved-cells'`); range moves
that touch the same cells, a shift (below) that a concurrent move, row edit or
shift on the other axis cuts, a shift that inserts at the sheet's end against
a same-axis shift of only part of its band, or two shifts of one band that
carry a line differently (`'overlapping-moves'`); a number-format change and
a concurrent write to one of its cells that sets no value, such as a style
(`'format-race'`), since a write under text format `@` loses the value's type
and only the sender knew it; or a transform whose output would grow past its
limit (`'growth'`, below). That is a race, not a sender
bug: the server refuses the later edit, and its sender drops its pending edits
from it on and reloads the document (SPN-057, SPN-058).

## What it covers

| Family                    | Mutations                                                                                             | Conflict rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure                 | row and column insert, remove, move; sheet insert, remove, reorder                                    | Both edits keep their intent: removals stick, a moved block stays with the side that moved it, inserts land before the first surviving row at or after their position. Every other family is re-addressed through the same index mapping.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Cells                     | set range values (values, formulas, inline styles), number formats, range moves within a sheet        | Per cell and key, the winner's write stands; the loser keeps the keys the winner did not write. A dragged range and a concurrent edit of any cell it moves are refused (`RefusedEditError`, `'moved-cells'`), as are two range moves that touch the same cells, and a number-format change against a concurrent write of no value to one of its cells (`'format-race'`); edits and moves of different cells both land. Inserting or deleting cells with a shift is transformed as a row or column insert or remove limited to a band of columns or rows, so two shifts of one band merge, a partial overlap splits, and edits and whole moves inside the band move with it; shifts along different axes that cross are refused. |
| Row and column properties | height, width, hidden, auto height, row and column data                                               | Per index and key, the winner's write stands. A width is re-sent as column data where visibility could differ between orders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Merges                    | add, remove                                                                                           | Intersecting edits conflict and the winner's stands. Merges move as Univer's merge listener moves them; a merge added while someone else's row or column edit cuts through it is dropped on both screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sheet settings            | frozen panes, row and column count, default style, gridlines, name, tab colour, hidden, workbook name | Two of the same setting: the winner's value stands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Drawings                  | sheet drawings (insert, remove, move, z-order), background image                                      | The drawing op is transformed whole with ot-json1; the winner wins a write conflict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Docs                      | rich-text editing (body, headers, footers, notes, doc drawings), rename, hyperlinks                   | `JSON1` with the `TextX` subtype from `@univerjs/core`; the winner wins a write conflict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
  cells. A MoveRange with an empty `from.value` stays unmarked. The transform
  throws a `TypeError` when a mark disagrees with the ranges.
- **A doc gets its `drawings` and `drawingsOrder` containers when it is
  created.** Two first drawings made at once would otherwise each create them.

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
- Refusals. Measured 2026-10-20 with captured Univer commands, 300 seeds × 40
  edits from two clients. On a 200×26 sheet with content in its first 30 rows
  and 10 columns, and edits aimed there (40% values, 10% bold, 10% drags, 40%
  inserts and deletes with a shift): 411 refused, 5.04% of the 8,154 edits
  sent: 259 two shifts on the same cells, 106 a shift that cuts a drag or
  that the lines an insert adds cut, and 46 a drag against an edit of its
  cells or another drag. On a 4×3 sheet with `commandEdit`: 759, 9.05% of
  edits sent, 341 of them a drag against an edit of its cells and 156 a
  number format against a write of no value.
- Many concurrent edits of one cell can make a transform's output grow
  exponentially. A write that loses on a cell whose number format either side
  changes keeps its own write, replays the winner's and retypes the value,
  since a stateless transform can't know the type Univer will give it. So one
  write becomes three, and each later write to the cell meets all three.
  `transform` throws `RefusedEditError` (`'growth'`) once a sequence holds
  more than 50 mutations per input, rather than running for hours. Measured
  2026-10-20: no trips in `tests/fuzz.test.ts` (100 seeds × 1,000 edits) or in
  1,000 seeds × 40 edits on a 4×3 sheet, and 1 trip in 1,000 seeds × 100 edits
  on that sheet.

## Tests

`tests/` runs every pair against a headless Univer with the real open-source
handlers (`tests/harness.ts`), so convergence is checked against the model the
editors use, not a re-implementation of it.

- One file per family with unit tests for each transform pair.
- `tests/fuzz.test.ts`: two simulated clients and a server with random message
  delays make 100,000 edits from every family at once, and all three replicas
  must end identical. A failure names its seed; `FUZZ_SEED=<n>` replays it.
- `tests/cells.test.ts` also fuzzes a 4×3 sheet densely and checks intent, not
  only agreement: no value is ever in two cells, and an accepted write keeps
  its value, following moves, until a later edit writes its cell. A refused
  edit resyncs its sender, as SPN-058's client will.
- `tests/ids.test.ts`: every supported id is one Univer registers, so a renamed
  mutation in an upgrade fails here instead of passing through untransformed.

```bash
npx vitest run lib/sync-transform
```
