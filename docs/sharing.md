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
read-only mode for viewers. Slides retain their existing empty-document placeholder
until their editor ticket lands.

Shared items open at their authenticated direct address. Shared folders show their
children and have a Refresh folder button to retrieve new additions. My files
still lists owned items only. The Shared with me drawer and personal placements
are SPN-018; guest links are described below.

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
Already delivered content cannot be recalled from a browser. Collaboration
connections revalidate access and close stale sessions; durable commits also
check the current grant.

Revision checks remain in force for every writer. Sheets and Docs use the
shared collaboration service for simultaneous edits; stale offline generations
cannot overwrite a restored version. Doc images remain document-scoped, private and uncached; an image URL grants
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

## Guest links

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
