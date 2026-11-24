# 🔎 SPN-087 hosted visual evidence — independent reviewer A

## Identity and limits

Agent review only. This is a visual/evidence audit of candidate source
`2d3ef587aa4071b8da676248171f6ff398b8a736`, not a final grade on the forthcoming
current-main integration commit. No application build or browser execution was
performed locally. No repository files were changed by this reviewer.

GitHub Storybook run `45290939749`, attempt 1, is a successful pull-request run
for that exact candidate. All five unexpired design-review ZIP artifacts were
downloaded and their SHA256 digests matched GitHub metadata before extraction.
Complete private archives, extracted files and identity receipt are under
`/private/tmp/spn087-takeover/`; see `review-a-artifacts.json`.

Download/extraction used Node 26.13.0, the existing serial wrapper and 2 GiB
process-tree watchdog: 54434 ms, peak 212272 KiB, exit 0, no abort. Manifest/hash
audit used the same controls: 303 ms, peak 170240 KiB, exit 0, no abort. Watchdog
receipts are `/private/tmp/spn169/spn087-review-a-{download,manifests}.json`;
logs and analysis scripts are in the takeover directory. Workload slot released.

## Verified hosted coverage

Every variant has 1134 requested and 1134 checked story states, with zero
failures: desktop light/dark, phone light/dark, and tablet light, totaling 5670
states. The fixed fixture timestamp is `2026-10-20T16:00:00Z`. These are Chromium
emulations, not physical-device results.

All five `style-isolation-<variant>.json` files have deeply equal before/after
observations for the same-document Appearance → Controls → Appearance sequence.
The manifests report keyboard menu/selector interaction, Escape/focus return,
dialog containment and themed nested portal checks, plus native formula and
toolbar checks. I inspected the artifacts rather than inferring these from the
aggregate green check. Full audit: `review-a-manifest-audit.json`.

## Baseline attribution

The committed `current-before` captures are source
`0d6e1ffae53fe5432fa2bb581bdf52ba7d9a2166`, run `43237408378`. Their provenance
establishes equivalence to former main `04baabd6a68abe7c0b225f8699681532e2205b60`,
not current main. Application/dependency/capture sources changed between that
baseline and current main, so it must remain explicitly historical.

Across the prescribed 30 stories × five variants, 105 PNG files are byte-identical
and 45 differ. All four Controls states (default, disabled, error, long modal
title) in all five variants are byte-identical: 20 of 20. The byte-different
files mainly cover shell/dashboard/Space/profile, with a few native/Appearance
captures. Byte differences alone are not a decoded-pixel comparison or proof of
a visual regression. Dashboard phone before/after was manually inspected and
looks unchanged; the remaining differences need attribution rather than a
blanket pixel-identical claim.

Latest main Storybook run `45296798069` succeeds at
`1081e5a3156776bb5ed8d577b01b53224ebd0ad8`, but retains check manifests rather
than screenshots. Prior main `45282881845` likewise has check manifests only.
Neither is a new before-image capture.

## Actual image inspection

Read the design playbook and review runbook. Viewed actual hosted candidate PNGs
for all five variants, including Controls default, phone long-title modal,
nested Appearance icon picker after Controls, tablet selected-cover picker,
native Sheet light and native Doc phone dark, Operator profile phone dark,
revoked guest desktop light, and guest-viewer Space phone dark. Compared the
historical Controls dark baseline, Dashboard phone before/after, and historical
negative-control nested picker with the candidate.

No newly introduced visual defect found in the inspected states. Controls retain
their expected hierarchy, theme surfaces, spacing and phone containment. Long
modal text wraps with the close action visible. Nested icon/cover pickers retain
selection and focus indication without the historical stylesheet contamination.
The native editor chrome is present; the phone native Doc retains its existing
horizontal canvas behavior, not a new responsive-layout promise. Operator profile
still explicitly excludes document access; the guest view has scoped Pages and
view-only/read-only cues; revoked access exposes no document or account shell.
Owner/Collaborator content identity and actions remain legible.

This sampled inspection plus broad hosted checks supports the visual result for
the captured source. It does not assert that I manually viewed all 5670 states
or establish unchanged pixels for every historical comparison. Exact integration
head approval requires confirming its application/story/style/capture sources
are unchanged from this captured candidate.

## Useful PR-visible evidence

Use existing committed historical Controls before images with their original
source captions. Useful current after-image paths under the takeover directory:

- `design-review-desktop-light/redesign-controls--default-light.png`
- `design-review-desktop-dark/redesign-controls--default-dark.png`
- `design-review-mobile-light/redesign-controls--long-modal-title-phone.png`
- `design-review-mobile-dark/redesign-controls--default-phone-dark.png`
- `design-review-tablet/redesign-controls--default-tablet.png`
- `design-review-mobile-light/style-isolation-nested-icon-after-phone.png`
- `design-review-mobile-dark/style-isolation-nested-icon-after-phone-dark.png`
- `design-review-tablet/style-isolation-selected-cover-after-tablet.png`

Publish useful selected images with source/run/theme/viewport captions using the
standing permission; artifact links alone do not replace PR-visible evidence.
Update stale implementation/PR wording that still says the candidate's hosted
five-variant checks are pending or calls the current catalog 1041 entries.
No new browser capture is recommended merely to repeat the already successful
candidate execution when source equivalence to the integration head is proved.

## 🔬 Decoded pixels and catalog follow-up

The first strict historical-ID-subset assertion failed and is retained in
`review-a-pixels.log` with watchdog receipt
`/private/tmp/spn169/spn087-review-a-pixels.json`. Five historical IDs are absent:
`offline-recovery-list--pending-ordinary-and-space`, `--dark`, `--clean-downloads`,
`--navigation-guard` and `--long-title-phone`. Read-only Git history attributes
their source-file deletion to current-main commit
`9717f55f892013867a8ca597f2ae9f74ffc6405b` (SPN-163), not this cleanup.
Current catalog accounting is 1036 retained historical IDs + 98 added IDs = 1134
unique IDs, identically in all five variants. Do not claim all historical 1041
IDs remain present.

The reporting analysis then decoded the 45 byte-different pairs using the pinned
Playwright PNG decoder, comparing exact RGBA without tolerance. It changed no
image or product assertion. Preserved result: `review-a-pixel-comparison.json`;
log `review-a-pixels-report.log`; watchdog
`/private/tmp/spn169/spn087-review-a-pixels-report.json`: 2278 ms, peak 326560 KiB,
exit 0, no abort. The shared workload slot is released.

All 150 image dimensions match; 105 images are pixel-identical and the other 45
have actual pixel differences. All 20 Controls states remain exactly identical.
Appearance phone-dark differs by two pixels. Four native cases differ by 6–20
pixels in small toolbar/zoom regions. Shell/dashboard/Space differences mostly
occupy botanical emoji regions (161–475 pixels per image). Before/after Space
desktop and Dashboard phone inspection found preserved layout and controls; the
minor raster differences are not attributed to a proven browser/font cause.

The five profile images differ by 4934–6191 pixels in the top utility region.
Actual phone before/after inspection identifies an added feedback ellipsis,
shifting the existing appearance/profile controls left. This is the already
landed SPN-098 `FeedbackMenu` addition in `web/Rail.tsx`, verified by the
historical-baseline-to-main source diff. The profile body remains unchanged.
It is not introduced by SPN-087. No observed remaining image difference warrants
a product repair in this cleanup; preserve the measured limits and source
identities instead of claiming universal pixel identity.
