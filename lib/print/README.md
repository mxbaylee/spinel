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
applies within the eventual used range. Text overflow, filtered rows and image
extent integration remain unfinished.

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
  source tests are unrun; full decoding, animation fixtures, native
  floating/cell/background geometry and byte-only rendering remain unfinished.
- Native number formatting, rich text, fonts, overflow and complete page-spanning
  cell/merge/image rendering; licensed font faces and missing-glyph behavior.
- Atomic PDF output, actual A4 MediaBox choice, output/resource failure evidence.
- Native rendering runtime dependencies and independently checked package/Docker
  installation, plus retained rendered PDF/PNG artifacts for every page. Initial
  workspace/lockfile/Docker source registration is present, not installation proof.

The source tests in this checkpoint were authored but have not run. No visual,
PDF, resource-limit or CI validation is claimed.
