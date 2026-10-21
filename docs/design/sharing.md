# Sharing

## SPN-047 composed redesign proposal

Awaiting [owner approval](https://github.com/mxbaylee/spinel/issues/126).
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Sharing, PlannedFileAdmin.

| Current friction | Public reference pattern | Adopted proposal |
| --- | --- | --- |
| Per-person Apply buttons and multiple guest-link actions compete with the people and permissions being changed. | Google separates people from general access; Numbers illustrates collaboration options grouped in one menu. | One dialog: people first, guest links second; access choices beside the relevant person. |

Retain No direct access and inherited-access explanation. Changes apply with in-place confirmation/error and rollback on failure. Guest links retain role selection, creation, once-only copy, replacement confirmation and turn-off; the SharingCreatedLink, SharingExistingLink, SharingReplaceLink and SharingError stories make those states reviewable. Do not reveal an inaccessible parent name. Future File admin choices are isolated in PlannedFileAdmin and never offered to guests.

The proposal above governs placement after approval. Existing behavioral and
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

`Sharing` shows the item's share address, then every other everyday account with
a role select (No direct access / Viewer / Editor), its effective access and its
own "Apply access for <name>" button, then two paragraphs of rules. `ShareLink`
follows under "Share without an account" with a role select and
create/replace/turn-off buttons. The guest address is only readable right after
it is created (docs/sharing.md). "Close sharing" ends the panel.

## Adopted pattern

Spinel has about two people, so there is no invite field: every other account is
already listed. A [dialog](README.md#dialog) titled "Share <name>":

1. **Header:** the title and **Copy link** (the account-only share address).
2. **People:** each account with a select: No direct access, Can view, Can edit.
   "No direct access", as in docs/sharing.md, because access inherited from a
   folder survives it. A change applies at once and confirms in a status line;
   there is no per-person Apply button. Access inherited from a folder shows as
   a muted line, "Can edit through a folder". Naming the folder ("through
   Budgets") needs the sharing API to return it; `SharePerson` carries only the
   roles today. Disabled accounts say "(disabled)" and can't be granted.
3. **Anyone with the link** (Sheets and Docs only): a status line ("Off",
   "Guests can view", "Guests can edit"), the role select, and **Create link**
   when off. Right after creating, the address shows with **Copy link**; later
   visits say "Replace the link to copy a new address." Replace link… and Turn
   off sit in the section's More menu. Replace confirms: "Replace the link? The
   old link stops working at once, and anyone using it loses access."
   (docs/sharing.md: a replacement ends every guest connection on the old link;
   only account editors briefly reconnect.)
4. One muted sentence keeps the rule that matters: "Collaborator names are
   hidden while link sharing is on." The rest of the rules live in
   docs/sharing.md.
5. **Done** closes. There is no Save.

Select options say "Can view" / "Can edit"; badges elsewhere say "View only" /
"Can edit". People who aren't the owner never see Share; they see their access
badge.

### Always visible / behind a menu

| Always visible                              | Behind a menu                               |
| ------------------------------------------- | ------------------------------------------- |
| Copy link, each person's access select      | Link section More → Replace link…, Turn off |
| Link status, role, Create link or Copy link |                                             |
| Done                                        |                                             |

## Formula sources (SPN-033 / SPN-076)

Sharing a document never shares its formula sources. A formula with any
inaccessible input shows an access placeholder, never a cached value or partial
aggregate. See [formulas.md](formulas.md). SPN-076 separately adds dependency
awareness and an unchecked option to share the exact listed source Sheets with
view access, subject to the sharer’s authority. It must not silently publish
sources when making a public host link. That dialog pattern requires its own
design PR before implementation.

## Stories

`Sharing/Sharing`, `Sharing/ShareLink`.

## Guest-link inventory (planned, SPN-066)

Profile → Guest links lists the owner’s own files with type, role, enabled date
and expiry. Each row offers Change expiry and Turn off; it never reveals the
secret address. See `Redesign/Screens/PlannedGuestLinks`. Expiry choices are
never, one day, seven days and 30 days; changing expiry does not rotate a link.
