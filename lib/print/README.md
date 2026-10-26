# @spinel/print

Private standalone Sheet and Doc PDF renderer. Public Univer 1.1.0 layout and drawing run
against the native `@napi-rs/canvas` PDF backend. The package owns no user identity,
database, HTTP client, cookies, credentials or source evaluation. It imports no
Spinel application code and uses no Pro packages or browser Print.

SPN-101 supplies the Sheet renderer; SPN-102 extends it for Docs. SPN-075 retains the
complete production export contract: current authorized snapshots, prepared
sources, final access revalidation, process isolation/admission and download UI.
This package alone does not make production PDF export available.

## Public API and runtime

```ts
import { renderSheetPdf } from '@spinel/print';
import type { SheetPrintInput } from '@spinel/print';

// Launch this dedicated Node process with DISABLE_SYSTEM_FONTS_LOAD=1 before
// importing the package. The host prepares every input under current access.
const input: SheetPrintInput = {
  snapshot: preparedWorkbook,
  images: authorizedImages,
  fonts: licensedFonts,
  defaultFamily: 'Prepared family',
  fallbackFamilies: ['Prepared fallback'],
};
const result = await renderSheetPdf(input, {
  worksheetIds: selectedIds,
  signal: abortController.signal,
  limits: { pages: 30 },
});
// Revalidate source access in the host before releasing result.bytes.
```

The result contains `bytes`, `pages`, `mediaBox` and `durationMs`. Selection is a
set, never an ordering override. Omit it to select every visible worksheet in
workbook order. Duplicate/unknown IDs and a selection without visible sheets
fail. Hidden and very-hidden worksheets and hidden/filtered rows/columns are
omitted. Caller-owned snapshots and required image/font bytes are copied before
asynchronous preparation can observe later caller changes.

Use Node 24+ with the locked native Canvas and Sharp packages and their matching
platform binaries. CI exercises Linux x64. This private TypeScript source
workspace runs from outside `node_modules` (as npm workspaces do); publishing a
compiled package is separate work. A standalone test copies only runtime source
and links only declared dependencies, then renders through this same entry point
without Spinel source or test assets in the isolated copy.

The native font registry must be empty, with system-font loading disabled before
Canvas is imported. Use a dedicated **process**, not merely a JavaScript worker:
native registries can be process-global. Overlapping calls are rejected instead
of queued. Every operation uses fresh font aliases and removes only its own
registrations, invalidates public metrics and restores exact canvas-global
descriptors on success or failure. Discard a process reporting the `cleanup`
error code, even when its original render was cancelled or exceeded a limit.

`preflightSheets` and `paginateSheet` remain available for bounded initial
geometry. Preflight's cell/merge bounds are not final output bounds: rendering
adds actual text/border ink and image extents. Do not publish based only on an
initial plan.

## Sheet layout and completeness

- A4 portrait uses the backend's actual **595 × 842 pt** MediaBox. The public
  backend quantizes fractional A4 dimensions; every clip uses that same frame.
  Margins are exactly **36 pt / 12.7 mm**. Paper is white regardless of app theme.
- Width is reduced to one page across only when necessary. Scale never exceeds
  0.75 PDF points per native 96-DPI layout pixel; narrow content is not enlarged.
- Used bounds contain occupied/styled cells, merges, actual text overflow and
  outer border ink, and images. A larger editor viewport adds no blank grid.
  Row/column styles apply within occupied bounds. Empty visible sheets get one
  intentionally blank page.
- Saved variable/automatic dimensions and collapsed hidden axes remain intact.
  Saved filter state uses the public native filter model. Formula cells require
  prepared cached values: missing `v` fails; explicit `v: null` means an
  intentionally blank prepared result. The package never evaluates formulas.
- Standard rich runs, multiline/wrapped text, number formats, alignment,
  decorations, highlights, native rotation and merges use native layout. Complete layout is
  measured before drawing; text physically clipped by its native cell/overflow
  clip fails instead of being reported as a complete export.
- Tall rows, merged cells and images keep one worksheet coordinate system across
  contiguous vertical slices, including objects taller than a page. Cache queries
  expand outward across fractional seams; PDF clips retain exact adjacent edges.
  Content is not independently squeezed or restarted on each page.
- Finite negative ink extents from rotation or outer border strokes are included
  inside the margins. Invalid geometry and overlapping/nonfinite merge models
  fail before native indexing.

## Doc layout and prepared Formula results

`renderDocPdf` accepts `DocPrintInput`: a public `IDocumentData` snapshot, prepared
font/image bytes and optional `PreparedDocFormula[]`. Its options contain only
`limits` and `signal`; it returns the same bytes/page-count/MediaBox/duration
shape as the Sheet renderer. Doc and Sheet calls share one native-operation lock.

