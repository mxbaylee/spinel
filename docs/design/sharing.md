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

## Formula sources (SPN-076 design prerequisite)

The adopted extension keeps one Sharing dialog, with a **Formula sources**
section inside each person's row, before **Apply access**. This is a design
contract; SPN-076 implements it after this prerequisite lands. The rationale
and all four persona effects are recorded in
[SPN-076](../implementation/SPN-076.md#explicit-recipient-source-review).

Sharing a Doc alone leaves every source permission unchanged. A formula with
any inaccessible input retains the SPN-033 unavailable state, never a saved value
or partial aggregate. See [formulas.md](formulas.md).

### Review and confirmation

1. Show confirmed host access and the staged host role as today. Discover direct
   formula references from the current saved Doc, deduplicated by stable identity.
   Sharing a Space reviews all live Docs inside it, consistently from dashboard
   or editor. Sharing always acts on the outer Space, never a child grant. Do
   not traverse source formulas or include unrelated documents.
2. Where the recipient lacks source access, explain: **Some formulas will be
   unavailable to Alex without access to their sources.** Offer **Also share
   source spreadsheets**, unchecked on entry. The full label is a 44 px touch
   target. It is offered only when there are eligible sources and the proposed
   host access allows the recipient to read the report. Removing a direct grant
   can still leave inherited host access; explain the effective outcome.
3. List current authorized source names and their status. Selecting the option
   marks the exact eligible targets **Can view · Proposed** before Apply access.
   Already accessible sources say **Can view / Can edit / File admin / Owner ·
   Kept** as appropriate; their existing direct and inherited access is untouched.
   Source-only sharing stays actionable when the host role is unchanged.
4. A readable source the actor cannot share says **Owner or File admin must
   share**. An unreadable, missing or otherwise undiscoverable source gets one
   generic explanation without its name, identity, parent or saved expression
   label. These sources are excluded from proposed grants; do not imply that
   every formula will become available. Operator accounts gain no source access.
5. Same-Space sources say **Included with this Space** and need no checkbox or
   child grant. Group external Space sources by their actual outer grant target:
   show its authorized name, each exact source Sheet, **Entire Space**, and
   **Can view every current and future page and folder in this Space.** A single
   opt-in covers only this visibly reviewed set; there is no fabricated child grant.
6. Apply access confirms the staged host role and, only if checked, those exact
   source targets. Recheck current host/source authority, recipient access,
   dependency identity and Space membership before mutation. Source grants can
   only add Can view where access is missing; never downgrade or add editing.
   A changed dependency set, name or grant boundary refreshes review and clears
   opt-in before granting sources. Never silently expand a Sheet into a whole Space.

### Loading, changes and outcomes

Use the existing muted/status/error patterns, with a bounded source section and
wrapping rows rather than a wide table. Source controls, duplicate Apply and
dialog dismissal are disabled during mutation; confirmed access stays visible.
Opening another host, changing the host role or replacing a material source
preview clears the opt-in. A response for an earlier view cannot restore it.

| State | Message and next action |
| --- | --- |
| Checking | **Checking formula sources…**; no opt-in until the current review succeeds. |
| Check failed | **Could not check formula sources. Try again.** / **Retry source check**. Host-only sharing may proceed with an explicit warning that sources were not checked. |
| Source list or boundary changed | **Formula sources changed. Review the updated list before sharing them.** Show the refreshed list, unchecked. |
| Source authority revoked | Explain that the Owner or File admin must grant access, using only currently authorized names. Never reuse the stale name as proof of authorization. |
| Complete | Confirm the host outcome and source outcome separately; only confirmed grants are described as shared. |
| Partial success | Say which host/source grants succeeded and which still need access. Keep successful grants, show no false all-success message, and offer **Review remaining sources**. Refresh before another opt-in. |
| Response lost | **Could not confirm the update. Review current access and try again.** Refresh confirmed permissions before claiming an outcome; do not claim that nothing changed. |

No new background access requests or notifications are sent. There is no
automatic retry of source grants after a failed or uncertain confirmation.

### Public links

The existing **Anyone with the link** section remains separate. It has a concise
warning, never a source opt-in or source-publication action:

- Doc: **This link shares only the document. Formulas that need other files are
  unavailable to link guests.**
- Space: **Sources in this Space are included. Sources outside this Space remain
  unavailable to link guests.**

Creating/replacing a host link never creates a source link or changes account
grants. Guest pages get no source inventory or account identities. Existing
whole-Space confirmation and immediate link revocation remain intact.

### Evidence required for implementation

Proposal screenshots use the actual theme, shared modal and controls with
clearly labelled fixture data. The prerequisite PR embeds current light/dark/phone
Sharing captures plus the proposed unchecked, explicit targets, external Space,
restricted, stale, partial and guest-link states. Independent review is **agent
review only** and does not claim the proposal implements authorization.

Implementation adds production stories for these states, source-only sharing,
existing stronger access, same-Space inheritance, check failure, pending and
uncertain results. Browser tests prove real grants and formula availability,
unchecked defaults, no implicit source grants, changed/revoked authority,
partial outcomes and public-link isolation. Actual current light/dark/phone
captures and independent theme/persona approval accompany its PR.

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
