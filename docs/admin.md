# User and passkey administration

The Operator's `/admin` page lists every account, its admin/member role, whether
it is disabled, and its passkeys with provider, creation time and last use. It
also includes the existing invitation and recovery controls. Only metadata is
shown: administrators never gain access to documents, images, shares or history.
Non-admins, including signed-out callers, receive a not-found response for the
admin page and user/invitation administration APIs.

## Remove a passkey

Choose **Remove …**, read the confirmation and confirm. Cancel changes nothing.
The credential is deleted, its authenticated sessions end, and its open editors
are disconnected. A synced passkey can cover several physical devices; removal
applies to the credential everywhere it is used.

New sign-in, initial setup and invitation/recovery sessions record the verified
passkey ID. Existing sessions migrate with no attribution. Removing any passkey
also signs out that account's unattributed sessions, because retaining them
could leave the lost device signed in. Sessions attributed to other passkeys
remain valid. The SDK may briefly reconnect other editor tabs for the same user
because its eviction API is user-scoped; they can reconnect with their valid
session. Revoked tabs retain the existing copy-unsaved-changes warning.

Adding a passkey does not change which credential authenticated the current
session. An active admin's last passkey cannot be removed; add a replacement
first. A member's last key can be removed, then recovered through an invite.
Removing the key that authenticated your own session sends you to sign-in.

## Disable an account

Choose **Disable account** and confirm. Its sessions end and live editors are
revalidated before the API reports success. No user row is deleted: documents,
images, history, ownership and sharing grants remain. Other active collaborators
keep their existing access. Unused recovery invites for the disabled account and
unused invites it issued are revoked. Disabling your own admin account is
rejected, including through the API. A different active Operator can later
reactivate the account or transfer a disabled member's owned work as described below.

HTTP and live-edit boundaries still check current access on each request/commit;
the existing periodic connection revalidation remains in place. Revoking a key
while a sign-in or registration is being verified cannot create a replacement
session from the revoked ceremony.

## Reactivate an account

On a disabled account, choose **Actions → Reactivate**, read the consequences
and confirm. The account becomes active, with the same identity and admin/member
role. Documents, ownership, sharing grants, history and trash stay in place.
This action permanently invalidates old passkeys, sessions and pending sign-in
ceremonies, unused invitations, assistant connections, OAuth credentials and
personal access tokens. It never restores a previous credential.

Then create a **Recovery** invitation for that account using the existing Invites
section. No invite is created or sent automatically. The person registers a new
passkey through that invitation; transferred files do not return to them.

Reactivation preserves the same owner's deliberate document-sharing settings.
An otherwise active, unexpired guest link can work again once its owner is active.
A link already turned off or rotated stays invalid. Document links grant scoped
document access, not an account sign-in. This distinction is deliberate in
[decision #141](https://github.com/mxbaylee/spinel/issues/141); ownership handover
uses the stricter link invalidation below.

## Hand over a disabled member's work

Choose **Actions → Transfer ownership** on a disabled everyday account.
The dialog identifies the account and lists aggregate counts of non-folder
items, folders and existing guest-link records, including trash and internal
Space contents. It never shows document/folder names, item IDs, paths, snapshots,
image data or history. Select an active everyday recipient explicitly, then
confirm. Admins, disabled accounts and the same account cannot be recipients.

The recipient gets one private folder named after the departed account. Folder-
forbidden slash, backslash and control characters become spaces; an unusable
name falls back to **Transferred files**. Duplicate names remain separate through
stable IDs. An account with no owned work does not create an empty folder.

The complete handover is one database transaction:

- The source must still be disabled, the recipient eligible and the confirmed
  complete structural set current. Changed membership, ancestry, trash or link
  state require fresh details and another confirmation. Matching counts alone
  do not authorize a different set of files.
- All owned outer files and Space internal ownership move together. Only outer
  roots move beneath the new folder; stable IDs, Space hierarchy/order, native
  contents, images, Formula bindings, history, trash and recovery metadata stay.
- Existing third-party grants and valid private filing remain. The old owner
  retains no access to transferred work, even after recovery; redundant recipient
  grants/placements are removed. Private tags are not copied to another account.
- Every transferred guest link is turned off, its epoch advanced, its token and
  preview hashes cleared, and its old guest sessions removed. The new owner may
  deliberately enable a fresh link. Old URLs, cookies and previews never revive
  because the file acquired an active owner.
- Formula-source access is evaluated for the current person. Owning a transferred
  Doc does not grant access to a separately owned source used by its formulas.

The Operator path reads bounded structural metadata, not content. It refuses
malformed ancestry, mixed ownership, invalid Space recovery structure or more
than 10,000 owned rows without making a partial transfer. It also rechecks that
the recipient's existing rows, the complete incoming set and the new folder fit
the same 10,000-row budget, so an accepted handover cannot overflow discovery.
An over-capacity recipient is refused before any mutation. The existing ordinary
file and Space services remain the source of access and content behavior.

After commit, the API awaits live-connection revalidation. A failure inside the
transaction rolls everything back. A later connection-refresh failure cannot
undo a committed handover: its message explicitly says the ownership changed
(or account reactivated) and asks the Operator to refresh accounts. Current
request/write authorization still applies; refresh the accounts and confirmation
preview before retrying. A repeated handover cannot create another wrapper for
the already transferred set. [Decision #140](https://github.com/mxbaylee/spinel/issues/140)
records the confirmation, privacy and persona tradeoffs.

## API and storage

- `GET /api/auth/admin/users` returns account/passkey metadata, never
  key material, session hashes or document content.
- `POST /api/auth/admin/users/:id/disable` disables an account.
- `POST /api/auth/admin/users/:id/passkeys/:key/remove` removes a credential
  scoped to that user. Encode the credential ID as a URL path component.
- `POST /api/auth/admin/users/:id/reactivate` reactivates a disabled account
  after invalidating its old credentials; it does not create an invite.
- `GET /api/auth/admin/users/:id/transfer-preview` returns source/eligible
  recipient account metadata, aggregate `items`/`folders`/`links` counts and
  an opaque `confirmation` value, never document metadata.
- `POST /api/auth/admin/users/:id/transfer` accepts `targetId` and that current
  `confirmation`; it atomically hands over the complete owned set.

Mutations require a current admin session, the configured Origin and JSON.
The session schema adds a nullable credential foreign key idempotently; deleting
a credential cascades its attributed sessions and pending challenges. Account
removal deliberately uses `disabled=1` rather than deleting ownership rows.

[Decision #23](https://github.com/mxbaylee/spinel/issues/23) requires preservation
of document ownership on disable. [Decision #58](https://github.com/mxbaylee/spinel/issues/58)
records credential attribution, legacy-session handling and operator lockout
protection: safe revocation for the Operator, retained private documents for the
Owner, independent access for Collaborators and no new privilege for Link guests.

## Assistant connections and access tokens

The admin panel lists assistant connection and personal-token metadata (account,
client/token names, callback origin for connections,
creation, last use and revoked status). Secrets and document contents are never
shown. Each everyday account creates and revokes its own tokens from Settings;
disabling the account also blocks all its connections and tokens. Admin accounts cannot create a
document token. See [the MCP guide](mcp.md), decision
[#111](https://github.com/mxbaylee/spinel/issues/111).
