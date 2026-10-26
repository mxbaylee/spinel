# @spinel/print

Private standalone Sheet and Doc PDF renderer. Public Univer 1.1.0 layout and drawing run
against the native `@napi-rs/canvas` PDF backend. The package owns no user identity,
database, HTTP client, cookies, credentials or source evaluation. It imports no
Spinel application code and uses no Pro packages or browser Print.

SPN-101 supplies the Sheet renderer; SPN-102 extends it for Docs. The SPN-075
[application adapter](../../src/server/pdf) supplies current authorized snapshots,
prepared sources, final access revalidation, process isolation/admission and the
download UI. This standalone package owns the rendering contract.

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

`selectDocImageSources(snapshot, { limits, signal })` and
`selectSheetImageSources(snapshot, { worksheetIds, limits, signal })` return opaque
image references for host-side byte preparation. Docs reuse the renderer's
story selection and suppress hidden group descendants. Sheets share filter-applied
geometry, merged-cell visibility, floating anchors and group ancestry with the
renderer. Both preserve the caller's snapshot and perform no native layout. Hosts
still authorize each returned reference before reading it and validate the
integrity of their complete saved document. The renderer repeats its own source
and appearance admission; selection does not certify a document as renderable.
Saved filter-row caches are authoritative. If an uncached filter may depend on
formula values or range-theme styles that still need isolated preparation, Sheet
selection conservatively retains those rows' image references until the renderer
has the prepared values. Those possible sources remain subject to the byte budget.
Uncached wildcard filters use native-compatible literal, star and question-mark
matching with explicit work accounting, rather than a backtracking regular
expression on the host. All criteria and rows in a worksheet share at most four
times `gridCells` matching steps, including pattern preparation and suffix
retries; existing cancellation/deadline checkpoints run during long matches.
Exhaustion refuses the complete export. Saved caches keep their native precedence.

The single public entry loads only metadata code until a render function is
called. Native loading happens synchronously at that call so the existing input
ownership and shared operation lock still precede any asynchronous yield. This
lets the application select bytes without loading Canvas or initializing fonts
outside its isolated worker. A separate-process module-hook test verifies the
boundary and first-call ownership, overlap rejection and successful cleanup.

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
- Ordinary rows break at their visible native edges, so a page seam does not
  bisect text that fits its row. Fitting merged cells and image footprints move
  to the following page together when their combined row footprint fits. Hidden
  rows retain their raw indices with zero extent. Tall rows, merged cells,
  overlapping object groups and images keep one worksheet coordinate system
  across contiguous vertical slices when a whole region exceeds a page. Cache
  queries expand outward across fractional seams; PDF clips retain exact adjacent
  edges. Content is not independently squeezed or restarted on each page.
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

Uniform body documents use complete native layout in bounded virtual pages before
physical pagination. Documents with header/footer stories, section columns or
varying page geometry use native physical flow, including continuous, next-column,
next-page and odd/even section starts. The exact public range emitted by the
editor's column-break command survives Formula replacement and pagination.

Oversized tables and image paragraphs are shaped completely at their actual
containing width. Contiguous source bands are placed through empty public native
table-row reservations, so section flow and each page's header/footer reservation
determine their destination. Only the original source paints those bands; the
reservation rows have no visible output. Glyph ink, ordinary rows, merged regions
and paragraph keep groups remain together when they fit. Tall cells, nested
tables, drawings and saved blank row space retain one source coordinate system
across continuations, without independent scaling. Original-source coverage and
the remaining body projection are checked separately. Saved minimum/exact row
heights, image area and destination body bounds must survive the complete plan.
Exact native reservations also respect the first table page's row-height ceiling
when later pages select shorter headers and provide more body space.

Default, first-page and even-page header/footer stories repeat on their selected
physical pages, with native tables, rich text and prepared images. PAGE and
NUMPAGES fields use the final page plan; DATE/TIME fields retain prepared saved
text. Unknown field types or unprepared custom results fail. Story IDs are scoped
to effective section geometry in the owned model so the native width-only cache
cannot reuse another section's margins. Disconnected story definitions do not
request fonts or image bytes. Reused story drawings receive independent private
identities for layout while sharing the same prepared source bytes. Projected
story copies are admitted before allocation. The caller's snapshot remains unchanged.

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
Native incremental layout waits for its bundled hyphenation dictionaries. When
native wrapping appends a generated hyphen beyond a cell or column edge, only
that paragraph reserves the measured dash advance through its public end indent
and is laid out again. Authored dashes, runs, spacing, cell widths and strict ink
checks remain intact; cold and repeated renders are checked against the same
native reservation reference.

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
Scalar, unavailable, array and table results can appear inside native table cells.
Default result tables use the public percentage-width model, resolved by native
layout against the actual cell or column viewport, including spans and margins.
Explicit prepared widths stay exact and must fit that final viewport even when
an overflowing area contains only blank cells, background or borders.

