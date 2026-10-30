# Copy, import, export and PDF

## Make a copy

Choose **Make a copy** in the native Doc/Sheet toolbar (its overflow on narrower
desktop windows, or **More** on phones), or **Make a copy…** in a file row's menu.
The editor opens its own native dialog/phone drawer; copying adds no button to
Spinel's outer Share/collaborator header. Enter the name and folder together.
The default name is `<name> (copy)`, placed in the current owned folder or My files.
The copy opens after success. Changes must be confirmed and the editor connected;
unfinished cell/text/Formula input, image uploads and recovery block submission.

An authorized everyday account can copy with read access, including a Viewer or
File admin. Guests and Operators cannot. A shared source defaults to the copying
account's My files. An explicit editable shared-folder destination owns the new
file according to that folder and records the copier as creator (SPN-069).
Authorized internal Space Docs/Sheets can become standalone copies; whole Spaces
and folders cannot be duplicated.

The copy retains current confirmed native content, saved icon/color and applicable
cover appearance. Images and uploaded covers have independently authorized bytes;
revoking the source does not break them. Formula definitions and deliberate source
bindings remain, with no cached values or new source grants. Each viewer's current
access governs evaluation. History, named versions, tags, source grants and guest
links are excluded; destination folder access still applies.

Content and image budgets match native import: 10 MiB content, 5 MiB per image,
50 MiB images total, and the existing layout/geometry limits below. Copying reads
stored image bytes directly and therefore does not impose the portable export's
20 MiB envelope. Covers retain the existing 16 MiB item/100 MiB owner budgets.
After asynchronous preparation, one transaction rechecks the session, exact
source/destination authority, confirmed revision, restore generation, appearance
and destination ownership, then publishes the new identity and all assets together.
An intervening edit or restore refuses the copy with a retry message; no partial
item is visible. See [SPN-065 decisions](implementation/SPN-065.md).

Native phone drawers can be dismissed while a request finishes. The addon retains
the completed result, announces it, and offers **Open copy** when reopened without
resubmitting. It never automatically leaves newly unsaved or disconnected work.

## Native file transfer

In a Sheet or Doc, open **Export → Download Univer file** after changes are saved.
This downloads the current collaboration content as native Univer JSON. It includes
Sheet and Doc images as embedded PNG, JPEG or WebP data URLs, so a copy does not depend
on private URLs on this instance. Named versions, sharing and ownership are not
part of an individual file. Use the owned archive below for all your files, or the
Operator's backup for server recovery.

Open an owned folder (or My files) and choose **Import file**, or drop one
file anywhere in its file pane. A `.json` or `.univer` file becomes a new item owned
by you in that folder. Import never replaces an existing item. PDF, Office and CSV
uploads are refused. Optional CSV import is post-launch SPN-093; optional format
and document-type plugins are post-launch SPN-094. The built-in Office import/export proposal
SPN-035 was retired at the owner's request on 2026-10-21. An installer could add
Office conversion through a plugin; core Office support is not promised.
SPN-094 also covers extension points for new document kinds such as slides or
kanban boards. It supplies a plugin foundation and reference examples, not those
complete editors; core Sheets and Docs and native backup/import remain supported.

