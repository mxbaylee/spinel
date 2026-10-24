# @spinel/print

Private, in-progress standalone Sheet PDF package (SPN-101). There is **no PDF
renderer yet**. The current checkpoint admits a bounded native workbook and
plans continuous page slices; it must not be integrated as a successful export.

The package owns no users, database, HTTP client, credentials or authorization.
The future renderer will receive an already authorized public `IWorkbookData`
and explicit image bytes keyed by opaque source references. It must never fetch
those references. SPN-075 owns fresh authorization, prepared sources, admission,
an isolated process and hard termination; SPN-102 owns Docs.

## Current geometry contract

`preflightSheets(snapshot, options)` validates a bounded plain-data tree before
native allocation. It returns visible worksheets in workbook order, collapsed
hidden-axis coordinates and occupied cell/merge bounds. Explicit selection is a
set; duplicates, unknown IDs and a selection without visible sheets fail. Cells
and merges outside declared axes fail. Supplied workbook objects are not mutated.
Axes use the public Univer 1.1.0 defaults (1000 rows, 20 columns, 24/88 layout
pixels), custom dimensions and saved automatic row heights. Metadata-only cells
do not expand the bounds. Explicit cell formatting does; row/column formatting
applies within the eventual used range. This public preflight is a first admission
stage; final text overflow and rich-cell image extents remain unfinished.

An internal public-API `PrintWorksheet` adapter now handles number-format display
and native saved filter models. It preserves raw values, validates filter scans
and clones input before the SDK fills defaults. The internal `prepareSheetLayout`
stage applies saved filters to an owned snapshot, then measures collapsed axes
using the original shared deadline. Number-format display still needs the final
native rendering bridge; this code has not run locally.

That internal stage combines occupied cells/merges with axis-aligned floating
image bounds. It interprets the public Position (one-cell/fixed size), Both
(two-cell) and None (absolute) anchors, keeps saved z-order, and binds required
sources only to explicit prepared bytes. A background covers the finite declared
worksheet rectangle, with its tile origin fixed at worksheet `(0, 0)` across
hidden axes and continuation pages. Aggregate grid and page limits precede image
metadata inspection; tile work is also bounded before a plan is returned. Each
page retains the full image destination plus a normalized source crop, so a tall
image is not independently squeezed into each page. This is geometry, not proof
that a native compositor draws those pixels correctly.

The stage deliberately remains internal, outside `index.ts`. It rejects visible
cell drawings (including hidden anchors until merge-aware layout exists),
grouped/transformed/cropped or nonrectangular floating drawings
until their native layout/composition is implemented. Hidden or unselected
worksheet images and explicitly hidden/zero-area drawings need no prepared bytes.
These temporary failures do not satisfy the ticket's complete image requirement.
Text overflow can still enlarge the final used range; the current plan cannot be
treated as a finished export or used to publish partial PDF bytes.

`paginateSheet` consumes final bounds and **actual** PDF MediaBox dimensions.
Margins are 36 pt (12.7 mm), scaling is at most 0.75 PDF pt per 96-DPI layout
pixel, and every vertical slice touches the next without rounding to row edges.
Tall cells, merges and images therefore have continuous slices, but rendering
them correctly in every slice still requires native integration and PDF proof.
Empty visible sheets have one blank page without surplus grid.

Limits are conservative admission ceilings, not measured production capacity.
Callers may lower them. They cover snapshot data/nesting, worksheet axes,
populated cells, merges and visible grid work now; image, output and elapsed
native-work enforcement remain to be connected. Cancellation/time checks cannot
interrupt synchronous native code. A host must kill an isolated renderer for a
hard timeout or process-memory cap. The existing feasibility probe's small RSS
does not demonstrate safety on a 2 GiB deployment.

## Work still required

- Internal prepared-image admission now copies bounded raster bytes and checks
  actual PNG/JPEG/WebP metadata and aggregate pixel counts before decode. Its
  source tests are unrun; full decoding, animation fixtures, transformed/cell
  image geometry and byte-only rendering remain unfinished. Axis-aligned floating
  and finite background layout now have authored, unexecuted integration tests.
- Native number formatting, rich text, fonts, overflow and complete page-spanning
  cell/merge/image rendering; licensed font faces and missing-glyph behavior.
- Atomic PDF output, actual A4 MediaBox choice, output/resource failure evidence.
- Native rendering runtime dependencies and independently checked package/Docker
  installation, plus retained rendered PDF/PNG artifacts for every page. Initial
  workspace/lockfile/Docker source registration is present, not installation proof.

The source tests in this checkpoint were authored but have not run. No visual,
PDF, resource-limit or CI validation is claimed.

## Prepared font contract

`PreparedFont` carries static SFNT bytes, exact family/aliases, weight/italic
metadata and license/provenance supplied by the caller. Internal admission checks
bounded font tables, subset embedding permissions and Unicode cmap coverage.
Grapheme runs use explicitly ordered fallbacks; missing families, styles or
glyphs fail without leaking text into error messages. System fonts are not an
acceptable fallback. Registration, native shaping and embedded PDF-font evidence
remain unfinished. The included licensed fixture faces test these requirements;
they do not silently replace a workbook's requested family.
