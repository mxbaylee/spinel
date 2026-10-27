# Admin

## SPN-047 composed redesign proposal

Approved by the owner, 2026-10-21, [decision #126](../implementation/SPN-047.md#legacy-decision-126-approved-redesign-and-its-limits). Production implementation remains separate.
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Admin, AdminLoading, AdminError.

| Current friction | Public reference pattern | Adopted proposal |
| --- | --- | --- |
| Nested passkeys, invites, connections and backups create a long page with repeated destructive controls. | The applicable pattern is grouped navigation and contextual actions from Dropbox/Notion; consumer editors offer no evidence for Spinel’s content-blind Operator permissions. | Administration section navigation: People, Invites, Connections, Backups & health. |

This proposal supersedes the earlier stack of equal cards. People rows disclose passkeys and destructive actions; confirmations retain their consequences. Backups/health show text status, timestamps and recovery guidance. Verification results remain a separate SPN-063 delivery; this screen does not invent them. Loading never masquerades as an empty list. Server Operator remains content-blind and distinct from delegated file Admin.

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

`/admin` uses the compact utility header and four sections: People, Invites,
Connections, and Backups & health. People rows expose account menus; Manage
passkeys opens a focused dialog with credential metadata and per-passkey menus.
Disable/removal and the landed SPN-064 Reactivate/Transfer flows preserve their
consequences and server safeguards. Invites creates an address once, keeps its
manual-copy fallback while that section remains open, and discards it on leaving.
Connections shows read-only assistant metadata with token activity in a disclosure.
Health retains existing backup facts and adds measured memory, connections,
physical storage and actual job status. Diagnostics offers download and confirmed
clear; its runtime/visual validation is tracked in
[SPN-032](../implementation/SPN-032.md). Restore verification remains SPN-063.
See [the section lifetime decision](../implementation/SPN-082.md#section-lifetime-and-recovery-handoff).

## Adopted pattern

- One page with section navigation: **People**, **Invites**, **Connections**,
  **Backups & health**. On phones the navigation wraps into two columns, keeping
  all sections visible. The shared compact header retains appearance and profile.
- **People:** a row per account with name, Operator/Member role, Active/Disabled
  status, passkey count and contextual actions. Manage passkeys reveals provider,
  creation and last use. Each passkey has a More → Remove menu. Active accounts
  retain Disable; disabled accounts offer Reactivate, and disabled everyday
  accounts additionally offer Transfer ownership. Protected actions remain
  disabled with visible explanations. Create recovery invite explicitly hands
  an active account to the invitation dialog after refreshing eligible recipients.
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
| User name, role, status, passkey count              | Manage passkeys → passkey More → Remove |
| Invite expiry and kind; Copy link right after creation | Invite More → Revoke  |
| Backup and health status, last success, guide link     |                       |

## Account recovery and handover

SPN-064 supplies the landed recovery controllers; SPN-082 preserves them in
the section layout. See [the behavior and privacy contract](../admin.md).

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

The [standing delegation](../implementation/grooming-2026-10-26.md#agent-decisions-and-visual-review)
requires an independent subagent to inspect the actual light/dark/phone images
embedded on the PR against the theme and all four personas. Record findings,
visual approval and **agent review only**. This supersedes the earlier Pages-first
run restriction; code, access and CI requirements remain.

## Loading and failure states

`AdminUsers` and `AdminInvites` show an explicit loading status until their
requests complete. Failed loads offer a retry; an empty state is shown only
after a successful empty response. Refreshing an account after reactivation also
loads fresh recovery-invitation recipients when the Operator explicitly opens Invites.

## Stories

`Current production/Admin/Administration`, `AdminUsers`, `AdminInvites`,
`AdminAccountRecovery` and `BackupStatus`. SPN-032 adds
`Admin/ServerHealth`.

## Diagnostics handoff (SPN-032)

Owner direction, 2026-10-22; [scope and rationale](../implementation/SPN-032.md).
SPN-032 delivered diagnostics; its implementation record preserves the observed
verification. Further visual changes follow the standing independent review policy. Health cards retain aggregate status
and guidance. See the [operator guide](../diagnostics.md) for measurement meaning.
Add **Download diagnostics** and **Truncate diagnostics** to Backups & health;
there is no query UI, log browser or SQL console. Download produces a standalone
diagnostics SQLite snapshot for local analysis. Automatic records can contain
user/file IDs and route templates, never document names/content or credentials. This identifier-only
export is the scoped exception to the earlier counts-only health rule.

Download is the visible action; Truncate belongs behind the contextual menu and
uses the existing destructive confirmation pattern. Explain that it clears
diagnostics only, cannot be undone, does not delete files, and collection resumes.
Mention that submitted user feedback is also deleted and its user-list flags reset;
new reports may appear afterward. Show database size/growth and WAL usage for
application/collaboration and diagnostics storage, without counting shared files twice,
alongside volume free space. A cleared store need not physically shrink immediately.
Show pending, failed and completed states without implying failed work succeeded;
cancel is safe and focus returns to the surviving control. A download failure
offers retry without promising an existing artifact. Include light/dark/phone
stories and independent theme/persona screenshot review on the implementation PR.

## User feedback handoff (SPN-098)

Owner direction, 2026-10-22; [scope and rationale](../implementation/SPN-098.md).
Production work is pending. An everyday account's menu opens a short feedback
dialog using existing form/status patterns, explaining that the message and page
context go to the server Operator. Submission success requires persistence; keep
the draft on failure and prevent duplicate submissions while pending.

The admin user list shows an accessible **Feedback available** flag when stored
feedback exists for that user. It is not an unread/resolution badge and does not
open a query panel or feedback inbox. The Operator reads the downloaded SQLite
file. Missing/failed flag data stays visibly unknown. Truncate diagnostics clears
feedback too, then refreshes these flags. Add light/dark/phone stories for the
dialog and absent/present/loading/failed flags for independent theme/persona review on the implementation PR.

## Assistant connection metadata (SPN-034)

**Connections** contains **Connected assistants**, with **Personal access token
activity** behind a disclosure. Both reuse the read-only list pattern. Show client/token and account names, callback
origins for connections, creation, last use and revoked status; never secrets or
document details. No token creation or document access for the Operator.
`Settings/AssistantConnections` and `Admin/AccessTokens` cover loading, empty, metadata and failure states. See
[MCP](../mcp.md), decision [#111](../implementation/SPN-034.md#legacy-decision-111-owner-requested-mcp-through-oauth).

## Operator walkthrough refinements

Wrap phone section navigation so Backups & health is always discoverable.
Create invite belongs in Invites, followed by a once-only address, Copy and
manual-copy fallback. Account actions name the target in confirmation; the
Operator's protected account is visibly restricted. Passkey details and overdue
backup examples are composed states, not just success notices. The compact
utility header avoids a second permanent navigation column.