**Planned CSV semantics (SPN-093):** preserve UTF-8 fields literally, including
leading zeros, empty values, quoted content and the first row as data. Do not
infer formulas, dates, numbers or headers. Future typing options require a
separate decision; the initial importer reuses existing creation/access/cleanup
and resource limits. This remains backlog acceptance, not current import
support. Decided 2026-10-21 in
[decision #130](implementation/SPN-093.md#legacy-decision-130-literal-bounded-csv-import).

Files are capped at 20 MiB, including embedded images. Native content after image
extraction must fit the existing 10 MiB save limit. Images must be static PNG,
JPEG or WebP, at most 5 MiB and 16 megapixels each, with a 50 MiB total per document.
Metadata is stripped when necessary; already sanitized image bytes are preserved.
Only embedded images are imported: Spinel does not fetch remote URLs. Sheet floating,
cell and background images use the same item-scoped stored bytes as Doc images.
Existing images render in live Sheets and isolated history previews; new Sheet
image upload/paste insertion remains unavailable. Imports, saves and restores
validate same-item image sources. Embedded cell Doc identities remain separate
from workbook IDs. The server accepts an image cell in each mutation that carries
cell data (set values, move range, insert sheet); the browser flows for cut/paste
and duplicating a sheet have no end-to-end test yet. Viewers and link guests retain read-only drawing controls,
including images that finish loading after permissions are applied; revoking
access prevents subsequent image reads.
Decisions [#89](implementation/SPN-039.md#legacy-decision-89-preserve-existing-sheet-images) and
[#91](implementation/SPN-039.md#legacy-decision-91-offline-prerequisites-without-partial-completion), 2026-10-18/19, supply the
existing-image prerequisite for offline documents ([docs/offline.md](offline.md)).
Unknown plugin resources are preserved without interpreting them.

Import also bounds editor expansion: at most 100 sheets, each with 100,000 rows
and 1,024 columns, and totals of 250,000 rows, 4,096 columns and 100,000 populated
cells per file. Cell, row, column and merge indexes must fit the declared sheets.
A document body is limited to one million characters and its layout indexes must
fit the text. These are import budgets for the small instance, not measured Univer
capacity limits. JSON is limited to 64 nesting levels and 200,000 values.
Oversized or invalid files are refused without creating a partial item. Export
uses the same layout budgets so a successful native download remains importable;
it never truncates an oversized file. Decisions [#69](implementation/SPN-031.md#legacy-decision-69-bounded-native-file-transfer)
and [#23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming), 2026-10-17/18.

## Export as PDF

After changes are saved, accounts choose **Document actions → Export → PDF**.
Guests use the labelled **Export as PDF** action beside their read/edit status.
Owners, collaborators, account viewers and view/edit guests download the same
watermark-free PDF under their current read access. There is no Spinel Print
action or browser print dialog. Native JSON remains account-only; PDF is a
read-only copy, not an editable backup.

Sheets default to every visible worksheet in workbook order and offer a subset.
Hidden sheets, rows and columns are omitted. Used ranges include image extents;
wide ranges shrink to one A4 portrait page across without enlargement and continue
vertically. Margins are 12.7 mm. Docs retain stored page dimensions, margins and
explicit breaks, with A4/12.7 mm fallback when absent. Paper stays light in every
theme. See [pagination decisions](implementation/SPN-075.md#legacy-decision-106-deterministic-pdf-pagination).

The server loads confirmed collaboration content and recalculates Sheet formulas.
Doc Formula values and complete tables are evaluated under the requesting reader's
current permissions. An unavailable source replaces the whole Formula with the
neutral word **Unavailable**, with no source name, expression, account identity or
partial aggregate. Host/session/link loss aborts generation. Source loss after
rendering discards every old PDF byte and rebuilds once with the whole Formula
unavailable; another change fails with a retry message. Every image and exact
Space-child scope is revalidated immediately before download. Copies already
downloaded cannot be recalled.

Rendering uses the public [`@spinel/print` API](../lib/print/README.md) in one
disposable Node process, with prepared images and bundled licensed fonts. The
worker receives no credentials or network URLs to fetch. Liberation Sans/Serif/Mono
provide documented substitutes for Arial/Times New Roman/Courier New; other known
family aliases follow the [runtime font policy](../src/server/pdf/fonts/README.md).
Native layout recalculates using these fonts; unsupported glyphs or appearance
models fail the whole export rather than hiding content. Imported plugin models
outside the renderer's supported public model also fail explicitly.

The shared transfer reservation spans preparation, isolated work and response
completion; native work also serializes against Formula calculations. Snapshot,
image, page, output, wall-time and sampled native RSS limits apply. Cancellation
terminates the child and waits for its close before releasing capacity. A resource
or formatting failure downloads no partial file. Limits and their operational
tradeoffs are recorded in [SPN-075](implementation/SPN-075.md#production-integration-and-atomic-authorization).

Printing and collaboration now use open-source/native paths. SPN-059 removed the
remaining Pro dependencies and added the repository-wide no-Pro check
(`npm run dependencies:check`). This supersedes
[the licensed printing flow](implementation/SPN-031.md#legacy-decision-70-original-browser-printing)
and implements [direct PDF for every current reader](implementation/SPN-075.md#legacy-decision-103-direct-pdf-for-every-current-reader).

Native downloads require current read access. Import requires an everyday
account and an owned destination folder. Operators and signed-out visitors cannot use these
routes; a link does not grant dashboard access. Session/access is checked again
after asynchronous work. Transfers are serialized, including parsing, image
decoding and response delivery, to bound memory on the 2 GB server. A disconnected
client does not release admission until its in-progress work finishes. A busy
transfer returns a retry message. New-item publication, native content and images
commit together or roll back together.

Verification includes native snapshot and image-byte round trips, malformed and
oversized input rejection, HTTP auth/CSRF and aborted-transfer admission checks,
and browser downloads/imports of live edits. PDF browser tests download actual
server output, reopen every page, assert late content and privacy, and retain the
PDF plus all-page PNG evidence. Native worker and access tests cover formula-source
revocation, host/session/link loss, exact child scope, cancellation and resource
failures. No Pro license or browser print call participates in these downloads.

## Export all my files

At the root of **My files**, choose **More → Export all my files** and confirm.
Spinel streams a ZIP to the browser while one dialog shows file progress,
cancellation, completion or a retryable error. Completion means the archive was
sent to the browser; check the browser's downloads for its saved file.

The archive contains only live items you own: folders (including empty folders),
Sheets, Docs and whole Spaces with their internal tree and sibling positions.
Files shared with you, personal placements of other people's files, Trash,
history, named versions, grants and guest links are excluded. An owned file
that you have shared with someone else is still included. Everyday File admins
use the same owned-only boundary; Operators and link guests cannot use archives.

Each document uses the same native Univer content and embedded raster images as
**Download Univer file**. A versioned `spinel-manifest.json` records exact names,
original dates, identity and tree structure. ZIP path components use safe names
and disambiguating IDs so duplicate names and platform-special characters do not
overwrite one another. Space children remain inside their original Space rather
than becoming independently shared files. Formulas contain definitions only,
never cached results.

Import the `.zip` through **New → Import file**, or drop it into the root of
**My files**. Spinel validates every member before publishing the complete tree
in one transaction. It creates new items owned by the importing account, with
new IDs and creation dates, leaving the original dates in the archive manifest.
Existing items are never replaced. Formula references to included Sheets map to
their new IDs; external or missing sources stay unavailable, even if an unrelated
destination item happens to have the original ID. No sharing settings transfer.

The same native file, image and structural limits apply to each member. Archives
allow at most 10,000 items, an 8 MiB manifest and 8 GiB of compressed and expanded
data. Export processes one native file at a time under download backpressure;
the browser does not build a whole-archive Blob. One pending or running export is
allowed per account, and archive work shares the process-wide native-transfer
admission. Pending tasks expire after 15 minutes; active transfers have a one-hour
deadline. Revocation, cancellation and disconnects stop further work, but admission
remains held until in-flight processing has settled.
The HTTP server keeps a one-minute header timeout and five-minute ordinary body
deadline; only an authenticated, admitted archive upload receives the longer
body window, so large uploads are not cut off by Node's default five-minute cap.

Imports stage privately beside `DATABASE_PATH` on the encrypted writable data
volume, because production `/tmp` is a 16 MiB tmpfs. The upload is capped at 8 GiB
and its staging database at 9 GiB, with free-space checks reserving additional
room for the destination database and transaction WAL plus a 64 MiB floor.
These are disk limits, not memory reservations. A small archive needs space
proportional to its declared expanded size and staging database. Temporary files
are removed on success, rejection and cancellation; abandoned import directories
older than two hours are reclaimed when the next archive import starts. The
Operator can reclaim those private directories while Spinel is stopped. The
production app's 512 MiB memory limit remains unchanged.

A validation rejection adds no files. If the browser loses the final response,
the import is reported as unconfirmed: refresh My files before trying again,
because the transaction may already have committed. This archive is independent
of Operator disaster-recovery backups and does not restore history. CSV, format
plugins and PDF retain their separate ticket scopes. See the
[SPN-067 decision record](implementation/SPN-067.md).

## Doc formulas in files

[Live formulas](formulas.md) store expressions and bindings, never calculated
results. Native imports detach source-bound formulas into ordinary expression
text; source-free formulas remain active. PDF export renders freshly authorized
values and complete tables, including the 30-row Formula result;
SPN-094 retains the same source-access boundary for optional format plugins,
and owned workspace archives use the deliberate reference remapping described above.
