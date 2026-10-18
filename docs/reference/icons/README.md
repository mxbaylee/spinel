# Profile icons: what to reuse from circus-health

Starting material for [SPN-036](../../todo/SPN-036.md). Circus-health lets each person
pick any [Lucide](https://lucide.dev) icon, found through a search that understands
names, synonyms and typos. SPN-036 moves what it uses into `src/` and deletes this
folder in the same PR.

Source: [mxbaylee/circus-health](https://github.com/mxbaylee/circus-health) at
`2ab77af`, written by Spinel's owner, so it isn't listed in the third-party notices.

## Copied as-is

- `person-icon-catalog.json`: every icon in `lucide-react` 1.44.0 (2,081 names, including
  3 aliases) with Lucide's own tags and categories. Taken from
  [lucide-icons/lucide](https://github.com/lucide-icons/lucide/tree/a79b2d131dab2bf20cb224bd0937b439a9c4fa99/icons)
  at `a79b2d1`, ISC. Pin `lucide-react` (or `lucide`) to the same version so every name draws.
- `person-icon-vocabulary.ts`: local synonyms that Lucide's tags miss ("lotus" → `flower-2`,
  "doctor" → `stethoscope`), plus aliases that fold duplicate names into one result.
- `person-icon-search.ts`: the ranking. Each query word scores its best match against an
  icon's words: exact, then prefix, then substring (3+ letters), then a typo within one or
  two edits (4+ letters, transpositions count as one). Names outrank Lucide's tags, which
  outrank the local synonyms. An exact full name gets a bonus, and aliases collapse to one result.

Try it: `npx tsx -e 'import { searchPersonIcons } from "./docs/reference/icons/person-icon-search.ts"; console.log(searchPersonIcons("flowre").map((i) => i.name))'`
prints `flower, flower-2`.

## Not copied

- `person-icon.ts`. It maps circus-health's older short values (`person`, `flower`) and
  accepts a single emoji. Spinel has no old values and no emoji: store `lucide:<name>`, and
  accept it only if the name is in the catalog.
- The picker component. It depends on Radix and circus-health's styles. The
  landed [theme styles](../../../src/ui/theme.css) and
  [palette](../../../src/ui/palette.ts) define Spinel's current styling; the retired
  gem rail mockup is no longer the implementation reference.

## Behaviour to keep

- **An empty search shows every icon** except aliases, 60 at a time, with "Show more".
- **Category filter** from Lucide's categories, combined with the search.
- **Keyboard:** Down arrow from the search box into the grid, arrows move within it,
  Home and End jump, Enter on a single result picks it, Escape closes without changing.
- **Live result count** ("12 results"), and a plain empty state: "No icons match. Try
  another name or description."

## Tests to port

From circus-health `src/app/features/notes/person-icon-search.test.ts`:

- The catalog matches the installed Lucide pack exactly.
- `flower` ranks `flower` first, `lotus` finds `flower-2`, `flowre` finds `flower`, and
  `doctor` finds `stethoscope`.
- A category filter returns only icons in that category.
- An emoji or a long nonsense word returns nothing.
