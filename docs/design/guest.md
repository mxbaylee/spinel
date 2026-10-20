# Guest view

What a Link guest sees at `/share/<id>`: one document, no account, no workspace.

## How others do it

Google shows a "View only" chip near the top right with **Request edit access**,
and a full-page "You need access" screen with Request access and Switch account
when the link doesn't allow the person in. Microsoft and Zoho show a "View only"
or "Read only" label in the header with the same full-page fallback. Numbers
opens the document with a read-only banner.

## Spinel today

`GuestApp` shows "Spinel · Shared document", then the document name, a line
("You are editing as a guest." or "View-only link."), and the editor. Revoked
links and connection loss are plain paragraphs above it.

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
  decision [#103](https://github.com/mxbaylee/spinel/issues/103).
- No identity. Collaborators show as generic Guest/Collaborator labels with
  empty avatars and default colours (SPN-016). The connection slot (SPN-042)
  works as for everyone else.
- **No request-access button.** A guest has no account to grant access to, and
  the owner gives access by sharing a new link. The others' Request access
  pattern doesn't apply.
- **Link no longer works:** a [full-page state](states.md#full-page-states) with
  the gem, "This link no longer works.", "Ask the person who shared it for a new
  link." and no button. No document name, because the link may have been revoked
  to hide it.
- **Connection interrupted:** the connection slot, not a paragraph. The
  unsaved-edit warning on leaving stays.

### Always visible / behind a menu

| Always visible                                       | Behind a menu |
| ---------------------------------------------------- | ------------- |
| Name, status cluster, View only / Guest editor badge, Export as PDF (SPN-075) | Nothing       |

## Stories

`Guest/GuestApp` (loading and link-revoked states; the editor itself boots
Univer and is covered by Playwright).
