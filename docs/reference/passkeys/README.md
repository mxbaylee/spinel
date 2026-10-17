# Passkeys: what to reuse from circus-health

Starting material for [SPN-002](../../todo/SPN-002.md). Circus-health's passkeys
work with browsers' built-in passkeys, 1Password and Proton Pass. SPN-002 moves
what it uses into `src/` and deletes this folder in the same PR.

Source: [mxbaylee/circus-health](https://github.com/mxbaylee/circus-health) at
`2ab77af`, written by Spinel's owner, so it isn't listed in the third-party notices.

## Copied as-is

- `passkey-names.ts`: turns an authenticator's AAGUID into a provider name ("1Password",
  "Proton Pass", "iCloud Keychain", "Windows Hello" and so on). It also picks a unique default
  name ("1Password 2"). Use it for the device list in SPN-002 and SPN-005.
- `passkey-provider-names.json`: 56 AAGUID → name mappings, taken from
  [passkeydeveloper/passkey-authenticator-aaguids](https://github.com/passkeydeveloper/passkey-authenticator-aaguids)
  at `774b3cf`. The name is only a display hint, never a trust signal.

The `.ts` file imports the JSON with `with { type: 'json' }`. That needs Node 22+ and
`resolveJsonModule` in tsconfig.

## Not copied: the PRF parts

Circus-health uses passkeys to **decrypt** a vault, through the WebAuthn PRF
extension. That was the source of nearly all its cross-provider trouble (see its
CRS-236). Spinel only **signs in**, so leave out everything PRF-related:
`passkey-prf.ts`, `withBinaryPrf`, `prfFrom`, salts, key wrapping, and the second
"confirm" ceremony. Without PRF, a passkey is accepted as soon as its
registration response verifies.

## Settings to keep

From `src/server/profile-passkeys.ts`:

```ts
// Registration
const options = await generateRegistrationOptions({
  rpName: 'Spinel',
  rpID,                                   // the hostname, never an IP (below)
  userName,                               // shown in the password manager's list
  userID: Buffer.from(userId),            // opaque and stable; not the email
  attestationType: 'none',                // don't ask for attestation; it filters out providers
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  excludeCredentials: user.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
});

// Verification of either ceremony
await verifyRegistrationResponse({
  response, expectedChallenge: challenge.challenge,
  expectedOrigin: challenge.origin, expectedRPID: challenge.rpID,
  requireUserVerification: true,
});
```

For sign-in, circus-health passes `allowCredentials` for a known profile. Spinel's
sign-in page doesn't know the user yet, so **leave `allowCredentials` empty**. The
browser or password manager then offers every Spinel passkey it holds (a
discoverable sign-in):

```ts
const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
```

## Behaviour to keep

- **Hostname, not IP.** Passkeys can't be created on an IP address. Refuse with
  guidance ("open http://localhost:PORT" in development, or the Tailscale hostname).
  See `registrationOptions` in the source.
- **Challenges:** random 32-byte IDs, single use, 5-minute expiry, at most 1,000 live
  (return 429 past that), and each tied to the session that asked for it. Mark a
  challenge used when it is taken, and delete it when verification finishes. See `add`,
  `take`, `assertPending` and `finish`.
- **Counter compare-and-set.** After verifying, re-read the stored credential. Fail
  with "try again" if its counter changed in the meantime, then write `newCounter`.
  Many synced passkeys always report 0; that is fine, since 0 → 0 passes.
- **Store `transports`** from registration and pass them back in
  `excludeCredentials`. It helps phones and security keys find the credential.
- **Cancelling.** When the user backs out, call `WebAuthnAbortService.cancelCeremony()`
  in the browser and tell the server to drop the challenge. Don't make the cancel
  depend on the network succeeding. See `passkey-enrollment.ts` and `passkey-unlock.ts`.
- **Errors in plain words:** "Passkey request expired. Try again." and "This passkey
  was already removed. Refresh the list." Don't show raw WebAuthn error names.

## Testing

Circus-health's mocked verification and virtual-authenticator tests did not prove that
real 1Password, Proton Pass or hardware keys work. SPN-002's Verify asks for one
manual sign-in with each provider the owner uses.
