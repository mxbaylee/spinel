# Sharing

Items are private by default. The owner can choose **Share** on a document or
folder, select Viewer or Editor for an active everyday account, and apply the
change. Give that person the displayed address. They must sign in; the address
alone does not grant access. Admin accounts cannot receive grants or access
workspace content.

Folder grants apply to every descendant, including future additions. Direct and
inherited grants combine using the most generous access: an inherited editor
remains an editor even if the item's direct grant is viewer. The sharing panel
shows both the direct choice and effective access. **No direct access** removes
only that item's grant; remove the ancestor grant too to revoke inherited access.
Moving an item out of a shared folder removes that inheritance immediately.

Viewers can open folders, read document content and load its images. Editors can
also save document content and upload Doc images. Only owners change sharing,
rename, move or [trash](trash.md) items, or create children in their folders. Sharing never changes
ownership or the owner's folder structure. Sheets and Docs use their native
read-only mode for viewers.

Shared items open at their authenticated direct address. Shared folders show their
children and have a Refresh folder button to retrieve new additions. My files
lists owned items and shared items personally filed there. The Shared with me drawer adds account-only discovery
and personal filing, described below alongside guest links.

## Permission changes and unsaved work

One server resolver checks current access for metadata, folder children, snapshot
reads/writes, Sheet and Doc image reads, and Doc image uploads. Uploads check again after asynchronous
image decoding. An inaccessible parent is omitted from shared metadata. Disabled
accounts and admins cannot use retained grants. The resolver traverses only the
item owner's ancestors and does not cache access decisions.

Downgrades and revocations apply on the next server request, including an existing
editor's next save. A rejected save locks editing and shows that changes are not
saved, while keeping local content and the navigation warning. Copy unsaved work
before leaving. A viewer upgraded to editor reloads to refresh permissions.
Already delivered content cannot be recalled from a browser. Collaboration
connections revalidate access and close stale sessions; durable commits also
check the current grant.

Revision checks remain in force for every writer. Sheets and Docs use the
shared collaboration service for simultaneous edits; stale offline generations
cannot overwrite a restored version. Sheet and Doc images remain item-scoped, private and uncached; an image URL grants
no additional access. Sheet image uploading is not implemented yet.

## Decisions and verification

