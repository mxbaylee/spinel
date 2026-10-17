# Set up the first admin

Start the server, then run `npm run setup` **on that server** with the same
`DATABASE_PATH` and `APP_ORIGIN` as the running application. Locally, the defaults
are `data/spinel.sqlite` and `http://localhost:3000`. For deployment, set
`APP_ORIGIN` to the exact HTTPS tailnet hostname, with no trailing slash.
The setup script is `server/setup.ts`, run directly by the pinned Node version.

The command prints a one-time link valid for 30minutes. Open that link, choose
**Create admin passkey**, and complete your browser or password manager’s prompt.
A successful claim opens the Admin panel. Admin accounts cannot open the document
dashboard or view, edit or create documents, including through share links.
[Invite a separate everyday account](invitations.md) for that. Admin is the user’s
`is_admin` flag, not a separate credential type.

Only an instance with **zero users**, including disabled users, can be claimed.
Once any user exists, both the command and setup page/API refuse another claim.
Re-running the command before the instance is claimed replaces the previous link.
If a link expires or a page reload loses its secret, reopen the latest console
link, or run the command again. A cancelled/failed ceremony creates no account;
the link stays usable until its expiry or a successful claim.

Do not publish the printed link. The application never issues setup links over
HTTP. The private setup key appears only in console output and the link’s URL
fragment. The browser removes the fragment from history before making requests;
it sends signed proof of possession, never the private key itself. SQLite stores
only the public key and public selector. This preserves SPN-003’s rule that the
setup secret is only shown on the server console, never sent over the network
(grooming, 2026-10-17).

## Claim integrity

The console generates a fresh Ed25519 key with Node’s crypto API. The browser uses
Web Crypto to sign a domain-separated message containing the configured origin,
setup selector, challenge and exact registration response fields. Verification
requires that proof plus a valid WebAuthn registration with user verification.
The browser must support WebAuthn and Web Crypto Ed25519.

Ceremonies use the existing five-minute, single-use, session-bound challenge
lifecycle. The setup link itself lasts 30minutes. After asynchronous verification,
a SQLite write transaction rechecks the active link, its expiry, the challenge
and zero users. It then creates the admin and passkey, consumes setup and rotates
the session together. Concurrent claims have one winner; a failed credential write
rolls back the account too. No provisional admin can lock out a later valid claim.

This favours a recoverable bootstrap for the Operator, separate everyday identity
for the Owner, rejection of later hostile claims for the Collaborator, and no
workspace access for the Link guest. Recorded 2026-10-17 in
[decision #10](https://github.com/mxbaylee/spinel/issues/10). Admin/document
separation is the owner’s 2026-10-17 rule; future document and share endpoints must
enforce it on the server as well as in navigation.

Unit tests cover expiry, replacement, proof binding, disabled users, cancellation,
concurrent claims and transaction rollback. Playwright claims disposable instances
in development and production, checks the secret stays out of requests, signs
back in as admin, and confirms the page and CLI reject a second claim.
