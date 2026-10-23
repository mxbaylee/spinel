# Admin

## SPN-047 composed redesign proposal

Approved by the owner, 2026-10-21, [decision #126](https://github.com/mxbaylee/spinel/issues/126). Production implementation remains separate.
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Admin, AdminLoading, AdminError.

| Current friction | Public reference pattern | Adopted proposal |
| --- | --- | --- |
| Nested passkeys, invites, connections and backups create a long page with repeated destructive controls. | The applicable pattern is grouped navigation and contextual actions from Dropbox/Notion; consumer editors offer no evidence for Spinel’s content-blind Operator permissions. | Administration section navigation: People, Invites, Connections, Backups & health. |

This proposal supersedes the earlier stack of equal cards. People rows disclose passkeys and destructive actions; confirmations retain their consequences. Backups/health show text status, timestamps, last good verification and recovery guidance. Loading never masquerades as an empty list. Server Operator remains content-blind and distinct from delegated file Admin.

The approved proposal above governs placement during implementation. Existing behavioral and
permission rules below still apply; production migrations remain separate tickets.


The Operator's screens: users and passkeys, invites, backups, and server health
(SPN-032). Admins can't see documents (SPN-003), so nothing here shows a title,
name or content.

## How others do it

Google Workspace, Microsoft 365 and Zoho admin consoles all use a users table
with one row per person, status as text, and a per-row More menu holding
Suspend/Block, Reset sign-in and Delete. Signing a person out everywhere lives
on the person's detail page. Health dashboards are read-only cards with a status
word, a timestamp and a link to the guide. Apple has no comparable console for
Numbers.

## Spinel today

`/admin` shows Users and passkeys, then Invites (rendered inside `AdminUsers`),
then Backups. Each user is a list item with its passkeys nested underneath (each
with its last use), a Disable button and a Remove button per passkey. Disabling
and removing confirm in a modal `<dialog>` with the consequence spelled out;
revoking an invite doesn't confirm. SPN-064 adds a disabled account's contextual
Reactivate and Transfer ownership actions using the shared modal/choice patterns
below. The complete section-navigation migration remains SPN-082.

## Adopted pattern

- One page, sections in this order: **Users**, **Invites**, **Backups**, then
  **Server health** (SPN-032). Each section is a card with its heading and, at
  most, one primary action (Invites: **Create invite**).
- **Users:** a row per account: name, role badge (Admin/Member), status badge
  (Active/Disabled), and contextual actions. Active accounts retain Disable;
  disabled accounts offer Reactivate, and disabled everyday accounts additionally
  offer Transfer ownership. Passkeys show under the row as a
  compact list, each with its last use in the muted column and its own More menu
  → Remove. The rules that block an action ("This is your admin account. It
  cannot disable itself.") show as the menu item's disabled reason, not as a
  hidden item.
- **Confirmations** stay modal dialogs with today's full sentences; they are the
  right length for something that ends sessions. Revoking an invite stays
  unconfirmed: it is cheap to redo.
- **Invites:** a row per open invite with its expiry and kind (New account /
  Recovery), More → Revoke. Copy invite link is visible only right after
creation, with the manual-copy fallback.
- **Backups and health:** read-only cards. Each states one status word with an
  icon (OK, Overdue, Running, Not configured), the last success time, and a link
  to the guide in docs/. Counts and sizes only.

### Always visible / behind a menu

| Always visible                                         | Behind a menu         |
| ------------------------------------------------------ | --------------------- |
| Section headings, Create invite                        | Account actions → Disable / Reactivate / Transfer ownership |
| User name, role, status; passkey last use              | Passkey More → Remove |
| Invite expiry and kind; Copy link right after creation | Invite More → Revoke  |
| Backup and health status, last success, guide link     |                       |

## Account recovery and handover

SPN-064 implements these existing confirmation patterns without moving the whole
administration screen. See [the behavior and privacy contract](../admin.md).

**Reactivate** names the account and explains that existing documents/shares stay
but old passkeys, sessions and assistant credentials do not return. A recovery
invite is the next separate action. The resulting notice and refreshed recipient
list must make that next step clear; no invitation is silently generated or sent.

**Transfer ownership** names only source and recipient accounts. Its preview
shows aggregate items/folders/links, explicitly including trash and internal
Space contents. It never lists document names, paths or item identities. The
recipient begins unselected; eligible choices are active everyday accounts.
Explain the new private containing folder, retained contents/history/trash/grants,
old-owner loss of access and old guest links staying off. These are consequences
the Operator needs to make a meaningful choice, not implementation details.

Both flows have cancel, pending, failed and completed states. Transfer additionally
covers preview loading/retry, no owned content, no eligible recipient and stale
confirmation. A stale preview requires refreshed details and a fresh confirmation.
An error after a committed mutation must say the change happened and refresh the
current state; never imply an unconfirmed rollback. Disable repeat submissions
while pending, keep Escape/Cancel safe before submission, and restore focus to a
surviving control when an account action disappears.

Use existing shared semantic icons, modal, action menu and choice controls, theme
tokens and 44px phone targets. Long account names must wrap without obscuring
actions. Loading is a status, never an empty-list message. Stories cover the actual
components with API fixtures; browser evidence separately proves real transfer,
native opening and invitation recovery.

The authorized Pages-first run permits an independent subagent to approve the
actual light/dark/phone UI/UX across all four personas. Such merges explicitly
state **agent review only**, per the owner's 2026-10-21 instruction and
[decision #139](https://github.com/mxbaylee/spinel/issues/139). This does not claim
human screenshot approval or waive any code, access or CI requirement.

## Loading and failure states

`AdminUsers` and `AdminInvites` show an explicit loading status until their
requests complete. Failed loads offer a retry; an empty state is shown only
after a successful empty response. Refreshing an account after reactivation also
refreshes recovery-invitation recipients.

## Stories

`Admin/AdminUsers`, `Admin/AdminInvites`, `Admin/BackupStatus`. SPN-032 adds
`Admin/ServerHealth`.

## Diagnostics handoff (SPN-032)

Owner direction, 2026-10-22; [scope and rationale](../implementation/SPN-032.md).
Production work is pending. Health cards retain aggregate status and guidance.
Add **Download diagnostics** and **Truncate diagnostics** to Backups & health;
there is no query UI, log browser or SQL console. Download produces a standalone
diagnostics SQLite snapshot for local analysis. It can contain user/file IDs and
route templates, never document names/content or credentials. This identifier-only
export is the scoped exception to the earlier counts-only health rule.

Download is the visible action; Truncate belongs behind the contextual menu and
uses the existing destructive confirmation pattern. Explain that it clears
diagnostics only, cannot be undone, does not delete files, and collection resumes.
Show pending, failed and completed states without implying failed work succeeded;
cancel is safe and focus returns to the surviving control. A download failure
offers retry without promising an existing artifact. Include light/dark/phone
stories and owner screenshot review when implementing these controls.

## Assistant connection metadata (SPN-034)

**Connected assistants** and **Assistant access tokens** sections before Backups
reuse the read-only list pattern. Show client/token and account names, callback
origins for connections, creation, last use and revoked status; never secrets or
document details. No token creation or document access for the Operator.
`Settings/AssistantConnections` and `Admin/AccessTokens` cover loading, empty, metadata and failure states. See
[MCP](../mcp.md), decision [#111](https://github.com/mxbaylee/spinel/issues/111).

## Operator walkthrough refinements

Wrap phone section navigation so Backups & health is always discoverable.
Create invite belongs in Invites, followed by a once-only address, Copy and
manual-copy fallback. Account actions name the target in confirmation; the
Operator's protected account is visibly restricted. Passkey details and overdue
backup examples are composed states, not just success notices. The compact
utility header avoids a second permanent navigation column.
