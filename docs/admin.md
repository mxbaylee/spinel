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
rejected, including through the API. This interface does not reactivate accounts.

HTTP and live-edit boundaries still check current access on each request/commit;
the existing periodic connection revalidation remains in place. Revoking a key
while a sign-in or registration is being verified cannot create a replacement
session from the revoked ceremony.

## API and storage

- `GET /api/auth/admin/users` returns account/passkey metadata, never
  key material, session hashes or document content.
- `POST /api/auth/admin/users/:id/disable` disables an account.
- `POST /api/auth/admin/users/:id/passkeys/:key/remove` removes a credential
  scoped to that user. Encode the credential ID as a URL path component.

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
