# Admin

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
revoking an invite doesn't confirm. Accounts can't be re-enabled here
(docs/admin.md).

## Adopted pattern

- One page, sections in this order: **Users**, **Invites**, **Backups**, then
  **Server health** (SPN-032). Each section is a card with its heading and, at
  most, one primary action (Invites: **Create invite**).
- **Users:** a row per account: name, role badge (Admin/Member), status badge
  (Active/Disabled), and a More menu with Disable. There is no Enable: this
  interface doesn't reactivate accounts (docs/admin.md), so a disabled row's
  menu is empty and the button is hidden. Passkeys show under the row as a
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
| Section headings, Create invite                        | User More → Disable   |
| User name, role, status; passkey last use              | Passkey More → Remove |
| Invite expiry and kind; Copy link right after creation | Invite More → Revoke  |
| Backup and health status, last success, guide link     |                       |

## Gaps

`AdminUsers` and `AdminInvites` have no loading state: users render an empty
list and invites say "No invites yet." until the request returns, and an empty
user list is a bare heading. The next ticket that touches either adds a
"Loading…" status line and its story.

## Stories

`Admin/AdminUsers`, `Admin/AdminInvites`, `Admin/BackupStatus`. SPN-032 adds
`Admin/ServerHealth`.

## Assistant connection metadata (SPN-034)

**Connected assistants** and **Assistant access tokens** sections before Backups
reuse the read-only list pattern. Show client/token and account names, callback
origins for connections, creation, last use and revoked status; never secrets or
document details. No token creation or document access for the Operator.
`Settings/AssistantConnections` and `Admin/AccessTokens` cover loading, empty, metadata and failure states. See
[MCP](../mcp.md), decision [#111](https://github.com/mxbaylee/spinel/issues/111).
