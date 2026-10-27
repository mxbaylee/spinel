# Sharing

## SPN-047 composed redesign proposal

Approved by the owner, 2026-10-21, [decision #126](../implementation/SPN-047.md#legacy-decision-126-approved-redesign-and-its-limits). Production implementation remains separate.
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Sharing, PlannedFileAdmin.

| Current friction                                                                                                | Public reference pattern                                                                                    | Adopted proposal                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Per-person Apply buttons and multiple guest-link actions compete with the people and permissions being changed. | Google separates people from general access; Numbers illustrates collaboration options grouped in one menu. | One dialog: people first, guest links second; access choices beside the relevant person. |

Retain No direct access and inherited-access explanation. Direct-access choices are staged until Apply access; pending and failed changes preserve confirmed access and the selected draft. Success confirms in place, and failure offers retry. Guest links retain role selection, creation, once-only copy, replacement confirmation and turn-off; the SharingCreatedLink, SharingExistingLink, SharingReplaceLink and SharingError stories make those states reviewable. Do not reveal an inaccessible parent name. SPN-079 implemented File admin; its approved PlannedFileAdmin choices apply to account grants and are never offered to guests.

This records the original composed proposal. The owner's 2026-10-27 request for
a simpler dialog supersedes its composition and verbosity through the
[People and Link refinement](../implementation/SPN-076.md#simpler-people-and-link-sharing)
below. Existing permission, confirmation and privacy rules remain in force.

## How others do it

|             | Google                                                              | Microsoft                                      | Apple Numbers                       | Zoho                  |
| ----------- | ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------- | --------------------- |
| Invite      | Field for people at the top, role next to it                        | "Add people" field plus permission             | Collaborate: invite plus permission | Email field plus role |
| People list | Each person with a role dropdown; Remove access is in that dropdown | Per-person permission dropdown, "Stop sharing" | Per-person options                  | Per-person role menu  |
| Link        | "General access" section below people, then Copy link               | "Anyone with the link" settings, Copy link     | "Anyone with the link" option       | Link sharing section  |

The shared pattern: one dialog, people first, link second; a role dropdown per
person with removal inside it; one Copy link action.

## Baseline before the SPN-076 refinement

`Sharing` owns one Base UI dialog for account access and guest links. The server
returns only the other everyday accounts whose direct grants the current Owner
or File admin may manage; protected ownership and the actor's own grant are not
editable. People appear first, with No direct access / Can view / Can edit /
File admin, confirmed effective access and an explicit Apply access action.
Guest links follow for Sheets, Docs and whole Spaces. Folders have no guest links.
The implementation is recorded in [SPN-081](../implementation/SPN-081.md);
its verification status is separate from the approved design.

## Adopted pattern

**2026-10-27 · Accepted composition refinement; implementation pending.** The
owner asked: “The share dialog is confusing with a ton of stuff. Can we simplify
it? Less text and buttons more abstraction of the common paths”. The
[decision record](../implementation/SPN-076.md#simpler-people-and-link-sharing)
preserves provenance, alternatives and all four persona effects. This refinement
supersedes the stacked composition from [PR #199](https://github.com/mxbaylee/spinel/pull/199),
not its source-sharing or privacy contract.

Use one [dialog](README.md#dialog) titled **Share \<name\>**, with its existing
header close control and visible **People** / **Link** tabs. People is the
default. Folders have People only. There is no redundant Done button, invite
field or separate source-sharing wizard.

### People

- Show compact rows with each person's name and **confirmed effective access**.
  The owner remains read-only; ownership and the actor's own direct grant stay
  protected. Clicking an editable row opens the only inline editor. Collapsed
  rows never show a proposed role as confirmed.
- The editor contains No direct access / Can view / Can edit / File admin.
  Explain inheritance only when it affects this person's outcome, for example
  **Can edit through a folder**. Never name an inaccessible folder. File admin
  help belongs beside that choice when relevant, not in a permanent paragraph.
  Disabled accounts are labelled and can lose direct access but cannot be granted.
- When sharing a host Space, show its scope once in the active People editor
  before Share / Save changes: **Applies to every current and future page and
  folder in this Space.** This is separate from any proposed external source Space.
- Keep **one active draft**. Cancel, switching recipients or switching tabs
  discards the short unsaved edit and clears source consent. Opening another
  host does the same. Returning begins from current confirmed access and a fresh
  source review; there is no hidden map of staged recipient changes.
- The default People footer has only **Copy account link**. While editing, hide
  Copy and place **Cancel** plus one primary action immediately at the end of
  the active recipient editor, before any later person rows: **Share** when the
  recipient has no effective access, or **Save changes** when they already have
  access. That action saves this recipient's direct host role and any
  explicitly selected source additions. Source-only sharing remains actionable
  when the host role is unchanged. Header close dismisses the dialog.
- Complete success collapses the editor to the confirmed row, announces one
  concise status and returns focus to that row. Partial or uncertain results
  stay in the same editor with one concise status and the same controls. There
  are no permanent extra Retry access or Review remaining sources buttons.

Selecting a role never writes immediately. During either account or link writes,
disable tab/recipient switching, editing, duplicate submission and dismissal.
Keep confirmed access visible. Outside pending writes, closing discards the
active draft without changing access. Copy failure exposes a selectable account
address through the existing fallback.

### Link

Keep account and guest links distinct. The Link tab contains guest audience,
confirmed access and the concise scope/source limit that matters to this item.
When off, show the role choice and **Create link**. When enabled, show the
confirmed role and either the freshly created address with **Copy guest link**,
or a clear **Replace link…** action. The role is editable only while creating
or replacing a link. **Turn off** belongs in the contextual More menu.

Preserve replacement confirmation: **The old link stops working at once, and
anyone using it loses access.** Space creation confirms access to every current
and future page and folder; Space turn-off confirms loss of that entire scope.
A replacement ends old guest sessions immediately. Repeated File admin, session
lifetime and social-preview prose belongs in contextual details or maintained
documentation, not alongside every common action. Keep the relevant identity
privacy explanation discoverable without repeating it in People.

Keep the Link controller mounted while changing tabs so a newly created,
once-only address survives a trip to People. Hide the inactive panel from both
keyboard navigation and assistive technology. Never recover the secret through
a read request or retain it after the owning dialog closes.

Select options say **Can view** / **Can edit**; confirmed roles elsewhere use
**View only** / **Can edit**. Owners and File admins may open Share; Viewers,
Editors and guests have no account-sharing controls. File admin is never a
guest-link role.

### Information by context

| Context | Visible information and action |
| --- | --- |
| People overview | Names, confirmed roles, Copy account link |
| One recipient editor | Role choice and source summary, followed immediately by Cancel and Share / Save changes before later person rows |
| Checked source addition | Every exact proposed target marked Can view · Proposed; whole-Space consequences |
| Enabled guest link | Confirmed role, fresh Copy guest link or Replace link…; More → Turn off |
| Exceptional state | One relevant explanation and only the recovery action needed now |

## Formula sources (SPN-076 design prerequisite)

The original [PR #199](https://github.com/mxbaylee/spinel/pull/199) established the
permission and review contract. The refinement places source review only inside
the active recipient editor, immediately before its action row. It needs no extra
Formula sources heading. Its original
[recipient review decision](../implementation/SPN-076.md#explicit-recipient-source-review)
remains authoritative for source scope and privacy. The simpler composition must
land as a design prerequisite before its new dialog implementation.

Sharing a Doc alone leaves every source permission unchanged. A formula with
any inaccessible input retains the SPN-033 unavailable state, never a saved value
or partial aggregate. See [formulas.md](formulas.md).

### Review and confirmation

1. Only the active recipient triggers source review. Bind the response to the
   current host, recipient and staged role; a response for an earlier editor
   cannot restore source consent. Discover direct formula references from the
   current committed Doc, deduplicated by stable identity.
   Sharing a Space reviews all live Docs inside it, consistently from dashboard
   or editor. Sharing always acts on the outer Space, never a child grant. Do
   not traverse source formulas or include unrelated documents. Bound discovery
   and refuse an incomplete review instead of silently truncating it; never use
   a stale legacy checkpoint after native activation.
2. Offer **Include formula sources**, unchecked by default, only where
   eligible source targets lack recipient access and the proposed host access
   allows the recipient to read the report. The full label is a 44 px touch
   target. A null direct host role can still preserve inherited host access.
   The unchecked inventory uses a native disclosure instead of a permanently
   expanded list. For known missing source access, its visible summary says
   **Some formulas won’t work without source access.**
3. Checking automatically exposes **every exact authorized proposed grant name**
   and **Can view · Proposed** before Share / Save changes. Keep this list visible
   while checked. Already accessible sources and their current roles may remain
   in a collapsed detail or brief summary; their direct/inherited access and
   ownership receive no redundant write. Confirmed viewer access remains
   **View only**. An unchanged host role can still save explicit source additions.
4. Use one short warning for unresolved sources. Readable sources that the actor
   cannot share may explain that their Owner or File admin must act. Unreadable,
   missing or undiscoverable dependencies disclose no name, identity, parent,
   saved expression label or private count. Inability to review them makes no
   claim about the recipient's actual access. Exclude them from proposed grants
   and never imply that every formula will become available.
5. Same-Space sources need one sentence, **Sources in this Space inherit access**,
   with no checkbox or child grant for those sources. Group external Space
   sources by the actual outer grant target. Before saving a checked addition,
   visibly show its authorized Space name, every exact source Sheet, **Entire
   Space**, and **Can view every current and future page and folder in this
   Space**. Kept/included details may be brief; a proposed whole-Space disclosure
   cannot be hidden. Never fabricate a child grant.
6. Share / Save changes confirms the staged host role and, only if checked,
   those exact source targets. Recheck current host/source authority, recipient access,
   dependency identity and Space membership before mutation. Source grants can
   only add Can view where access is missing; never downgrade or add editing.
   A changed dependency set, name or grant boundary refreshes review and clears
   opt-in before granting sources. Never silently expand a Sheet into a whole Space.

### Loading, changes and outcomes

Use the existing muted/status/error patterns, a bounded source section and
wrapping rows. Source consent clears on editor, recipient, tab, host or role
changes, after an error, and when a material source preview is replaced. A new
editor starts with a fresh review. Keep the single draft and confirmed access
distinct while a pending mutation disables navigation and dismissal.

| State | Message and next action |
| --- | --- |
| Checking | **Checking sources…**; no opt-in until the current review succeeds. |
| Check failed | One short warning and a conditional **Retry source check**. Host-only sharing remains possible with an explicit source-check warning. |
| Source list or boundary changed | **Formula sources changed. Review the updated list before sharing them.** Show the refreshed list, unchecked. |
| Source authority revoked | Explain that the Owner or File admin must grant access, using only currently authorized names. Never reuse the stale name as proof of authorization. |
| Complete | Collapse to the confirmed row, announce one concise status distinguishing host/source outcomes, and return focus. Only confirmed grants are described as shared. |
| Partial success | Keep the editor open with one concise status; retain confirmed grants and distinguish remaining access in the refreshed review. Another attempt uses this editor and its single primary action after a new opt-in. |
| Response lost | Keep the editor open: **Could not confirm the update. Review current access and try again.** Refresh actual permissions before claiming an outcome; never claim that nothing changed solely because the response was lost. |

After an uncertain response, if the selected direct role equals the refreshed
confirmed role and source inclusion is unchecked, **Save changes** stays disabled.
It becomes actionable only for a real role change or a fresh opt-in to an eligible
reviewed source addition. Keeping the editor open does not enable a no-op retry.

No new background access requests or notifications are sent. There is no
automatic retry of source grants after a failed or uncertain confirmation.

### Public links

The **Link** tab carries a concise source-scope warning, never a source opt-in or
source-publication action:

- Doc: **Shares this document only. Formulas using other files are unavailable to guests.**
- Space: **Includes sources in this Space. External sources remain unavailable to guests.**

Creating/replacing a host link never creates a source link or changes account
grants. Guest pages get no source inventory or account identities. Existing
whole-Space confirmation and immediate link revocation remain intact.

### Keyboard, focus and panel lifetime

Use actual text-labelled tabs with tab/panel relationships and keyboard
navigation, not appearance's icon-only radio segments. Inactive panels are
properly hidden. Keep the Link controller mounted for its once-only URL and
disable both tabs while either write is pending. A compact person row is a
named keyboard-operable control; do not nest the inline form inside that button.
Opening focuses the editor, Cancel/success returns to the person's row, and
closing returns to the original Share trigger. Preserve visible focus and 44 px
touch targets. A disclosure's summary is separate from its checkbox. If a refresh
removes a focused control, move focus to a persistent control in the active editor.

### Evidence required for implementation

Proposal screenshots use the actual theme, shared modal and controls with
clearly labelled fixture data. The superseding prerequisite PR shows the compact
People overview, one active editor, checked exact targets, external Space,
unresolved/partial states and the Link view in light, dark and phone contexts.
PR #199's earlier composition remains historical evidence. Independent review
is **agent review only** and does not claim a proposal implements authorization.

Implementation adds production stories for these states, source-only sharing,
existing stronger access, same-Space inheritance, check failure, pending and
uncertain results. Browser tests prove real grants and formula availability,
unchecked defaults, no implicit source grants, changed/revoked authority,
partial outcomes and public-link isolation. Add recipient/tab/cancel draft reset,
focus return, keyboard tabs, pending navigation guards, checked disclosure and
once-only guest address retention across tabs. Actual current light/dark/phone
captures and independent theme/persona approval accompany the implementation PR.

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
