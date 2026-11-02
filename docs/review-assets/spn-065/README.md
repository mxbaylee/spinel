# SPN-065 visual evidence

## Current native application captures

All nine `native-*` PNGs are actual production-editor captures from source
`fd89edb6647c66fc546c76996159d977f331f9ca`, incorporating main
`0bdbbcb5ca23b84e172e41a11bd0cf555e911130`. Harness: `e2e/copy.spec.ts`, blob
`80ffc3940c41513d23323efa2c8d7279c714b0a1`. Captured 2026-11-01 with the existing
isolated production server on port 3101. Both real copy journeys passed in
14.7 s; watchdog elapsed 15.247 s, peak process-tree RSS 1,691.6 MiB, no abort.

Desktop is 1280 × 900. Phone is Chromium touch emulation at 390 × 844, not a
physical-device claim. The file suffix identifies light or dark theme:

- `native-sheet-dialog-desktop-*`: owned Sheet, native dialog, current owned folder.
- `native-doc-viewer-menu-phone-light`: shared Doc viewer's native More action.
- `native-doc-viewer-dialog-phone-*`: shared viewer, private My files destination.
- `native-doc-copy-result-phone-*`: confirmed result retained after busy dismissal.
- `native-doc-copy-unknown-phone-*`: actual server commit followed by dropped
  response; unknown result retained after reopening, one POST and one stored copy.

The later [connection-publication guard](../../implementation/SPN-065.md#repeated-connection-notifications-and-flush-investigation)
was checked by rerunning both production journeys and recapturing all nine views;
the PNG bytes are identical. That check passed in 14.0 s (watchdog 14.488 s,
1,765.5 MiB peak). Component rendering code is unchanged.

## Current production component captures

Selected production CopyFile/Dashboard components use Storybook source
`fd89edb6647c66fc546c76996159d977f331f9ca`, tested merge
`ab28c6aa304a6a3bf4f7e9a6a523d63e52dd78c4`, from
[run 41384065810](https://github.com/mxbaylee/spinel/actions/runs/41384065810).
Artifact `13114497041` was downloaded and ZIP SHA-256 verified as
`6ec2ba3f6933ebe14a5a155579736305df18fce22534d27e7356c3cab4997f4c`.
The hosted artifact expires 2026-11-09; the selected PNGs and safe manifest here
are durable evidence. These captures use deterministic API fixtures.

All **75/75 states** passed: 14 CopyFile stories and Dashboard/MakeCopy, each in
desktop light/dark (1280 × 900), phone light/dark (390 × 900), and tablet
(768 × 900). Full-page captures can exceed viewport height. Watchdog elapsed
21.505 s, peak process-tree RSS 1,058.5 MiB. The manifest records review duration,
all IDs, zero failures, source identity and the exact selected-file mappings.

Sixteen selected component images cover dashboard light/dark/phone, shared-folder
ownership, loading, waiting for save, offline, creating, source conflict, access
lost, retained result while offline, and unknown outcome in desktop/phone light
and dark. Proxy failure, missing receipt and reopening uncertainty share the same
reviewed alert/Close state; all three distinct story interactions passed. There
is no alternate proposal or SPN-065 Redesign story remaining.

Independent nonimplementing reviewers inspect actual PNGs against the playbook
and all personas. The final exact reviewed/tested/merged identities, grades,
finding dispositions and visual approval are maintained in
[PR #221](https://github.com/mxbaylee/spinel/pull/221). **Agent review only.**
Earlier captures remain in Git history with their original source provenance.

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
