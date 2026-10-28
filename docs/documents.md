# Documents

The document editor uses the open-source Univer Docs core, drawing and hyperlink
packages. Headings, lists, links, basic tables and uploaded images are saved as
native Univer snapshots in SQLite. Enhanced Pro table features, embedded sheets
and simultaneous editing are outside SPN-008. Shape insertion controls are hidden
because their inline SVG sources do not satisfy the stored-image contract.

Documents use Spinel's native mutation sync client and durable revision receipts
([collaboration](collaboration.md)). Explicitly downloaded Docs additionally
persist that same queue and confirmed snapshot to IndexedDB (SPN-053). **Saved
on this device** means the local transaction committed; **Synced** also requires
durable server acknowledgement and local cleanup. Offline reopening reconstructs
the native document before capture resumes. A changed live revision, generation
or grant retains local work as **Needs attention**, without overwriting the
server. Undownloaded editors retain their existing in-memory queue and must stay
open until saving succeeds. Active input and failed local persistence retain the
navigation warning. See [offline editing](offline.md#how-offline-editing-works).

Doc Formula definitions remain authored content; calculated source values never
enter the offline checkpoint. Offline results are unavailable, and every source,
resolve and evaluation request rechecks the downloading account and epoch as well
as the server's source-access policy. Pending Formula responses cannot publish
after that account scope ends. A connection change clears live previews but keeps
an unfinished Formula expression and format in the open dialog; that draft also
prevents automatic replacement of an otherwise clean cached document.

## Sustained typing and undo

Docs apply edits locally while the existing sync client sends them in the
background. Native history and collaboration composition are separate browser
work: Spinel closes a pending native group at 32 completed state changes so an
uninterrupted typing session cannot grow one unbounded composition batch. An owned
visible-frame check applies the same 300 ms quiet interval when native timers
are delayed. It stops when queues empty or the document becomes hidden, and is
cancelled on access loss or disposal. Native timers, segment-switch, undo and
IME boundaries remain in place.
A completed composition stays atomic. Undo/redo retains native content and caret
endpoints; long uninterrupted input intentionally becomes several useful chunks.
Docs configure the supported native history limit to 100 groups, so the original
2,086-input workload has room for all 66 capacity-only chunks and additional idle
boundaries. Acceptance replays every actual group; a slower local diagnostic
formed 73. Native eviction
still bounds the group count; it is not a byte limit or a promise of unlimited
undo. Sheets keep their existing setting. The existing safety policy that
invalidates stale local history after a peer edit remains in place.

This uses public queue/flush APIs and does not replace saving, grant access,
or clear history to hide work. Native cursor ranges now own and cancel their
hide/blink callbacks; native zoom controllers cancel superseded updates and
dispose their pending work. This uses a narrow, version/hash-checked temporary
OSS Docs UI repair, with [SPN-114](todo/SPN-114.md) tracking its removal after a
suitable upstream release. The [callback lifetime contract and evidence](implementation/SPN-113.md)
preserve normal blinking, zoom, selection and editor cleanup. The
[measurement contract and evidence](implementation/SPN-108.md) preserve the
original per-character reproducer, before/after profiles, desktop/mobile
emulation boundaries and independent-review rubric. A successful Save status
does not by itself establish that native history work has finished.

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
cascades to its images, live snapshot and [history](history.md). Retained versions
continue to reference the stored images. Any future image garbage collector must
check retained versions and pending uploads before deleting bytes. This limit includes
images removed from the visible document, and its error states that the document
has reached its image allowance.

These choices were recorded in [decision #21](implementation/SPN-008.md#legacy-decision-21-native-doc-snapshots-and-embedded-images)
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
