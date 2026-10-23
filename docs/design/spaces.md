# Spaces and file roles

Designed in SPN-047; [decision #126](../implementation/SPN-047.md#legacy-decision-126-approved-redesign-and-its-limits)
records the owner's review and refinements. A Space is one file inside existing
folders. SPN-078 supplies the internal model and recovery foundation; SPN-091 and
SPN-092 supply the account experience and guest/integration acceptance.
Spaces open from My files at `/spaces`, with one inherited permission boundary
for all current and future children. Delegated file Admin is implemented by SPN-079.

## Delivery slices

The 2026-10-21 grooming split preserves the original SPN-078 acceptance.
SPN-092 followed SPN-064 so ownership-transfer integration could be verified
against its implementation:

| Ticket | Owns | Completion boundary |
| ------ | ---- | ------------------- |
| [SPN-078 foundation](../implementation/SPN-078.md) | Durable Space/child model, sole ownership, uniform inherited roles, stable IDs/order/bindings and subtree recovery metadata | Supported server boundaries authorize every child; cycles, child grants and unsupported conversions fail safely. No unfinished product routes are exposed. |
| [SPN-091](../implementation/SPN-091.md) | Authenticated creation, editor/navigation, accessible rename/reorder/nesting, remembered/deep-linked selection and persistent internal Trash | Owner/editor/viewer behavior and recovery are reviewable before ordinary access is enabled; approved light/dark/phone UI follows this design. |
| [SPN-092](../implementation/SPN-092.md) | Space-wide View/Edit guests, privacy/social cards, existing formulas/images/collaboration/MCP/export, account history/scoped offline preparation and backup/owner-transfer acceptance | Guest and integration surfaces keep Space scope through asynchronous operations, rotation/revocation, downgrade, trash and disabled owners; ordinary creation and navigation use the same verified boundary. |
| [SPN-079](../implementation/SPN-079.md) | Delegated account-only file Admin after SPN-092 | One Owner remains; guests never become Admin and the Operator never gains document access. |

Ordinary Space creation/navigation is enabled by SPN-092, whose merge requires
integration and recovery acceptance, including backups and owner transfer.
Unsupported Space/child capabilities refuse access. Reuse existing services;
a split never permits an unchecked HTTP/socket/MCP/export path or a cached
Formula-value fallback.
Same-Space sources follow the Space role; external sources remain independently
authorized. Whole-Space moves/trash/restore, backups and ownership handover retain
child identity, contents, order and formula bindings. No slice adds child grants,
standalone-file conversion/extraction, bulk offline downloads, new formula syntax
or a new export format. Artwork remains SPN-077.

## Implemented foundation

[Decision #135](../implementation/SPN-078.md#legacy-decision-135-durable-space-identity-and-scope), 2026-10-21,
records the storage and access choice. `workspace_items` stores a real Space
root, with stable existing item IDs and explicit `space_id`/`space_position`
membership and sibling order. Internal Docs, Sheets and grouping folders may
contain children of any of those three kinds. One everyday account owns the
root and all children; moves and renames never copy native snapshots or change
formula bindings. Nested Spaces, cycles, cross-Space moves, child grants/links
and standalone conversion/extraction are refused.

The internal `SpaceStore` resolves fresh access in the same transaction
as each read or mutation. View can read the live tree; Edit can create, rename,
reorder and move its contents. Root sharing, rename and outer-folder moves are
Owner-or-Admin capabilities. The most generous Space/outer-folder View/Edit/Admin grant applies to
every existing and future child. Disabled callers/owners and Operators
are refused. View/Edit guests use their current root capability and receive no
outer location or account identity. There is no global bypass
that admits Space members to ordinary file services.

`SpaceRecoveryStore` records each deleted subtree's original parent/order,
deletion actor/time and batch, and detaches its root within the same Space.
Earlier deletion batches remain independent. Account editors can list and
restore these subtrees; only the active Owner can permanently delete them after
confirming their exact current membership and batch. Restore uses the current
authorized original parent, or the Space root with a generic fallback reason;
saved location metadata never grants access or discloses an unavailable parent.

`SpaceLifecycleStore` controls whole-Space trash, restore and confirmed permanent
deletion. Owner or File admin can trash; restore and permanent deletion remain
Owner-only. Trash changes only the root, preserving all native
data, internal order and earlier deletion batches. Restore does not revive earlier
internal tombstones. An unavailable outer folder falls back to My files root
without disclosing its old location. Permanent deletion validates the complete
graph and deletes leaves before parents in one transaction, preserving native
foreign-key cascades and cleanup hooks; a late failure rolls everything back.

The complete-tree validator bounds each request to 10,000 retained members,
including tombstones, and bounded recovery records. It refuses malformed or
oversized graphs rather than truncating them. This is a resource guard, not a
presentation depth limit. Ordinary Trash excludes internal nodes and retains a
whole ordinary subtree containing a Space, while unrelated ordinary trash
can still expire. **No automatic Space expiry is enabled.** Record a retention
decision before enabling it; the ordinary 30-day policy does not silently apply.

Startup performs the transactional schema migration before the collaboration SDK
opens its connection. Migration/reopen and SQLite snapshot-copy tests preserve
IDs, content, bindings and recovery data. SPN-092's actual encrypted backup/restore
and SPN-064 owner-transfer acceptance cover native content, Formula bindings,
images, checkpoints, live generations, order and earlier internal Trash.
Ordinary native-document lookup still refuses Space roots/children: integrations
carry an exact root and stable child through the shared authorization resolver.
Only the outer metadata/lifecycle facade composes Space roots with ordinary files.
The [implementation specification](../implementation/SPN-078.md) records the
boundary inventory, tests and publication checkpoint.

This foundation keeps one bounded storage model for the Operator, preserves the
Owner's content and recovery identities, gives Collaborators uniform inherited
access, and keeps Link guests outside unsupported capabilities. It implements
the model and recovery rules from owner decisions [#116](../implementation/SPN-078.md#legacy-decision-116-spaces-remain-files-in-folders), [#117](../implementation/SPN-078.md#legacy-decision-117-whole-space-guest-capability) and [#118](../implementation/SPN-078.md#legacy-decision-118-space-roles-and-internal-editing) and [#126](../implementation/SPN-047.md#legacy-decision-126-approved-redesign-and-its-limits).

## Account navigation and recovery review

SPN-091 introduced the composed native Doc/Sheet editors, Space tree and recovery
stores behind an explicit review gate. SPN-092 enables the ordinary `/spaces`
entry and retains `/review/spaces` as an alias. Spaces are enabled by default;
`SPINEL_SPACE_REVIEW=0` (or `createApp({ spaceReview: false })`) explicitly closes
all Space boundaries while preserving their stored data. This legacy option
never grants document privileges to an Operator. Routine
[decision #137](../implementation/SPN-091.md#legacy-decision-137-default-off-space-review-stage), 2026-10-22, records
the earlier safe review sequencing and all four persona tradeoffs.

One internal Pages navigation replaces the outer file sidebar. On compact
screens it becomes a keyboard- and touch-accessible drawer. Page opening and
child expansion are separate, and every editable row has visible More actions.
Docs, Sheets and folders can all contain children. Move or reorder uses explicit
destination and position controls, so dragging is not required. Names are labels;
stable IDs identify duplicate-named pages and preserve links after organization.

Remember the last authorized Space/page separately from the prior My files
view, scoped to the signed-in account. Explicit unavailable page links never
silently open a different page. Browser Back/Forward, page switches and exits
respect the native pending-edit guard. Sign-in can carry only the Space and
child IDs or the internal Trash view, never a client-supplied return URL. Current
server authorization is still required after sign-in and on each operation.

Account Editors can trash and restore internal subtrees; Viewers receive no
Trash listing or metadata. Only the Owner can permanently delete, after an exact
current subtree preview and confirmation. A changed preview requires another
review. Restore keeps content, IDs, order and bindings at the readable original
parent, or the Space root with a generic explanation. Cancellation leaves the
subtree intact. Outer sharing, rename, move and recoverable trash permit the Owner or an account
File admin under SPN-079; the capability matrix below remains authoritative.

Native access carries one ingress-selected current credential plus the exact
Space and stable child through reads, live-unit aliases, sockets and asynchronous
commits. It rechecks role, ownership, live ancestry and generation after awaited
work. Mixed, partial or mismatched credential families fail closed; ordinary,
guest and MCP namespaces gain no account fallback. The
[SPN-092 implementation specification](../implementation/SPN-092.md) records the
integration and verification boundaries, continuing the original
[SPN-091 review contract](../implementation/SPN-091.md).

## Guest and existing integration behavior

A View/Edit link covers every current and future child of one Space. Guests
navigate and deep-link within that root; Edit can change native content and
add, rename, reorder, nest or trash its current tree. Guests have no account
destinations, outer location, identity/profile, child sharing, recovery collection,
public history, offline preparation or native-file export. Existing Print remains
available under its current role policy. Presence stays generic. Rotation,
revocation, downgrade, Trash and disabled ownership invalidate the whole root's
guest capability, including admitted work, unused tickets and open child rooms.

Doc images use canonical child URLs with current permission checks after decoding.
Doc Formulas preserve existing syntax, stable bindings, formatting and unavailable
states: same-Space sources follow the root role; every external source requires
independent account/MCP access and is unavailable to a Space guest. No cached
value can bypass a source check. Existing account native export, MCP and version
history use the same scoped native services. Automatic history capture/retention
only processes supported, currently authorized children and preserves deferred
or unsupported checkpoints; Space Trash still has no automatic expiry.

Offline preparation downloads one selected account-authorized child, with its
images, root identity and current generation. Prepared pages stay available in
that account's local Space view; My files labels a root with such copies **Pages
available offline**. Missing children need a connection and an explicit missing
deep link never opens another page. No bulk Space download is implied.

The purple Space social card uses the existing title/type-only preview capability
and SPN-077 artwork. It never includes child titles, content, account identities
or Formula values. Creating a guest link explicitly confirms that all current and
future Space contents share its role.

## Comparison and adopted layout

| Existing / planned friction                            | Reference pattern                                                    | Spinel proposal                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A collection could add another dashboard/sidebar layer | Notion's page hierarchy and Numbers' sheet organization              | One internal content sidebar replaces outer file navigation while a Space is open |
| Child sharing could suggest separate access            | Google sharing separates people/links; Spinel has one Space boundary | One Share action on the outer Space; child pages have no permissions controls     |
| Phone trees can consume the whole screen               | Dropbox's collapsible navigation                                     | A labelled Pages button opens a modal drawer; choose a page and return to content |
| Admin can be mistaken for server access                | No consumer comparison establishes Spinel's policy                   | “File admin” in file sharing, “Server Operator” in administration                 |

Sources and access date: [review evidence](redesign.md#evidence-and-comparisons).
Mockups: PlannedSpace, PlannedSpaceGuest, PlannedFileAdmin.

## Navigation and recovery

A Space opens at its remembered/deep-linked page. Its title identifies the Space;
the current page title is subordinate. The internal sidebar supports nested Docs, Sheets and folders. A Doc or Sheet can
also contain children: opening its title shows its content, while a separate
chevron expands its children. A folder only groups children. For example, a
Weekend trip Doc can contain a Trip costs Sheet; Reference can be a plain folder.
Add page offers Doc, Sheet or Folder.
A page's always-visible More menu exposes Rename, Move/reorder and Trash.
Move has destination and position controls so drag-and-drop is never required.
Back/Forward restores selection. Outer file rename/move/trash require Owner or File admin; editing internal structure is an Edit capability.

Space trash is internal, recoverable and reachable by account editors. Restore
returns content without altering its stable IDs/formula bindings. Viewers cannot
mutate the tree. Guest editors may edit/manage the current Space's contents under
SPN-092; guests never see outer folders or account-only recovery/history controls.
Guests navigating a revoked link lose the whole Space, including titles and values.

## Capability matrix

| Capability                              | View | Edit | File admin (SPN-079)         | Owner                | Server Operator              |
| --------------------------------------- | ---- | ---- | ---------------------------- | -------------------- | ---------------------------- |
| Read authorized content                 | Yes  | Yes  | Yes                          | Yes                  | No                           |
| Edit content / Space internal tree      | No   | Yes  | Yes                          | Yes                  | No                           |
| Grant/revoke View, Edit, Admin          | No   | No   | Yes                          | Yes                  | No                           |
| Manage guest links                      | No   | No   | Yes                          | Yes                  | No                           |
| Rename/move/trash outer file            | No   | No   | Yes, authorized destinations | Yes                  | No                           |
| Permanent deletion / ownership handover | No   | No   | No                           | Existing owner rules | Existing recovery rules only |
| Server accounts / backup health         | No   | No   | No                           | No, everyday account | Yes                          |

SPN-079 implements account File admin. There is exactly one Owner, inheriting all file Admin capabilities. Inherited roles use
the most generous effective grant. The UI shows provenance only when readable.
Links are View/Edit only, never Admin. Every Space child inherits the same role,
including future additions; no per-child override or child guest link exists.
Sources outside a Space still require independent access, including formulas.
The Operator's account recovery role never implies permission to browse content.

The optional tree occupies one 224 px column with a visible collapse/reopen
control. It defaults to a drawer at tablet/phone widths. It never appears beside
a second permanent rail. Owner feedback and persona walkthrough, 2026-10-20.

Owner refinement (chat, 2026-10-20): site navigation, connection, device theme and
profile stay in the horizontal top header. The left column belongs exclusively
to the Space tree. My files returns to the prior file view. The site header reuses the main navigation icons horizontally, without a visible
My files label or a tree-expansion chevron. A local **Pages** control below the
site header reopens the hidden tree, as a drawer on phones.
This favors Owner/Collaborator orientation without consuming a second navigation
column; link guests retain scoped navigation without account destinations, and
Operator workflows remain separate. The durable folder/page hierarchy is provided
by the SPN-078 foundation; SPN-091 supplies the composed account UI described
above. SPN-092 completes ordinary activation and guest/integration acceptance.

The Space tree uses the quieter `--sp-bg` / `--sp-text` surface, distinct from
the saturated pink site header in both themes (owner, chat 2026-10-20). The same
surface applies in its phone drawer.

Owner follow-up, 2026-10-21, decision [#126](../implementation/SPN-047.md#legacy-decision-126-approved-redesign-and-its-limits): internal Trash should look like the
My files Trash collection, with deleted page/sheet/folder icons, names, readable
original locations and permitted restore/delete controls. Use recovery metadata
and preserve subtree boundaries; never reveal an inaccessible parent location.
The SPN-047 mockup now contains a local deleted-item collection for Docs, Sheets
and folders. Restore removes an item from Trash and places it back in the
visible Space tree; a missing original parent restores to the Space root with
an explanation. Folder contents recover together. Permanent deletion names the
item and folder descendants in a confirmation; cancel preserves them. Account
editors can restore, only the Owner gets permanent deletion in this fixture,
and offline actions are disabled. Link guests receive no recovery collection.
The collection labels its local-only behavior and resets on reload; SPN-078
owns durable identifiers, recovery data and authorization, while SPN-091 connects
this collection to persistent account recovery. SPN-092 verifies guest exclusion
and cross-feature behavior. The owner requested the composed UI now, rather than
deferring it with that integration
(chat, 2026-10-21).

SPN-079 implementation follows this existing matrix. File admin is account-only,
includes Edit, and can manage other accounts’ View/Edit/Admin grants. Owner remains
unique and absent from grant controls. Moves require source and destination Admin
and the same owner; only the Owner can move to their My files root. Show only
authorized destination folders and generic inherited-role provenance. Recoverable
trash enters the Owner’s existing Trash; permanent deletion and ownership handover
remain unchanged. Personal filing stays distinct from canonical Move. Decision
[#145](../implementation/SPN-079.md#legacy-decision-145-delegated-file-admin-boundaries), 2026-10-22.