Stored page width, height and margins are preserved, including fractional values
and explicit zero margins. Missing dimensions fall back individually to exact
A4 portrait (210 × 297 mm); missing margins to 12.7 mm. Continuous/modern Docs
receive this finite print geometry. Authored page breaks remain explicit, while
`renderedPageBreaks` marks stay soft. Paper is white.

Native public layout shapes the complete model in bounded virtual pages before
physical pagination. This avoids its ordinary-page clamp on oversized table rows.
Physical source slices are contiguous, preserve explicit native breaks and avoid
text ink, ordinary rows, merged regions and paragraph keep groups when they fit
an empty page. Tall rows, merged cells and images continue in the same coordinate
system, without independent scaling or omitted late content. Saved minimum/exact
row heights must survive native layout; clipped text or an oversized plan fails.

Native output page canvases use ceiling integer points. A narrowly validated
incremental page-dictionary update restores the exact stored MediaBox without
rewriting streams. The drawing origin accounts for the native rounding excess.
Unexpected backend PDF structure fails explicitly instead of rounding silently.

Heading and named character/paragraph styles, rich text, nested lists and their
generated markers use the prepared licensed faces. Source coverage, actual ink
bounds and per-face glyph coverage must pass before PDF bytes can be returned.
Raster drawings use only supplied bytes and the public native placement model,
including admitted rectangular crops, opacity, rotation and flips. Modern Docs'
implicit paragraph spacing is materialized before finite page normalization.

Each prepared Formula entry identifies a whole-entity `CUSTOM` range by `rangeId`.
The result is a scalar (`string | number | boolean | null`), a rectangular array
or table of those values, or `{ kind: 'unavailable' }`. Optional column widths
are positive layout-pixel widths within the content width. Arrays and tables
become complete ordinary native tables with wrapping and pagination. They never
use the live editor adapter's atomic-table size limit. Source expressions and
range properties are removed from the owned model; unavailable results contain
the fixed word **Unavailable**, with no source name, identity or explanation.
Every Formula custom range requires an explicit prepared result. Nothing is evaluated.
Native hyperlink text retains its light-paper blue/underline appearance, rich
text and authored text-color/style modes. Its destination and annotation metadata
are removed before layout; the PDF contains the readable link text rather than
an active external action. Hyperlink and Formula ranges may coexist without
retaining either private source annotation. Overlapping or malformed ranges fail.
Scalar and unavailable results can appear inside native table cells. Array/table
results nested inside a native table currently fail explicitly: guessing the
cell's auto-fit/span geometry before native layout could clip the generated table.

Doc admission currently rejects nonempty headers/footers/notes, raw OOXML or
custom rendering payloads, unprepared mentions/plugin resources, page
backgrounds/borders, custom text effects and tab leaders, paragraph frames,
heterogeneous section geometry, odd/even section parity, repeated table headers,
wrapped/floating tables, sparse table grids, rotated cell text, column groups,
nonimage/grouped/contour drawings and unsupported floating anchors. These remain
explicit acceptance gaps for SPN-075; ignoring them would change visible content.
Malformed indexes, merges, geometry or unprepared glyphs also fail without bytes.

In particular, top-and-bottom wrapping requires a leading, paragraph-relative
image anchor followed by authored caption text in the same paragraph. Anchor-only,
line-relative, non-leading or multiple-block paragraphs fail explicitly: the
pinned native layout can reserve the image height twice or drift its placement.
The supported captioned case preserves native flow and is covered by the tall
floating-image fixture. The renderer does not add synthetic captions, remove
saved spacing or patch the native engine. Tables must also fit their actual
containing viewport, including nested cells, even when an overflowing area
contains only a background or border. Square wrapping that blocks the entire
containing text column also fails explicitly because native retries can add blank
space; the guard uses actual native column geometry, including nested cells.

Doc limits cover both the original and projected model, generated list/Formula
text, native layout work, repeated drawing across physical slices and all shared
font/image/page/output/time budgets. Complete source admission precedes native
work. The shared cleanup and hard-process-isolation limitations below apply.

## Prepared images

`PreparedImage` contains an opaque native `source` key and `Uint8Array` bytes.
Every required source needs explicit authorized bytes. Neither URL-shaped keys
nor other strings are fetched or passed to a decoder as filenames. PNG, JPEG and
WebP must be static; animations, missing bytes, malformed decoding and unsupported
formats fail. Aggregate header dimensions are admitted before native decoding.
EXIF orientations are normalized from owned bytes, with dimensions and normalized
byte totals checked again.

