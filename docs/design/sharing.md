# Sharing

## SPN-047 composed redesign proposal

Approved by the owner, 2026-10-21, [decision #126](../implementation/SPN-047.md#legacy-decision-126-approved-redesign-and-its-limits). Production implementation remains separate.
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Sharing, PlannedFileAdmin.

| Current friction                                                                                                | Public reference pattern                                                                                    | Adopted proposal                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Per-person Apply buttons and multiple guest-link actions compete with the people and permissions being changed. | Google separates people from general access; Numbers illustrates collaboration options grouped in one menu. | One dialog: people first, guest links second; access choices beside the relevant person. |

Retain No direct access and inherited-access explanation. Direct-access choices are staged until Apply access; pending and failed changes preserve confirmed access and the selected draft. Success confirms in place, and failure offers retry. Guest links retain role selection, creation, once-only copy, replacement confirmation and turn-off; the SharingCreatedLink, SharingExistingLink, SharingReplaceLink and SharingError stories make those states reviewable. Do not reveal an inaccessible parent name. SPN-079 implemented File admin; its approved PlannedFileAdmin choices apply to account grants and are never offered to guests.

The approved proposal above governs placement during implementation. Existing behavioral and
permission rules below still apply; production migrations remain separate tickets.

## How others do it

|             | Google                                                              | Microsoft                                      | Apple Numbers                       | Zoho                  |
| ----------- | ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------- | --------------------- |
| Invite      | Field for people at the top, role next to it                        | "Add people" field plus permission             | Collaborate: invite plus permission | Email field plus role |
| People list | Each person with a role dropdown; Remove access is in that dropdown | Per-person permission dropdown, "Stop sharing" | Per-person options                  | Per-person role menu  |
| Link        | "General access" section below people, then Copy link               | "Anyone with the link" settings, Copy link     | "Anyone with the link" option       | Link sharing section  |

The shared pattern: one dialog, people first, link second; a role dropdown per
person with removal inside it; one Copy link action.

## Spinel today

`Sharing` owns one Base UI dialog for account access and guest links. The server
returns only the other everyday accounts whose direct grants the current Owner
or File admin may manage; protected ownership and the actor's own grant are not
editable. People appear first, with No direct access / Can view / Can edit /
File admin, confirmed effective access and an explicit Apply access action.
Guest links follow for Sheets, Docs and whole Spaces. Folders have no guest links.
The implementation is recorded in [SPN-081](../implementation/SPN-081.md);
its verification status is separate from the approved design.

## Adopted pattern

Spinel has about two people, so there is no invite field: every other account is
already listed. A [dialog](README.md#dialog) titled "Share <name>":

1. **Header:** the title and close control. **Copy account link** remains in the footer, as in the approved composed mock, beside Done. Clipboard failure exposes a selectable account address.
2. **People:** each account with a select: No direct access, Can view, Can edit, File admin.
   "No direct access", as in docs/sharing.md, because access inherited from a
   folder survives it. Selecting a role keeps a draft until **Apply access**.
   While applying, the role control is disabled and confirmed access stays
   visible. Failure preserves both the previous access and the selected draft,
   with **Retry access update**; success confirms in a status line. Inherited access shows as
   a muted line, "Can edit through a folder". Naming the folder ("through
   Budgets") needs the sharing API to return it; `SharePerson` carries only the
   roles today. Disabled accounts say "(disabled)" and can't be granted.
3. **Anyone with the link** (Sheets, Docs and whole Spaces): a status line ("Off",
   "Guests can view", "Guests can edit"), the role select, and **Create link**
   when off. Right after creating, the address shows with **Copy link**; later
   visits say "Replace the link to copy a new address." Replace link… and Turn
   off sit in the section's More menu. Replace confirms: "Replace the link? The
   old link stops working at once, and anyone using it loses access." Space link
   creation additionally confirms that access covers every current and future page
   and folder; turning off a Space link confirms the all-contents loss of access.
   (docs/sharing.md: a replacement ends every guest connection on the old link;
   only account editors briefly reconnect.)
4. One muted sentence keeps the rule that matters: "Collaborator names are
   hidden while link sharing is on." The rest of the rules live in
   docs/sharing.md.
5. **Done** closes. There is no Save.

Select options say "Can view" / "Can edit"; badges elsewhere say "View only" /
"Can edit". Owners and File admins can open Share. Viewers, Editors and guests see no
account-sharing controls. File admin is never a guest-link role. Ownership and
the acting account’s direct grant remain protected by the existing API.

### Always visible / behind a menu

| Always visible                                          | Behind a menu                               |
| ------------------------------------------------------- | ------------------------------------------- |
| Copy link, each person's access select and Apply access | Link section More → Replace link…, Turn off |
| Link status, role, Create link or Copy link             |                                             |
| Done                                                    |                                             |

## Formula sources (SPN-033 / SPN-076)

Sharing a document never shares its formula sources. A formula with any
inaccessible input shows an access placeholder, never a cached value or partial
aggregate. See [formulas.md](formulas.md). SPN-076 separately adds dependency
awareness and an unchecked option to share the exact listed source Sheets with
view access, subject to the sharer’s authority. It must not silently publish
sources when making a public host link. That dialog pattern requires its own
design PR before implementation.

## Stories

`Current production/Sharing/Sharing`, `Current production/Sharing/ShareLink`.
The composed, loading, empty, inherited, disabled-account, failed-write, pending,
File admin, Space, replacement, once-only address and stale-response states are
covered. The shared screenshot runner captures these in light, dark and phone
variants when run; a story’s presence is not screenshot approval.

## Guest-link inventory (planned, SPN-066)

Profile → Guest links lists the owner’s own files with type, role, enabled date
and expiry. Each row offers Change expiry and Turn off; it never reveals the
secret address. See `Redesign/Screens/PlannedGuestLinks`. Expiry choices are
never, one day, seven days and 30 days; changing expiry does not rotate a link.