Doc admission currently rejects nonempty notes, raw OOXML or
custom rendering payloads, unprepared mentions/plugin resources, page
backgrounds/borders, custom text effects and tab leaders, paragraph frames,
repeated table headers, wrapped/floating tables, sparse table grids, rotated cell
text, embedded column-group blocks,
nonimage/contour drawings and unsupported imported floating anchors. These remain
explicit unsupported source models; active editor models retain the SPN-075
complete-content contract. Ignoring unsupported payloads would change visible content.
Malformed indexes, merges, geometry or unprepared glyphs also fail without bytes.

Top-and-bottom wrapping supports paragraph-relative images with authored text
before the anchor and a caption after it, or an otherwise empty image paragraph.
Native caption flow preserves the prefix above the image and the caption below
it. The pinned Traditional layout places an image-only anchor below its own
image, then reserves that height a second time. For that exact source shape, a
first public native layout measures the original paragraph strut with a
non-wrapping positioned image. The owned public model reserves the larger of
that strut and the image's complete lower extent, including its bottom wrap
distance, through the existing paragraph's line height. A second complete native
layout retains the image transform and before/after spacing; relative spacing is
resolved against the original strut before its image reservation grows. Small
images and larger authored line heights retain their original flow.

The same measured reservation handles an empty LINE-relative image paragraph
and an empty Square image paragraph whose wrap rectangle covers both edges of
its actual native column. A full-column Square image with authored paragraph
text uses the same measured image origin and native Top-and-bottom exclusion:
only its existing zero-width image control moves to the paragraph's start, while
all visible prefix/suffix text keeps its order, styling and prepared field ranges.
The paragraph length and terminator stay unchanged. Relative before-spacing is
resolved against the original native strut, and final after-spacing is checked
on the actual last paragraph line. Narrow Square images keep native side wrapping
after measurement. These projections admit ordinary near-column-width images
with small left/right wrap distances without allowing native retries to displace
preceding paragraphs repeatedly.

Captioned LINE references retain their first native layout for measurement.
The zero-offset case uses the actual separate source anchor line, correcting a
pinned native stale-line origin. Nonzero offsets preserve the measured image
position, including negative compensation written by the editor when changing
positioning references. The owned model then uses an equivalent paragraph anchor
and, where necessary, a measured page-relative horizontal coordinate. Final
geometry must retain the origin, dimensions, rotation and after-spacing and
must not overlap authored text. Both native passes share one work/deadline
budget. No visible text or captions are added, every remapped position retains
its authored character/style mapping, and the SDK is not patched.

Same-paragraph multi-file inserts retain all image controls and visible text.
A Top-and-bottom image followed by an inline image uses native mixed flow;
multiple Top-and-bottom controls followed by real caption text use their native
stacked block lines, including styled prefixes and interleaved text. An otherwise
empty group gets one measured paragraph reservation with cumulative image
positions in source order. When visible text precedes a terminal floating image
without a caption, that existing control receives an equivalent full-line inline
layout box through public effect extents. If an inline control immediately
precedes it, the native engine merges adjacent inline controls, so the existing
line instead receives measured extra descent and the terminal image keeps an
equivalent positioned origin. Both forms preserve the original dimensions,
rotation, crop and source. The second native pass checks both images' measured
origins and the retained paragraph spacing, including the first inline image's
unchanged ascent and paint.
No paragraph marks or captions are inserted. Independent authored inline
references verify image area, text order and complete output pixels for these
cases. Native list paragraphs keep their visible markers and indentation. Mixed
Top-and-bottom, Square and nonwrapping controls retain their native layering;
inactive stale behind-text flags are removed only for body wrapping modes whose
editor painter ignores them. Negative offsets and top wrap distances retain the
native backward exclusion when a forward-only reservation would change it.
Ordinary Space, Tab and nonbreaking-space spans before, after or between image
controls retain their native line height, tab stops and visible decoration. The
existing measured terminal-control projection completes the final image without
changing any authored text, run or range index. Independent ordinary-inline
references include styled whitespace and tall repeated-header continuations.
Invisible fake-caption controls, unsupported decorated-paragraph projections and
actual text/image collisions still fail explicitly.
Tall captioned and image-only fixtures verify every color-band pixel across
continuations. Gaps established by independent native layout remain intact;
unused font descent on a final ordinary visible-text line cannot add an otherwise
empty page. Authored blank paragraphs, breaks, borders and saved spacing retain
their complete extent. Full-column Square text fixtures match the
equivalent authored native flow pixel for pixel, including rich styling, saved
spacing and repeated-header continuation. Separate fixtures verify prefix/caption
order, saved LINE offsets, relative spacing, small-image pixels and caller
ownership. Tables must also fit their actual containing viewport, including
nested cells, even when an overflowing area contains only a background or border.

