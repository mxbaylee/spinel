# Sharing with invited people

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
read-only mode for viewers. Slides retain their existing empty-document placeholder
until their editor ticket lands.

Shared items open at their authenticated direct address. Shared folders show their
children and have a Refresh folder button to retrieve new additions. My files
still lists owned items only. The Shared with me drawer and personal placements
are SPN-018; unauthenticated share links are SPN-016.

## Permission changes and unsaved work

One server resolver checks current access for metadata, folder children, snapshot
reads/writes and Doc image reads/uploads. Uploads check again after asynchronous
image decoding. An inaccessible parent is omitted from shared metadata. Disabled
accounts and admins cannot use retained grants. The resolver traverses only the
item owner's ancestors and does not cache access decisions.

Downgrades and revocations apply on the next server request, including an existing
editor's next save. A rejected save locks editing and shows that changes are not
saved, while keeping local content and the navigation warning. Copy unsaved work
before leaving. A viewer upgraded to editor reloads to refresh permissions.
Already delivered content cannot be recalled from a browser. There is no live
permission push in this ticket; collaboration connections must also enforce access
when SPN-012/SPN-017 introduce them.

Revision checks remain in force for every writer. Sharing does not yet enable
simultaneous editing: stale snapshots are rejected rather than overwriting a newer
save. Doc images remain document-scoped, private and uncached; an image URL grants
no additional access. Sheet image uploading is not implemented in this slice.

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
