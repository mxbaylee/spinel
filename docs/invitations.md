# Invite people and recover access

Sign in as the Operator and open Admin. Choose **A new account**, choose an expiry
and select **Create invite**. The default is seven days; one hour, one day and
30 days are also available. Copy the link and deliver it to the intended person.
Spinel does not send email. The link is shown only when created; if it is lost,
revoke the unused invite and create another. The list shows expiry, status and
who accepted each invitation, with a revoke action for available invites.

The invitee opens `/invite?token=…`, enters their name and registers a passkey.
Only successful verification creates an everyday account and marks the invite
used by that account. Names are trimmed and limited to 80 characters. A missing,
used, expired or revoked invitation returns a plain message and creates no user.
Public account creation is unavailable; first-admin setup is the separate
[console-only process](setup.md). Signed-in users can add another passkey to
their own account through Settings.

## Recovery

Choose **Recover <name>** in Admin to create an invitation tied to an existing,
active account. The operator must identify the person before delivering this
capability. Successful acceptance preserves the account ID, name, role and its
document ownership. It replaces all old passkeys, revokes existing sessions and
invalidates other pending recovery links for that account. Until acceptance,
existing access is unchanged. Both screens explain these consequences.

Recovery never reactivates a disabled account, creates a duplicate account or
promotes an everyday user to admin. Admin recovery preserves its existing role;
it still requires an authorized admin to issue the link. There is no password or
public recovery bypass. Full user management belongs to SPN-005.

## Integrity and access

Tokens have 256 random bits; SQLite stores only their SHA-256 hashes, satisfying
the original minimum of 128 bits. List responses contain metadata, never token
hashes or plaintext links. All management routes require a current admin session;
everyday users receive 403 and signed-out callers receive 401.

The entry page uses no-store and no-referrer and removes the query from its
address before later requests. The original query necessarily reaches the HTTP
server, so proxies must not log invitation query strings. Subsequent requests
use JSON bodies and the configured-origin check. Bearer invitation links must
be treated as access credentials and shared only with the intended recipient.

Registration uses the same discoverable, user-verified WebAuthn settings as
[sign-in](authentication.md). Its five-minute challenge is bound to the browser
session and exact invitation. New invitations reserve an opaque user ID without
creating a user. The name shown in the passkey manager is fixed for that ceremony.
Recovery uses the existing user ID and excludes their old credential IDs.

After verification, a SQLite transaction checks invitation availability, expiry,
account status and challenge cancellation again. It creates or recovers the user,
writes the credential, consumes the invite and rotates the session together.
Concurrent acceptance has one winner. A credential-write failure rolls back
account creation or recovery, leaving the invite and previous access intact.

The hashed-token rule was chosen in grooming on 2026-10-17; recovery through an
invite tied to the existing account is SPN-004’s rule. Lifetime, copying and
successful-recovery behavior were recorded in
[decision #12](https://github.com/mxbaylee/spinel/issues/12). These choices give the
Operator explicit control, preserve the Owner’s identity and documents, avoid
duplicate accounts for the Collaborator, and keep Link guests out of the workspace
unless they receive and accept a valid invitation.

Unit tests cover expiry, reuse, revocation, binding, races, rollback and recovery.
Playwright uses separate admin, invitee and guest browsers against development and
production servers, including acceptance, reuse rejection, revocation, role
boundaries and recovery followed by passkey sign-in.
