# Third-party notices

Code copied or adapted from other projects, with its source, license and what
changed. Dependencies installed from npm are not listed here; their licenses
ship with them.

| Path in Spinel | Source | License | Changes |
| --- | --- | --- | --- |
| `docs/reference/passkeys/passkey-names.ts` | [mxbaylee/circus-health](https://github.com/mxbaylee/circus-health) `src/server/passkey-names.ts` at `2ab77af` | MIT, © 2026 Baylee Schmeisser | Provenance comment added |
| `docs/reference/passkeys/passkey-provider-names.json` | circus-health `src/server/passkey-provider-names.json` at `2ab77af`, itself from [passkeydeveloper/passkey-authenticator-aaguids](https://github.com/passkeydeveloper/passkey-authenticator-aaguids) at `774b3cf` | MIT (circus-health); factual name mappings | None |
| Excerpts in `docs/reference/passkeys/README.md` | circus-health `src/server/profile-passkeys.ts` at `2ab77af` | MIT, © 2026 Baylee Schmeisser | PRF options removed; sign-in made discoverable |

When SPN-002 moves these into `src/`, update the paths here.

When adding an entry:

- Keep the original copyright and license header in each copied file.
- Add a line in the file saying it was modified for Spinel.
- List it here as: path in Spinel, source repository and commit, license, and a
  one-line summary of the changes.
