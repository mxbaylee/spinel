# Guest view

## SPN-047 composed redesign proposal

Approved by the owner, 2026-10-21, [decision #126](../implementation/SPN-047.md#legacy-decision-126-approved-redesign-and-its-limits). Production implementation remains separate.
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — GuestViewer, GuestEditor, RevokedLink, OfflineLaunch, PlannedSpaceGuest.

| Current friction                                                                                           | Public reference pattern                                                                                                                          | Adopted proposal                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Large stacked title/status text pushes content down; generic connection errors compete with editor status. | Google makes read-only state visible; Numbers groups collaboration status near content. Spinel deliberately has no guest request-access workflow. | A minimal document header with access badge, status and PDF export; no account rail or identity. |

Revocation removes content, title, actions and any source values, showing only the generic unavailable link message. An offline guest gets a generic connection state, not cached private content. A Space guest has only its internal page navigation and uniform View/Edit role; no outer folders, account controls, history, native export or file Admin.

The approved proposal above governs placement during implementation. Existing behavioral and
permission rules below still apply; production migrations remain separate tickets.

What a Link guest sees at `/share/<id>`: one document, no account, no workspace.

## How others do it

Google shows a "View only" chip near the top right with **Request edit access**,
and a full-page "You need access" screen with Request access and Switch account
when the link doesn't allow the person in. Microsoft and Zoho show a "View only"
or "Read only" label in the header with the same full-page fallback. Numbers
opens the document with a read-only banner.

## Spinel today

`GuestApp` uses the compact shared editor frame: a non-link gem, plain document
name, shared save/connection controls, bounded People disclosure, access badge
and theatre toggle. Authorized Doc formula controls remain available without an
account actions menu. Connection interruptions
use the fixed control's detail, preserving the mounted editor and pending-input
warning. An authoritative 401/403/404 removes document content and its title,
leaving only the generic link error. Guests make no account health/session probe
and receive no account navigation or identity. See [connection behavior](../connection.md)
and [decision #132](../implementation/SPN-042.md#legacy-decision-132-verified-connection-proof-and-stable-presentation).

## Adopted pattern

- The [editor header](editor.md#adopted-layout) without account parts: the gem
  (not a link), the document name as plain text, the status cluster, then a
  **View only** or **Guest editor** badge where Share would be. No rail, no
  breadcrumb and no More menu: versions and native/Office exports are account
  features. **Export as PDF** (SPN-075) is the exception: a plain button beside
  the badge downloads the same PDF as for accounts, with current read access.
  It adds no owner/account identity to the content or PDF metadata. Revocation
  removes the action and shows the revoked-link state; no printer dialog.
  This is planned behavior, authorized by the owner in chat on 2026-10-20,
  decision [#103](../implementation/SPN-075.md#legacy-decision-103-direct-pdf-for-every-current-reader).
- No identity. Collaborators show as generic Guest/Collaborator labels with
  empty avatars and default colors (SPN-016). The connection slot (SPN-042)
  works as for everyone else.
- **No request-access button.** A guest has no account to grant access to, and
  the owner gives access by sharing a new link. The others' Request access
  pattern doesn't apply.
- **Link no longer works:** a [full-page state](states.md#full-page-states) with
  the gem, "This link no longer works.", "Ask the person who shared it for a new
  link." and no button. No document name, because the link may have been revoked
  to hide it.
- Authoritative revocation also disposes a dirty guest editor, including native
  menus and keyboard handlers. Pending input remains only in inaccessible memory;
  show a generic unsaved warning, with no copy, export or recovery action. Network
  outages alone do not revoke access. Account draft recovery is unchanged.
  Owner chose immediate hiding, chat 2026-10-23;
  [decision](../implementation/SPN-084.md#dirty-space-guest-revocation-needs-a-privacyrecovery-decision).
- **Connection interrupted:** the connection slot, not a paragraph. The
  unsaved-edit warning on leaving stays.

### Always visible / behind a menu

| Always visible                                                                | Behind a menu |
| ----------------------------------------------------------------------------- | ------------- |
| Name, status cluster, View only / Guest editor badge, People, theatre toggle; Export as PDF remains SPN-075 | People details and authorized formula details |

## Stories

SPN-084's [implementation record](../implementation/SPN-084.md) preserves the generic
loading/offline/unavailable contract and its decisions. The owner chose
immediate hiding after revocation, including dirty Space guests. The native
Doc/Sheet regressions and revoked-unsaved story cover that behavior. Exact-commit
CI evidence and independent screenshot review are recorded in
[PR #180](https://github.com/mxbaylee/spinel/pull/180).

`Guest/GuestApp` (loading and link-revoked states; the editor itself boots
Univer and is covered by Playwright).

## Guest walkthrough refinements

Phone headers reserve a full row for document/Space identity, then show access,
connection/save state and a visibly labelled PDF action. Viewers see Connected
rather than Saved. Space navigation can collapse; a guest editor's Trash
confirmation explains that an account editor can recover the page, because
guests cannot open account-only Space trash.