Sheet floating images support public Position, Both and None anchors, saved z-order,
opacity, source cropping, rotation and flips. A standard single native cell image
uses its saved dimensions, padded aspect fit and alignment; a hidden merge anchor
can still supply the visible merged remainder. Image cells are removed from the
owned native text snapshot after composition so the SDK's URL cache is never
used. Page-spanning objects are drawn in full through the exact page clip.

Worksheet backgrounds cover the finite configured worksheet rectangle, including
background-only sheets, with hidden axes collapsed. This deliberate content
extent is not the editor viewport. Tile phase remains fixed at worksheet zero
across every page; repeated draws at boundaries count against the layout budget.

Explicit unsupported models include grouped, skewed, nonrectangular or extra-scale
drawings, and mixed-text/multiple-image cell documents. They fail without bytes;
this does not permit SPN-075 to drop content or weaken its full export contract.

## Fonts and unsupported rich models

`PreparedFont` supplies static SFNT bytes, exact family/aliases, weight 400/700,
italic state, and license identifier/text/source. Callers attest licensing; the
package checks bounded tables, embedding permissions and Unicode cmap coverage.
Family/style selection and grapheme fallback are explicit and deterministic.
Each selected face has its own native alias, preserving the admitted font even
when the backend parses native style shorthand differently.
Unknown families, missing faces/glyphs and unsupported variable/restricted fonts
fail. No host font or synthetic weight/style fills a missing input.

Unmodified Atkinson Hyperlegible regular/bold/italic/bold-italic and Noto Sans
Symbols 2 fixtures retain OFL licenses and pinned provenance. They exercise Latin
accents, combining text and symbol fallback; they do not prove universal script
support or silently substitute production fonts. Actual shaping remains native
and depends on the supplied licensed faces.

For Sheet rich cells, embedded rich tables, lists/named paragraph styles, generated tab leaders, extra document sections,
document backgrounds, document-level fallback maps, custom render extensions and
document-only glow/shadow/outline/fill/symbol effects require an explicitly
prepared representation and currently fail. Ordinary Sheet rich text is retained.
Nonempty plugin resources other than `SHEET_DRAWING_PLUGIN` and
`SHEET_FILTER_PLUGIN` also fail, including unprepared conditional formatting:
ignoring unknown state could silently change visible output. Empty resource
objects/arrays have no content to omit. SPN-075 must prepare or extend these models
rather than quietly strip their appearance.

## Resource and failure contract

`PRINT_LIMITS` sets conservative package ceilings, **not measured production
capacity**. Callers can lower any limit but cannot raise it. Budgets cover snapshot
bytes/nodes/nesting, worksheets/axes/cells/text, visible grid and merge indexing,
images/encoded bytes/aggregate decoded pixels, fonts/bytes, pages, duration and
final PDF bytes. Formatted display strings share one per-operation character
budget across filter preparation and rendering, including cells later filtered
out; repeated reads of a cell do not charge it twice. Generic `PrintError` codes
are `invalid-input`, `unsupported`, `limit`, `cancelled` and `cleanup`; messages
contain no document names, cell values, source URLs or supplied bytes.

No bytes are streamed or returned after a failed page, cap, cancellation or
cleanup. The final signal/deadline check and reported duration include cleanup.
Tests measure cap failures and cancellation, verify no output, then render
successfully in the same isolated process. This does **not** make a synchronous
native call interruptible. Serialization and orientation normalization can
allocate before final byte checks. Snapshot clones, native raster/layout/font
state and PDF buffers consume memory outside the V8 heap too.

SPN-075 must enforce hard process deadlines and aggregate RSS/admission budgets,
retain admission until cancelled processes terminate, account for concurrent
source/Formula/transfer work, and revalidate all access before releasing bytes.
Small fixture measurements cannot select safe limits for the 2 GB host.

## CI evidence and licenses

CI runs the package in the library partition and retains synthetic PDFs, a PNG
for every reopened page, and resource metrics in `sheet-pdf-evidence` and
`doc-pdf-evidence`. Successful
extraction alone is insufficient: review every page for late content, boundaries,
image bands, fonts, colors, margins and no watermark. Missing artifacts are not a
pass. The implementation record and commit-anchored PR review identify the actual
validated head, results and remaining integration boundaries.

This package's source is Apache-2.0 (`LICENSE`). Runtime dependencies preserve
their distributed notices: Univer core/engine-render/sheets-filter are Apache-2.0,
Canvas is MIT, and Sharp is Apache-2.0 with its bundled native dependency notices.
No upstream source is copied or private SDK behavior patched. Fixture-font OFL
texts and copyright notices remain beside their original files.
