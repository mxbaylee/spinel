# Sharing

Items are private by default. The Owner or a File admin can choose **Share** on a document, folder or
Space. In **People**, open a person’s row, choose Can view, Can edit or File admin,
then choose **Share** or **Save changes**. Rows show confirmed access. Only one
recipient is edited at a time; Cancel or switching people/tabs discards that draft. **Copy account link** copies the authenticated address;
if the clipboard is unavailable, a selectable address appears for manual copying.
Give that address to the person. They must sign in; the address alone does not grant access. Server Operator accounts cannot receive grants or access
workspace content.

Folder grants apply to every descendant, including future additions. Direct and
inherited grants combine using the most generous access: Admin above Edit above
View. An inherited Admin remains Admin even if the direct grant is Viewer. The sharing panel
shows both the direct choice and effective access. **No direct access** removes
only that item's grant; remove the ancestor grant too to revoke inherited access.
Moving an item out of a shared folder removes that inheritance immediately.

Viewers can open folders, read document content and load its images. Editors can
also save document content, upload Doc images and create children in editable
shared folders. File admins additionally manage
other accounts' grants and guest links, rename, move within authorized destinations,
and send outer files to recoverable [Trash](trash.md). [Space roles](#space-sharing) allow Edit to manage the
internal tree. Sharing never changes ownership. Sheets and Docs use their native
read-only mode for Viewers.

Shared items open at their authenticated direct address. Shared folders show their
children; **More → Refresh folder** retrieves new additions. My files lists owned
items and shared items personally filed there. The Shared with me place adds
account-only discovery and personal filing, described below alongside guest links.

## Creating in a shared folder

Inside a folder with Can edit or File admin access, **New** creates a Sheet, Doc,
folder or enabled outer Space in that folder. Native Univer imports use the same
rule. The folder owner owns each new item, and everyone with folder access
inherits their existing role. The creating account receives no extra grant and
loses access when its folder grant is revoked. Ordinary Editors still cannot
rename, move, trash or share those items.

The creation dialog explains ownership. Account-authorized file rows show
**Created by <name>**, including when the creator later leaves. Existing items
without recorded attribution omit it. Guest responses never include this account
identity. A separate copy action remains SPN-065 and must use the same destination
and creator rules when implemented.

Prepared [offline creation](offline.md#creating-a-new-document-offline) supports
Sheets and Docs in cached editable shared folders. Publication rechecks access;
revocation preserves local work for explicit recovery instead of silently creating
it elsewhere. See [SPN-069's ownership and receipt decisions](implementation/SPN-069.md).

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

Folder sharing replaced the earlier Team Spaces proposal (owner, chat 2026-10-17).
On 2026-10-20 the owner requested a different Space model: a single file inside
existing folders, with its own internal Doc/Sheet tree and one sharing boundary
([decision #116](implementation/SPN-078.md#legacy-decision-116-spaces-remain-files-in-folders)). The
[internal foundation](design/spaces.md#implemented-foundation) is implemented in
SPN-078. SPN-091 added account navigation and recovery; [SPN-092](implementation/SPN-092.md)
completes guest sharing and the scoped integrations described below. The most
generous grant wins (grooming 2026-10-17). The common resolver, admin exclusion and
revision
protection were required in [decision #23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming).
Ownership-only organization, authenticated direct addresses and honest revocation
behavior were recorded in [decision #28](implementation/SPN-015.md#legacy-decision-28-current-viewer-and-editor-grants)
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
the document or Space title and type. Previews never show the owner or contents;
a Space card also excludes child titles and Formula values. Private pages and
older fragment-only links use the generic Spinel card.

For a Sheet or Doc, the Owner or a File admin uses **Share → Link**,
chooses Can view or Can edit, then **Create link**. Anyone holding that address gets
only that document. Folder links are unsupported. Copy the guest address while it
is shown; switching to People preserves it, but closing and reopening sharing cannot
reveal it again. An existing link shows **Replace link…** when its address is no
longer available; a freshly created link has replacement under **More**. Replacement
confirms its role and immediately invalidates the old link. **More → Turn off link**
removes access from open guest editors too. Enabled links show their confirmed role;
role editing happens only when creating or confirming a replacement.
Link changes briefly reconnect open account editors so old personal labels cannot
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
sharing controls or account export/import routes. A standalone link authorizes
only its document, collaboration routes and images; a Space link covers the
root's internal tree as described below. View links cannot write or upload.
Access is rechecked after image decoding and at durable
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
Decisions [#23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming),
[#60](implementation/grooming-2026-10-18.md#legacy-decision-60-recovery-and-organization-grooming) and
[#72](implementation/SPN-016.md#legacy-decision-72-scoped-anonymous-link-capabilities), 2026-10-17/18. The original
128-bit minimum is exceeded by 256-bit tokens. Tests cover expiry, rotation,
scope, image authorization after decoding, personal metadata filtering, pending
connections, multiple guest tabs, transient polling failures and open-editor
revocation in both development and production builds.

## Finding and filing account shares

The **Shared with me** place contains currently accessible documents and folders,
including inherited folder contents. It shows their owner's display name and a
shared badge. Those labels also appear in folder listings, the opened item and
[dashboard search](search.md), using the same item metadata and badge.
Link guests have no account file catalog and receive none of this account metadata.

Open the item’s **More** menu and choose **File into folder…** to file it into
one of your folders or My files. The menu supports pointer and keyboard use.
Each person has at most one personal placement per shared item. Filing again moves
that reference. **Remove from my folder** deletes only the reference: the original,
your access and the Shared with me entry remain. Shared folders are shortcuts
to their original accessible contents. Placement never changes owner, canonical
parent or grants. These preserve SPN-018's rules from decisions [#23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming) and [#30](implementation/SPN-021.md#legacy-decision-30-trash-batches-and-exact-set-deletion) and
the owner's 2026-10-17 direction that filing is on by default.

Shared with me sorts by latest applicable grant time, then ID. For children created
after an inherited grant, creation time bounds that timestamp. Content edits,
role changes and moves do not reset an existing grant's time; revoke/regrant does.
Legacy grants migrate with an unknown timestamp and display **Older share**, after
dated shares, rather than using document modification time as a fabricated share
date. This resolves the migration requirement recorded in grooming [#60](implementation/grooming-2026-10-18.md#legacy-decision-60-recovery-and-organization-grooming).

Access loss permanently removes personal placements, including source trash or a
move out of inherited access. A later regrant does not revive them. Trashing a
personal destination removes its references without touching shared originals;
restoring that folder permits filing again. Deleting it cascades only the references.
Requests check current source access and an owned destination within a transaction.
Shared with me and personal placements refresh on focus and every five seconds while
visible; an inaccessible document is rejected immediately at the server boundary.
Refreshing this catalog does not recreate an open editor or discard pending edits.

Decision [#74](implementation/SPN-018.md#legacy-decision-74-personal-filing-of-shared-items), 2026-10-18, weighs simple
storage for the Operator, an unchanged owner tree, predictable personal filing for
the Collaborator, and unchanged account isolation for the Link guest. Tests cover
legacy migration, ordering, destination isolation, inherited grants, revoke/regrant,
trash, and browser filing/removal/revocation. [Search](search.md) includes these shares and personal filing paths.

## Doc formula sources

A Doc grant alone never grants access to its [Formula sources](formulas.md).
Every input must be readable by the viewer; otherwise the whole formula is
unavailable, including aggregates. Stable bindings, formatting and unavailable
results keep the existing Formula behavior; no cached value bypasses access checks.

The active recipient editor reviews formula sources. **Include formula sources**
starts unchecked. Leaving it unchecked changes only the selected host access;
**Source details** can reveal the inventory. Selecting it visibly lists every exact
authorized source target marked **Can view · Proposed** before **Share** or
**Save changes**. Existing View, Edit,
File admin, ownership and inherited access are kept; the operation never adds
editing or downgrades a source. Sources can be added even when the recipient
already reads the report and its selected role is unchanged.

A source the sharer can read but cannot administer says that its Owner or File
admin must grant access. A source the sharer cannot discover stays generic: no
source name, ID or private parent is revealed. That limitation does not establish
whether the recipient can read the hidden source. Sharing the eligible sources
must not be described as making every formula available.

Sharing a Space reviews direct formula references from every live Doc in it,
consistently from the dashboard and editor. Same-Space sources already inherit
the root grant and require no separate checkbox or child grant. An external
source inside another Space is grouped under that **Entire Space**, with its
exact authorized source Sheets and the explicit consequence: access to every
current and future page and folder. Only that outer root can be granted; the
dialog never offers a fabricated grant to one child. Source references are not
followed transitively into unrelated documents.

Confirmation rechecks the current account, host and source authority, recipient
access, source identities and names, and Space boundaries. A changed review
requires a fresh list and another opt-in before any source grant. Successful
host/source grants are reported separately from sources still requiring another
owner's help. A failed source check permits host-only sharing with a warning,
without pretending that no dependencies exist. After an uncertain network result,
review current access before trying again; a lost response does not prove that
no permissions changed. The editor stays open with the selected role, refreshed
confirmed access and sources unchecked. An unchanged role without a fresh source
opt-in keeps Save disabled. Complete success returns to the person’s row; partial
results keep the same editor and action.

Source review is bounded: at most 128 live Docs, 256 unique source Sheets, 32 MiB
of serialized committed Doc snapshots in total, 1,024 custom ranges per Doc,
and 10,000 accumulated ancestry reads. A limit refuses the complete review rather
than omitting later sources. Host-only sharing remains available.

A standalone Doc guest link grants no source access. A Space guest link covers
same-Space sources, including future additions, but no external source. Creating
or replacing a host link never creates a source link or changes account grants.
Account and MCP callers still need their own current access to every external
source. Automatic requests, notifications, copied source values and public source
publication are outside this flow. See the
[SPN-076 design and implementation record](implementation/SPN-076.md).

## Space sharing

Spaces are enabled by default in the application. Account navigation uses
`/spaces`; `/review/spaces` remains a compatibility alias. Explicit
`createApp({spaceReview:false})` or `SPINEL_SPACE_REVIEW=0` disables Space exposure.
This runtime switch does not change the permissions below.

A Space is one outer file in folders, search, tags and personal filing. Its
effective View/Edit/Admin role comes from the root and readable outer-folder grants
and applies uniformly to every current and future internal page and Sheet.
Children have no separate grants or links and do not become ordinary catalog
files. Owner and File admins administer the root; only the Owner permanently deletes its contents.
An account Editor can manage the internal tree and recover deleted subtrees.

The Owner or a File admin can issue a View or Edit guest link for the root. An Edit guest can
create, rename, reorder, nest and trash internal content; a View guest reads it.
Guests receive no outer folders, account identities, sharing controls, recovery
collection, public history, native-file export or offline preparation. Existing
native Print policy is unchanged. Account readers can export one authorized native
child, browse its history and prepare its offline copy; account Editors
and the Owner can also name and restore versions.

Every content, collaboration, Formula, image, export and MCP boundary checks the
original credential and exact root/child, current role, live ancestry and, where
applicable, generation. Mixed or incomplete credentials are refused. Async work
rechecks authorization; image uploads check again after decoding, and canonical
stored image URLs grant no access by themselves. Sheet image insertion remains
unsupported. Disabled Space owners make the whole Space unavailable.

A root link's privacy epoch covers every child room and outstanding admission.
Rotation, revocation and role changes fence and evict affected connections;
generic **Guest**/**Collaborator** labels hide account names and avatars. Guest
navigation, source discovery and metadata stay within that root. The same-Space
Formula rule follows [decision #117](implementation/SPN-078.md#legacy-decision-117-whole-space-guest-capability).
[Deliberate external dependency sharing](#doc-formula-sources) discloses the whole
source Space when that is its permission boundary. Internal Trash and whole-Space
recovery use the same [30-day deadline as ordinary Trash](trash.md). Account
Editors and File admins can restore internal batches before expiry; outer recovery
remains Owner-only. Ownership handover and account disablement do not restart
the original deletion clock. Disabled owners cannot recover content, but bounded
system expiry still removes expired batches. Guests gain no recovery collection.
Explicitly disabling Space exposure retains hidden Spaces and containing groups
instead of admitting them through ordinary cleanup.

The [SPN-092 implementation record](implementation/SPN-092.md) tracks native,
HTTP/socket, MCP and recovery acceptance separately from final-head CI and merge
approval. This preserves the Owner's control, the Collaborator's uniform role,
the Link guest's exact boundary and the Operator's content isolation.

## Delegated file administration

Exactly one Owner inherits every File admin permission. Multiple account Admin
grants are allowed, directly or inherited from a folder. Grant controls cannot
alter the Owner, transfer ownership or grant content access to a server Operator;
the current actor's own grant is excluded from those controls. Another File admin
or the Owner can revoke or downgrade them. View/Edit guest links never offer Admin.

Canonical moves require Admin on both source and destination, the same owner, and
an ordinary folder outside every Space. Only the Owner can choose their My files
root. Destination lists omit unauthorized folders; inherited-role explanations
never disclose private ancestor names. Rename preserves an undisclosed original
parent. Personal filing/removing a reference remains available to all non-owners
and never changes the canonical file location.

Admin can send a file to the Owner's recovery collection. Outer recovery listing,
restore, permanent deletion and ownership handover retain their existing
owner/operator rules. Internal Space recovery remains available to account Editors
and Admins; permanent deletion remains owner-only. Every Space child, including
future pages, has its root's role without overrides. Ordinary and Space sockets,
content, images, exports, Formula sources and OAuth/MCP recheck current authority;
a token's scopes never increase with its user's File admin grant.

Decisions [#118](implementation/SPN-078.md#legacy-decision-118-space-roles-and-internal-editing) and
[#145](implementation/SPN-079.md#legacy-decision-145-delegated-file-admin-boundaries), 2026-10-20/22, retain sole
ownership, content-blind Operators and View/Edit guests while letting trusted
Collaborators administer shared work. The approved [capability matrix](design/spaces.md#capability-matrix)
and [SPN-079 verification contract](implementation/SPN-079.md) document the limits.