Authored nonwrapping images keep their native overlay position and front/behind
order without reserving body flow space. An image taller than its physical body
continues through the actual body clips of subsequent pages, using existing pages
first and appending bounded public page breaks only after all authored content
when more pages are needed. Each band paints the complete original transform
through its verified clip; image area and source-body positions must remain
complete. Synthetic boundary paragraphs use a separate neutral style so document
defaults cannot change the authored tail's spacing or borders, or create extra
pages. Native layout selects first/even/default stories and resolves page
fields again after any appended pages. Every destination must fit the unchanged
horizontal geometry. Color-band, layering and unchanged-text references cover
headers, columns, existing-page reuse and page-limit refusal with recovery.

Numeric Page- and Margin-relative images retain their source coordinate space.
Traditional Docs use finite native pages; ordinary Modern Docs retain continuous
coordinates across physical slices. Modern documents with saved headers, columns
or section geometry use a bounded native equivalence check to map the picture's
actual source location into that retained physical flow. Only the existing
zero-width control and positioning reference are projected; visible glyphs,
image geometry and authored formatting must remain equivalent. An image left
beyond all text after deletions retains its native gap and continues across the
required physical pages. Imported alignment/percentage references with different
native origins remain explicit unsupported models.

Image groups keep one layout anchor and paint their validated hierarchy through
the public native drawing group. Nested local Doc transforms, group base bounds,
rotation, resizing, flips, rectangular crops, opacity and child ordering remain
intact. Actual descendant corners, including rotated ink outside the group's
layout rectangle, determine complete print bounds and continuation clips. Only
active retained groups request prepared leaf bytes. Group nodes, depth, cycles,
source identities and every repeated painting operation share finite admission
and work budgets; no extra flattened bitmap or image fetch is introduced.

Repeated header/footer inline images accept the public editor's validated
`isMultiTransform`/`transforms` presentation cache. Those cached screen/page
positions are removed from the owned model; native repeated-story layout uses
the authoritative `docTransform`, source crop, rotation, flips, opacity and
source ordering. Group children use their authoritative local transforms;
unsupported skewed appearance caches still fail explicitly.

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

Sheet image groups use the same native hierarchy painter. The root follows its
saved cell or absolute anchor; children retain the raw transforms and original
nonzero group base rectangle written by the public grouping command. Their
cached cell anchors are deliberately inactive while grouped. Hidden rows and
columns affect the root's saved anchor without independently shifting its
children. Whole descendant ink participates in used-range sizing and page breaks,
including nested transformed groups and tall contiguous continuations.

Worksheet backgrounds cover the finite configured worksheet rectangle, including
background-only sheets, with hidden axes collapsed. This deliberate content
extent is not the editor viewport. Tile phase remains fixed at worksheet zero
across every page; repeated draws at boundaries count against the layout budget.

Explicit unsupported models include groups with nonimage descendants, skewed,
nonrectangular or extra-scale drawings, and mixed-text/multiple-image cell documents. They fail without bytes;
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

The [SPN-075 runtime](../../src/server/pdf/runner.ts) enforces hard process deadlines
and aggregate RSS/admission budgets, retains admission until cancelled processes
terminate, accounts for concurrent source/Formula/transfer work, and revalidates
access before releasing bytes. Small fixture measurements alone cannot select
safe limits for the 2 GB host.

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
