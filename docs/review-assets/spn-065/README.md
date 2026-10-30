# SPN-065 visual evidence

These are actual production-editor captures, not mockups. Capture date:
2026-10-30. Application source: `de9a1432b07604d0313bad437f7a2bd5e016fada`;
the final review candidate retains identical application code. The capture/test
harness is `e2e/copy.spec.ts`, blob `866da4919f94f5d7e5029854e228286e1e16e927`.

The combined production run passed both copy journeys in 15.3 seconds under the
2 GiB process-tree watchdog, with peak RSS 1,688,764 KiB. Chromium phone emulation
uses real touch input at 390 × 844; it is not a physical-device result. The desktop
viewport is 1280 × 900. These local captures use the production build and isolated
port 32165. Full CI/check/review identities and finding dispositions are maintained
in [PR #221](https://github.com/mxbaylee/spinel/pull/221).

| Files | Theme / viewport | State |
| --- | --- | --- |
| `native-sheet-dialog-desktop-light.png`, `native-sheet-dialog-desktop-dark.png` | Light/dark, 1280 × 900 | Owned Sheet, native copy dialog, default current owned folder, saved content and independent native image fixture. |
| `native-doc-viewer-menu-phone-light.png` | Light, 390 × 844 | Shared Doc viewer, Make a copy in the native editor More menu; no Edit action. |
| `native-doc-viewer-dialog-phone-light.png`, `native-doc-viewer-dialog-phone-dark.png` | Light/dark, 390 × 844 | Shared Doc viewer, native bottom drawer, default My files destination and private ownership explanation. |
| `native-doc-copy-result-phone-light.png`, `native-doc-copy-result-phone-dark.png` | Light/dark, 390 × 844 | Reopened native drawer after dismissing an in-flight copy: retained Created/Open copy result, exactly one POST. |

The action/dialog and retained result are captured before continuing the same
asserted real-editor journeys. Both independent nonimplementing reviewers inspect
the selected images; the final PR records their reviewed SHA and approval.
Visual assessment is **agent review only**.

## Production component states

The selected `dashboard-*` and state images come from the actual production
components in Storybook. Source head:
`de9a1432b07604d0313bad437f7a2bd5e016fada`; CI merge checkout:
`5ceaec1781b2daeee96b0991e4f17f3e885deaaf`. Build:
[run 40987680406](https://github.com/mxbaylee/spinel/actions/runs/40987680406),
artifact `12948155677`, verified ZIP SHA-256
`fbc6ce7522f39cd1479dc9f5c2b5130aeb2e8f90c67d864462638a4e7f70560a`.

The local guarded review of that CI build passed **60/60 states**: all eleven
`CopyFile` stories plus the real `Dashboard/MakeCopy` journey, in desktop light/dark
(1280 × 900), phone light/dark (390 × 900), and tablet (768 × 900). Captures are full
page; the dashboard document can exceed the viewport height. Review duration was
23,439 ms and peak process-tree RSS 968,768 KiB. `production-story-review.json`
preserves all checked state IDs, selected durable-file mappings, and zero failures.
The complete screenshot archive is supplementary CI evidence with limited retention.

Selected images cover the dashboard dialog in both themes and phone widths;
shared-folder ownership/creator disclosure; loading; waiting for save; offline;
in-flight copying; changed-source retry; source access lost; and a retained created
copy that cannot be opened until reconnecting. The native completion captures above
cover the successful retained result itself. No alternate proposed UI or SPN-065
Redesign story remains.

## Restore-test keyboard proof

Final validation at `6881260d231da906daa1b1a2d3ee7bce0c4d7649` exposed a
flaky Sheet preview warning assertion in the existing restore test. The preview,
its editor setup and the test were unchanged from main; that preview does not
load the copy addon. CI run `40988347960`, development partition 2 job
`123845073708`, failed its first attempt and passed its built-in retry, so the
flaky-test gate correctly failed. The failed attempt has no trace; the retry
trace alone cannot prove that attempt's exact keyboard interleaving.

The predeclared single-attempt production diagnostic in
`restore-warning-proof.json` demonstrates the stimulus race: one printable key
opens the native permission warning and autofocuses OK; a subsequent Space
generates a trusted click on OK and dismisses the warning. The stored revision
and full snapshot remain unchanged. The proof passed in 5.9 seconds with peak
process-tree RSS 1,483,268 KiB, using Node 26.12.1 and Chromium 156.0.8078.4 under
the 2 GiB watchdog. Its source, authenticated-session verification and trusted
key/focus/click events are retained without credentials or document content.

The repair sends one printable key for the Sheet denial assertion. It retains
the Doc stimulus, visible protection warning, explicit OK click, unchanged
revision and complete two-editor restore checks. No product code, timeout,
retry policy or correctness assertion changes. The final PR records the bounded
full-journey result and current-head CI, including the original flaky failure.

The one planned full Sheet restore attempt was resource-aborted at
2,098,032 KiB by the 2 GiB guard, with no product assertion failure reported
before termination. It is not an acceptance pass; full multi-editor validation
runs in CI. An earlier anchored CLI filter selected no test and was corrected
before this scenario attempt. Neither condition caused a product-assertion retry.
