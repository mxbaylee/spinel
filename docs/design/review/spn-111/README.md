# SPN-111 — actual maintenance views

These images come from the actual production application and independent Linux
recovery supervisor exercised by `e2e/maintenance.spec.ts`. The disposable
instance has synthetic accounts and document content, a real SQLite database,
and virtual passkeys. The screenshots contain no live account or recovery token.
Other Administration health values describe the disposable runner.

Desktop captures are 1280 × 900 CSS pixels. Phone captures are 390 × 900.
`light` and `dark` use the corresponding system theme; `phone` uses light.
The local browser is Chrome 156. Captures use the current production bundle,
reduced motion and viewport screenshots without image manipulation.

| State | Captures |
| --- | --- |
| Scheduled announcement and Operator card | `scheduled-light.png`, `scheduled-dark.png`, `scheduled-phone.png` |
| Notice form with an explicit repeated-time occurrence | `notice-time-choice-light.png`, `notice-time-choice-dark.png`, `notice-time-choice-phone.png` |
| Fresh-passkey pause confirmation | `pause-confirmation-light.png` |
| Paused state and expiring tab-held resume authority | `paused-light.png`, `paused-dark.png`, `paused-phone.png` |
| Expanded pending-work guidance | `paused-details-light.png`, `paused-details-dark.png`, `paused-details-phone.png` |
| Resumed state requiring a fresh Administration page | `resumed-light.png`, `resumed-dark.png`, `resumed-phone.png` |
| Actual Sheet with server-acknowledged, device-pending and unfinished native text | `native-pending-light.png` |

The browser journey also verifies that a clean downloaded Sheet refreshes its
saved base and fully reloads into the resumed epoch; pending work remains in the
old mounted editor instead. Independent visual findings and the exact reviewed
commit are recorded in [PR #206](https://github.com/mxbaylee/spinel/pull/206).
Approval is **agent review only** under the repository's standing delegation.

Set `SPINEL_MAINTENANCE_CAPTURE=1` when running the production maintenance
acceptance to refresh these files. Without it, screenshots stay in the test's
ordinary output directory. Storybook separately covers unavailable, draining,
expired/lost authority, failed, missed/cancelled notice and invalid-time states.
