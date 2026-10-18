# Documents

The document editor uses the open-source Univer Docs core, drawing and hyperlink
packages. Headings, lists, links, basic tables and uploaded images are saved as
native Univer snapshots in SQLite. Enhanced Pro table features, embedded sheets
and simultaneous editing are outside SPN-008. Shape insertion controls are hidden
because their inline SVG sources do not satisfy the stored-image contract.

Documents share the spreadsheet autosave controller and transactional revision
checks. Each save carries the loaded revision and a unique write ID. An exact
retry after a lost response is safe; stale writers receive a visible conflict
instead of overwriting newer work. Snapshots are limited to 10 MiB. Correcting a
server-rejected invalid or oversized snapshot allows saving to resume; uncertain
network responses still retry the exact original write before newer changes. Network
failures keep changes in the open editor, show an unsaved warning and retry when
connectivity returns. Navigation warns about pending changes. This is not a
durable offline queue: keep the tab open until saving succeeds.

## Images

Insert a local PNG, JPEG or static WebP file. The server fully decodes and
normalizes the image, strips metadata, and rejects unsupported or corrupt data,
files over 5 MiB, images over 16 megapixels, and normalized results over 5 MiB.
There are at most two concurrent decoder jobs per server process. Each document
has a 50 MiB stored-image allowance, with duplicate normalized bytes counted
once. An upload or insertion failure is shown in the editor; insert the file again to
retry. The editor remains dirty through upload, image dimension loading and the
final drawing insertion, so navigation cannot silently discard an uploaded image.

Images live as SQLite blobs scoped to their document, alongside its snapshot.
Image reads require an active non-admin session with read access; uploads require
owner/editor access and the configured Origin. See [sharing](sharing.md). Image responses are private, uncached and marked
`nosniff`. Snapshots may reference only that document's existing image URLs;
external and base64 drawing sources are rejected. Link destinations remain
ordinary hyperlinks, separate from image sources.

Removing an image from the live document keeps its stored bytes so undo and
pending snapshot retries can still restore it. Deleting the document record
cascades to its images and snapshot. A future history/pruning feature must check
all retained versions before deleting image bytes. This limit therefore includes
images removed from the visible document, and its error states that the document
has reached its image allowance.

These choices were recorded in [decision #21](https://github.com/mxbaylee/spinel/issues/21)
on 2026-10-17. The Operator gets bounded decoding and one encrypted SQLite storage
location; the Owner keeps images with the document; the Collaborator gets the
same visible save/conflict behavior as sheets; the Link guest gains no access
through an unprotected image URL. Current sharing permissions are described in [sharing](sharing.md).

## Verification

Store and HTTP tests cover image decoding, byte/pixel/document limits, native
snapshot preservation, retry/conflict behavior, document-scoped reads, owner and
admin boundaries, CSRF protection, and deletion cascades. The browser test creates
headings, a list, a hyperlink, a populated table and an uploaded image through the
editor, then compares their saved structures after reload and checks offline
warnings, navigation protection and recovery. A delayed image-read test verifies
navigation protection lasts beyond upload completion, and the slash menu test
checks that unsupported shape controls stay hidden.
