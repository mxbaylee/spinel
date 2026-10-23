# Import, export and PDF

In a Sheet or Doc, open **Export → Download Univer file** after changes are saved.
This downloads the current collaboration content as native Univer JSON. It includes
Sheet and Doc images as embedded PNG, JPEG or WebP data URLs, so a copy does not depend
on private URLs on this instance. Named versions, sharing and ownership are not
part of an individual file; use the operator backup for the whole workspace.

Open an owned folder (or My files) and choose **Import Univer file**, or drop one
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

Today, for an account read-only copy choose **Print / save PDF**, adjust Univer's
print options if shown, and choose **Save as PDF** in the browser print dialog. Spinel uses the
public Univer Pro print plugins as supplied. Printed page limits and watermarks
depend on the installed license; the export panel explains this before printing.
Check the output before sharing. A PDF is not an editable backup, and it may not
include every page under the current license. Decision
[#70](implementation/SPN-031.md#legacy-decision-70-original-browser-printing), 2026-10-18.

**Planned in SPN-075:** replace that flow with **Export as PDF**, a direct
PDF download with complete pages and no watermark. It will be available to
anyone with current read access: owners, collaborators, account viewers and
view-only or editing link guests. There will be no Spinel Print action or
browser print dialog. Guest output must not add owner/account identity; revoked
access must prevent a new export. PDF is the exception to account-only native
and Office exports, not permission to download those formats. This consolidates
retired SPN-073; owner, chat 2026-10-20, decision [#103](implementation/SPN-075.md#legacy-decision-103-direct-pdf-for-every-current-reader).
Pagination defaults are recorded in decision [#106](implementation/SPN-075.md#legacy-decision-106-deterministic-pdf-pagination).
Until SPN-075 lands, the limitations and
account-only UI described above still apply.

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
and browser downloads/imports of live edits. Browser tests capture the native
print output at the browser print call, generate a PDF, reopen and render it, and
retain PDF/PNG evidence in CI. They do not override license checks or print pages
the plugin did not produce.

## Doc formulas in files

[Live formulas](formulas.md) store expressions and bindings, never calculated
results. Native imports detach source-bound formulas into ordinary expression
text; source-free formulas remain active. Current printing uses unavailable
formula output. SPN-075 will render freshly authorized values/tables in PDFs;
SPN-094 retains the same source-access boundary for optional format plugins,
and SPN-067 handles archive reference remapping.