Folder sharing replaces Team Spaces (owner, chat 2026-10-17). The most generous
grant wins (grooming 2026-10-17). The common resolver, admin exclusion and revision
protection were required in [decision #23](https://github.com/mxbaylee/spinel/issues/23).
Ownership-only organization, authenticated direct addresses and honest revocation
behavior were recorded in [decision #28](https://github.com/mxbaylee/spinel/issues/28)
on 2026-10-17. The Operator stays outside workspace content; the Owner retains
control; the Collaborator gets readable permissions and preserved unsaved work;
the Link guest receives no access from an ordinary item address.

Resolver and HTTP tests cover direct/inherited/mixed grants, future children,
moves, revocation, downgrade, disabled/admin accounts, private ancestors, owned-only
listing, owner-only changes, stale saves and image access including revocation
during decoding. Browser tests use separate owner and collaborator sessions to
share a folder, create future Sheet/Doc children, edit both, reject a save in an
open downgraded editor, open read-only viewers and revoke access.

## Guest links

New guest links automatically show a [branded social card](page-identity.md) with
the document title and type. Previews never show the owner or contents. Private
pages and older fragment-only links use the generic Spinel card.

For a Sheet or Doc, the owner can use **Share → Share without an account** to
create a view-only or editable guest link. Anyone holding that address gets only
that document. Folder links are unsupported. A replacement immediately invalidates
the old link; **Turn link off** removes access from open guest editors too. Link
changes briefly reconnect open account editors so old personal labels cannot
remain in the shared room. Already delivered content cannot be recalled.

The address contains a 256-bit random capability in its fragment, which browsers
do not send in request URLs or referrers. The server stores a hash, returns the
secret only when creating a link, and exchanges it for a Secure, HttpOnly,
SameSite=Strict document-scoped guest cookie. Guest sessions last 24 hours. Opening
the same valid link reuses the current session; Web Locks serialize exchanges
across tabs so their HTTP identity cannot diverge from their open sockets. Guest
links require a current browser supporting Web Locks. Reopen the supplied link
after a session expires. At most 128 active guest sessions are retained; expired
sessions are pruned when another opens. Token exchanges are rate-limited.

Guest principals are separate from accounts and never impersonate an owner.
They count as collaboration members like other visitors; no concurrency/license
limit is bypassed. Guest pages have no dashboard, account navigation, history,
sharing controls or account export/import routes. Scoped credentials authorize
only the selected document, its collaboration routes and its images. View links
cannot write or upload. Access is rechecked after image decoding and at durable
collaboration commits. Revoked links, trashed documents and disabled owners deny
access. A transient metadata/network failure retains the guest editor and its
unsaved-work guard; an authoritative denial removes the editor.

While a link is enabled, collaboration labels are **Guest** or **Collaborator**,
with no personal names or avatars. Account listings, email addresses and unrelated
metadata are not exposed. Opaque protocol UUIDs have no guest-accessible profile
lookup and remain unchanged, including in legacy revisions. Document content is
shared as written. Client presence is restricted to bounded native cursor updates;
profile/custom events and extra fields are rejected. Link transitions fence new
admissions, drain pending joins and evict all scoped connections, including ones
that have not joined a room, before publishing the new link. Epoch checks reject
old tickets and credentials.

These boundaries preserve the Operator's account separation, the Owner's control,
the Collaborator's private details and the Link guest's document-only access.
Decisions [#23](https://github.com/mxbaylee/spinel/issues/23),
[#60](https://github.com/mxbaylee/spinel/issues/60) and
[#72](https://github.com/mxbaylee/spinel/issues/72), 2026-10-17/18. The original
128-bit minimum is exceeded by 256-bit tokens. Tests cover expiry, rotation,
scope, image authorization after decoding, personal metadata filtering, pending
connections, multiple guest tabs, transient polling failures and open-editor
revocation in both development and production builds.

## Finding and filing account shares

The **Shared with me** drawer contains currently accessible documents and folders,
including inherited folder contents. It shows their owner's display name and a
shared badge. Those labels also appear in folder listings, the opened item and
pins and [dashboard search](search.md), using the same item metadata and badge.
Link guests have no account drawer and receive none of this account metadata.

Drag an item onto one of your folders (or All my files), or use **File into folder**.
Each person has at most one personal placement per shared item. Filing again moves
that reference. **Remove from my folder** deletes only the reference: the original,
your access, the drawer entry and your pins remain. Shared folders are shortcuts
to their original accessible contents. Placement never changes owner, canonical
parent or grants. These preserve SPN-018's rules from decisions #23 and #30 and
the owner's 2026-10-17 direction that filing is on by default.

The drawer sorts by latest applicable grant time, then ID. For children created
after an inherited grant, creation time bounds that timestamp. Content edits,
role changes and moves do not reset an existing grant's time; revoke/regrant does.
Legacy grants migrate with an unknown timestamp and display **Older share**, after
dated shares, rather than using document modification time as a fabricated share
date. This resolves the migration requirement recorded in grooming #60.

Access loss permanently removes personal placements, including source trash or a
move out of inherited access. A later regrant does not revive them. Trashing a
personal destination removes its references without touching shared originals;
restoring that folder permits filing again. Deleting it cascades only the references.
Requests check current source access and an owned destination within a transaction.
The drawer and personal placements refresh on focus and every five seconds while
visible; an inaccessible document is rejected immediately at the server boundary.
Refreshing this catalog does not recreate an open editor or discard pending edits.

Decision [#74](https://github.com/mxbaylee/spinel/issues/74), 2026-10-18, weighs simple
storage for the Operator, an unchanged owner tree, predictable personal filing for
the Collaborator, and unchanged account isolation for the Link guest. Tests cover
legacy migration, ordering, destination isolation, inherited grants, revoke/regrant,
trash, and browser filing/removal/revocation. [Search](search.md) includes these shares and personal filing paths.

## Doc formula sources

A Doc grant never grants access to its [Formula sources](formulas.md). Every
input must be readable by the viewer; otherwise the whole formula is unavailable,
including aggregates. Host guest links grant no source access. SPN-076 tracks
explicit dependency sharing; no source is shared automatically.
