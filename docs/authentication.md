# Passkeys and sessions

Spinel signs in with discoverable passkeys from a browser, password manager or
phone. Settings adds another passkey to the signed-in account and lists provider
names. [First-admin setup](setup.md) creates the initial admin; [invitations](invitations.md)
create everyday accounts. There is no public signup or password
fallback. Recovery is an Operator-issued invite. Sign-in does not use PRF or encryption key wrapping.
These are the owner’s SPN-002 rules, 2026-10-17.

SPN-053's [downloaded editors](offline.md) store no authentication response,
credential, session token, OAuth consent or guest capability. IndexedDB is
partitioned by the downloading account. The prepared-account pointer and local
cancellation epoch gate local access; they are not credentials. Same-tab
cancellation and another tab's sign-out/account switch close the old editor.
Offline refresh, preparation, socket tickets, image reads and Doc Formula
requests send `X-Spinel-Offline-Account`. The server rejects a different cookie
account before document access/404 checks; current document/Space access and
generation are still required. Delayed HTTP bodies and socket callbacks also
check the mounted epoch. A different account's 404 cannot delete the original
account's copy, and pending work remains bound to that account.

SPN-055 locks private access synchronously once departure is accepted, then shows
the original account's device-copy counts and explicit Keep/Delete choices. It
records a strictly validated, noncredential exit intent, never an authentication
response or cookie. Network failure keeps remote sign-out visibly unconfirmed;
only an actual HTTP 204 clears the exact matching intent. Normal, setup, invite,
recovery and assistant-connection entry all drain that barrier before beginning
new authentication. A later account/exit invalidates the old deletion capability.
Operators skip private inventory; unknown legacy intents preserve data without
inferring permission to inspect it.

