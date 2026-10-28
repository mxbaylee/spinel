# SPN-109 visual evidence

These are unaltered native browser captures from
`e2e/backup-downloads.spec.ts`, using the production build, Node 26.12.1 and
locally available Chrome 156.0.8078.47. The test runs a real server, a real
temporary SQLite workspace and a virtual WebAuthn authenticator; it prepares,
downloads and independently decrypts the actual encrypted archive. No cloud
destination or real account data is used. Capture date: 2026-10-28 UTC.

Desktop viewports are 1280 × 1000; phone viewports are 390 × 1000. The PNGs
capture the full page, so their height exceeds the viewport. `light` and `dark`
use the corresponding system theme; `phone` uses light mode. Server-health
values describe the local test host, not a production deployment.

| Image | State |
| --- | --- |
| [manual-policy-light.png](manual-policy-light.png) | Manual-only recovery, automatic backups and restore checks off. |
| [passkey-confirmation-phone.png](passkey-confirmation-phone.png) | Fresh Operator passkey confirmation on a phone viewport. |
| [ready-light.png](ready-light.png) | Prepared encrypted archive and primary Download action, light theme. |
| [ready-dark.png](ready-dark.png) | The same ready state in dark theme. |
| [ready-phone.png](ready-phone.png) | Ready state and wrapped touch actions on a phone viewport. |
| [browser-handoff-dark.png](browser-handoff-dark.png) | Actual native download handoff, with retention/offsite limits explicit. |
| [missing-key-light.png](missing-key-light.png) | Recovery key removed before a subsequent request; safe failure, no path or key leak. |

The design reuses the existing Admin health facts, disclosure, modal, primary
action and status patterns; these captures also show the proposed design.
The test additionally checks primary theme colors, no horizontal overflow,
44-pixel phone action targets and keyboard focus after cancellation. All five
states are captured in light, dark and phone views by the test; this folder
retains seven useful views for durable, commit-pinned PR embeds. CI artifacts
contain the complete capture set.

Independent visual findings, both rubric grades and their shared reviewed
commit belong to [PR #207](https://github.com/mxbaylee/spinel/pull/207).
**Agent review only.**