Authentication transitions own their requests through response-body settlement.
Web Locks serialize them across tabs; without Web Locks, separate scoped operation
markers refuse overlapping or unknown transitions while permitting isolated online
passkeys. A dispatched passkey verification cannot be cancelled until its response
settles. Logout carries the expected original account, revokes only the matching
presented session and sends no `Set-Cookie`, so a delayed response cannot erase a
newer ceremony/session cookie. The server retains origin/JSON/`no-store` checks.
See [the account-exit decision](implementation/SPN-055.md#immediate-local-lock-and-truthful-deferred-logout).

Entry screens use the quiet single-task layout with one passkey action, explicit
pending/cancellation/retry feedback and shared Need help guidance. Help displays
Operator commands without running them. Setup, invitation validation and recovery
semantics remain distinct. Consent account switching preserves only the validated
opaque request ID through sign-out; arbitrary return URLs are never accepted.
An unbound request can continue from an Operator to an everyday account. Once an
everyday session has viewed consent, it remains bound to that session; after
signing out, start a fresh request from the assistant instead of transferring it
to another session or account.
See [SPN-083](implementation/SPN-083.md) for implementation and verification status.

## Access and storage

`APP_ORIGIN` is the exact HTTPS browser origin (no trailing slash); only
`http://localhost:PORT` is allowed for local work. Its hostname is the WebAuthn
relying-party ID, never the request Host header or an IP. Keep the hostname stable:
passkeys created on localhost cannot sign in at the deployed hostname.

Authenticated sessions live in SQLite for a fixed 30 days, anonymous ceremony
sessions for five minutes. Cookies are `__Host-spinel-session`, HttpOnly, Secure,
SameSite=Strict and Path=/; only SHA-256 hashes of random 256-bit tokens are
stored. Sign-in rotates the session. Sign-out deletes its row and challenges;
expiry, disabling a user or deleting their sessions takes effect on the next
request. Session lifetime is fixed, not extended on every read. New authenticated
sessions bind to the verified passkey; [admin revocation](admin.md) also signs out
unattributed legacy sessions and disconnects affected editors.

Ordinary pages redirect signed-out users to `/sign-in`. APIs return 401 with sign-in
guidance, and never document data; the frontend navigates to sign-in on an
expired session. Authentication POSTs require the configured Origin and JSON.
Authentication and protected API responses are not cached. Static frontend assets
are public and contain no document data. Invite/share access will be added only
through their tickets, with separate access checks. Admin accounts are sent to
`/admin` for user, passkey, invitation and backup administration. The admin page
and user/invitation administration APIs return 404 to non-admins.

The initial schema is in `src/server/auth/store.ts`: users, credentials, hashed
sessions and session-bound challenges. `createUser` is an internal seam for
first-admin/invite flows and test fixtures; it has no HTTP route. Credentials
store public keys, counters and transports. Provider names are display hints,
never evidence that an authenticator is trusted.

These choices favour revocation and a small SQLite footprint for the Operator,
reload persistence and clear recovery for the Owner, equivalent access for the
Collaborator, and a closed workspace boundary for the Link guest. Recorded
2026-10-17 in [decision #8](implementation/SPN-002.md#legacy-decision-8-passkey-bound-sessions).

## Reused reference behaviour

The circus-health reference at `2ab77af`, written by Spinel’s owner, supplied the
options and lifecycle below. Its unchanged naming helper and 56 AAGUID names now
live under `src/server/auth/`; the factual mapping source and revision remain in
that helper and [the notices](../THIRD-PARTY-NOTICES.md). The temporary
`docs/reference/passkeys/` folder has been removed.

- Registration uses `rpName: Spinel`, an opaque stable user ID, no attestation,
  required resident keys and user verification, and excludes the user’s existing
  credential IDs with their stored transports. It does not force an authenticator
  attachment, allowing phone and external-provider choices.
- Discoverable sign-in omits `allowCredentials`. Verification checks the challenge,
  configured origin, RP ID and user verification; sign-in also matches the returned
  user handle to the credential owner.
- Random 32-byte challenge IDs expire after five minutes; at most 1,000 are live.
  Each is tied to its requesting session and ceremony. Taking marks it used;
  finishing deletes it. Replays and cross-session use fail. Cancellation,
  revocation and expiry are checked again after asynchronous verification.
- Counter updates compare-and-set against the value used during verification;
  stale writes or removed credentials fail. Synced passkeys reporting 0 → 0 work.
- Cancel aborts the browser ceremony immediately and requests server cancellation
  without waiting for the network. Browser error names are translated to retry
  guidance. No PRF extension or second confirmation ceremony is used.

SimpleWebAuthn performs WebAuthn cryptographic verification; see its
[server documentation](https://simplewebauthn.dev/docs/packages/server) and
[browser documentation](https://simplewebauthn.dev/docs/packages/browser).

## Manual provider check

SPN-002 requires the owner to sign in once with a browser passkey, 1Password and
Proton Pass. Mocked verification and virtual authenticators cannot prove real
provider compatibility. Record each result and browser/provider versions in the
PR; missing or failed results block merging. Also check adding a passkey from a
phone if that is how the second device will be used.

Run `npm run passkey:check` in this branch. This separate script creates a
disposable database in the OS temporary directory and serves the built app only
on `127.0.0.1:3102`. It prints a random one-use localhost link valid for five minutes
that opens Settings already signed in as a fixture user. The application server
has no such link or environment-based authentication bypass. This fixture does
not touch `data/spinel.sqlite` and is not deployed.

1. Open the printed link in a browser with your passkey managers installed.
2. Add one passkey using the browser, one using 1Password and one using Proton
   Pass. Confirm the provider labels in Settings (some browsers return a generic
   AAGUID, displayed as “Passkey”; numbered names distinguish duplicates).
3. Sign out, sign in with the browser passkey, and reload the dashboard.
4. Repeat sign-out/sign-in with 1Password, then with Proton Pass.
5. Report each success or the exact visible error. Stop the fixture with Ctrl+C.
   Its printed temporary directory can be deleted afterwards; remove the test
   credentials from your managers when finished. They belong to this fixture.

Restarting the script creates a new fixture account, so use its latest entry link
and newly registered credentials. It cannot restore an earlier fixture session.
