# SPN-052 native desktop evidence

This directory retains exact CI artifact archives so the essential evidence does
not depend on the hosted artifacts' expiration. All accounts, documents and image
fixtures are synthetic. The tests use ordinary, current vendor browsers on
disposable macOS runners; they do not use a person's browser profile.

## Chrome and Firefox application acceptance

Source: `68a2ce9980234e292a5e333abca15c9faec271e2`  
Tested merge: `f4f474442372fef7aa28af9e801d9d6377c0da38`  
Run: [40973885475, attempt 1](https://github.com/mxbaylee/spinel/actions/runs/40973885475)

| Archive | Job and original artifact | Measured configuration and result |
| --- | --- | --- |
| [Chrome application acceptance](chrome-native-acceptance.zip) | Job `123797053454`, artifact `12941174246` | Chrome 156.0.8078.80, macOS 26.6.2 (25G83), arm64, image `20261021.0445.8`: full pass; persistence denied for all four downloads. |
| [Firefox application acceptance](firefox-native-acceptance.zip) | Job `123797053715`, artifact `12942131280` | Firefox 159.0, macOS 26.6.2 (25G83), arm64, image `20261021.0445.8`: full pass; native Allow changes persistence from false to true and the grant survives restart. |
| [Intel PID qualification failure](safari-intel-pid-prerequisite-failure.zip) | Job `123797053847`, artifact `12941622388` | Safari 27.2, macOS 26.6.1 (25G76), x86_64, image `20260824.0517.1`: the verified process visibly paints, but title requests remain pending and no consent dialog appears. No application acceptance. |

```text
eb59fd84e7bf911f0e95508895bbd78fd498aa78e5b6020d8a7a986a235bac28  chrome-native-acceptance.zip
80cb95879145e001b372050625272a1319679bab484a08dddb389319454e2de1  firefox-native-acceptance.zip
e8206f7dbe26d00ad479f88a60792388a609875401daff24ec3cd5175987f2e0  safari-intel-pid-prerequisite-failure.zip
```

Each passing browser's `acceptance.json` records current vendor installation,
actual process/profile identities and exits, blocked application transport, exact
retained records/checkpoints and image bytes, native caret and OS clipboard
observations, normal revision/clean-state checks, both owned conflict copies,
unchanged server originals, recovered device-copy cleanup and exact receipts,
and truthful behavior after explicit
deletion. Offline and recovered-copy PNGs prove that existing images paint.
Deletion is a deliberate browser-API operation, not a measured eviction timer.

## Safari application acceptance

Source/tested push: `0cd9aa4c0b0135c92d6271ab297cae2f6e679160`  
Run: [40979677496, attempt 1](https://github.com/mxbaylee/spinel/actions/runs/40979677496)  
Job: `123816305544`; original artifact: `12944452880`, 1,011,918 bytes  
Archive: [Safari application acceptance](safari-native-acceptance.zip)

Safari 27.2 / macOS 15.7.9 (24G830), x86_64, standard `macos-15-intel` image
`20260824.0482.1`: full pass, with actual persistence false for all four downloads
and both restarts. The installer verified the current release and applied the
offered Safari-only update from 26.6. The ordinary profile's path, device and inode
remain identical across application PIDs 12212 → 14465 → 15928, with witnessed
exits and blocked HTTP/WebSocket transport before both relaunches.

The complete report records four retained pending checkpoints and image bundles,
native Sheet D1 = 731 and Doc prefix edits, physical image captures and native
clipboard content, both exact normal reconnects, two correctly owned conflict
copies with unchanged server originals, recovered device-copy cleanup and exact
receipts, and truthful explicit
storage-loss behavior. The corrected native input helper must exit successfully
and prove trusted DOM movement/target delivery before native caret/content checks;
the earlier release crash is not waived. The synthetic SVG/Canvas2D and profile
probe remains separate from the full application gate.

```text
85d0a612db0c68590cdbefd6ee71fd66e4da9f36fba8b2883d568bb8a966ad63  safari-native-acceptance.zip
```

The final canonical-head checks and independent assessments are recorded in
[PR #219](https://github.com/mxbaylee/spinel/pull/219). These complete original
archives remain available after the hosted artifact retention period.

## Safari environment comparison

Source: `b012ffdb3ab59776a036c5e6184dc225d6227d5d`  
Tested merge: `1d22be46464ad693a4204a5b2a375f8ac5dfc4ec`  
Run: [40967703363, attempt 1](https://github.com/mxbaylee/spinel/actions/runs/40967703363)

| Archive | Job and original artifact | Actual result |
| --- | --- | --- |
| [ARM rendering failure](safari-arm-environment-failure.zip) | Job `123776289062`, artifact `12938961876` | Safari 27.2, macOS 26.6.2 (25G83), arm64, image `20261013.0424.1`. Profile retention passed, but the unrelated simple HTML/SVG page and the product both rendered blank. Physical-pixel acceptance failed. |
| [Initial Intel prerequisite failure](safari-intel-initial-prerequisite-failure.zip) | Job `123776288973`, artifact `12939201282` | Safari 27.2, macOS 26.6.1 (25G76), x86_64, image `20260824.0517.1`. The same simple page visibly painted; name-addressed Apple Events timed out before application acceptance. |

Exact ZIP SHA256 values:

```text
0c3310fc59fd08a11e67d7fc11e566bf8bd855e836f943160b6bb748b20fc145  safari-arm-environment-failure.zip
84d1d64f187900833520159492b82d0c9d1200926700291a65cb1ed00536a1b9  safari-intel-initial-prerequisite-failure.zip
```

Within the ARM archive, compare `safari-profile-probe-online.png` and
`safari-profile-probe-offline.png` against their report's complete, visible,
focused DOM containing the expected heading and paragraph. The application
captures are also blank. Its `*-diagnostic.json` retains a partial WebKit log
reporting repeated IOSurface creation/open failures. The log overflow and failed
auxiliary CoreGraphics/canvas diagnostics are retained as failures; they do not
establish a proven graphics root cause. The Intel
`safari-capability-failure.png` visibly contains the same text and purple/blue SVG.

Both independent nonimplementing reviewers inspected this comparison. It supports
a hosted-environment problem outside Spinel, while differing OS builds and images
prevent attributing it to CPU architecture alone. Subsequent environment comparisons below retain every original application
assertion. No Safari configuration had full application acceptance at that
earlier checkpoint; the later Sequoia Intel application pass is recorded above.

The [implementation record](../../SPN-052.md) preserves the earlier attempts,
their source identities, failures, corrections and scope decisions. Synthetic
profile probes establish capability only. The production UI's synthetic
Storybook screenshots and independent agent visual review are recorded
[separately](../../../design/review/spn-052/README.md).


## Focused Safari qualification

Source/tested push: `fd103126ccbc7a204c0a3e73b2e7f8c05a69f926`  
Run: [40975523362](https://github.com/mxbaylee/spinel/actions/runs/40975523362)

| Archive | Job / original artifact | Actual result |
| --- | --- | --- |
| [Sequoia ARM profile qualification](safari-sequoia-arm-profile-qualification.zip) | `123802471133` / `12941858109` | Safari 27.2, macOS 15.7.9 (24G830), image `20260907.0337.1`. Exact profile markers survive restart; persistence false; simple HTML/SVG physically paints online and offline. No application acceptance. |
| [Tahoe ARM blank paint](safari-tahoe-arm-profile-blank-paint.zip) | `123802471276` / `12942517211` | Safari 27.2, macOS 26.6.2 (25G83), image `20261026.0455.2`. Profile markers survive but both physical simple-page captures remain blank. The capability job's success measures storage, not painting. |
| [Intel title request diagnostics](safari-intel-title-request-diagnostics.zip) | `123802471291` / `12941324574` | Safari 27.2, macOS 26.6.1 (25G76), image `20260824.0517.1`. Verified process construction/specification succeeds; actual title get times out. Correlated TCC attribution names the hosted agent `<ID of InvalidCode>` without a retained authorization decision; cause remains unknown. |

These experimental artifacts retain failed C-bridge permission and AppleScript
window-inventory diagnostics. Those auxiliary probes were removed; neither their
errors nor synthetic profile success can satisfy application acceptance.

Source/tested push: `f24a006929271c980f6a94e347d91a71e559e430`  
Run: [40976280493](https://github.com/mxbaylee/spinel/actions/runs/40976280493),
job `123804987310`, artifact `12942747792`  
Archive: [Sequoia ARM canvas failure](safari-sequoia-arm-canvas-failure.zip)

The full unchanged suite on Safari 27.2 / macOS 15.8.2 (24H232), ARM64 image
`20261028.0489.1`, failed its physical existing-image gate. Both simple HTML/SVG
screens paint, and both actual online editor toolbars/headers/footers paint, but
the Sheet/Doc canvas bodies are blank. All 24 capture records agree on the owned,
visible focused target, URL, dimensions and animation-frame progress. The actual
canvas regions contain only neutral RGB 252–255. A full-screen capture confirms
the crop. Repeated WebKit IOSurface allocation errors accompany the failure but
do not prove its cause. Independent reviewer B inspected all these observations.
This run establishes four downloads, denied-persistence guidance, transport
cutoff and first-process-restart exact retention; it establishes no native edit,
second restart, reconnect or loss outcome.

```text
ab55f576cc55041bf54d466dad5ffa8ec53cd1f925a697b8c6179a65ec4d42dd  safari-sequoia-arm-profile-qualification.zip
a617a0b49a5c642dfb307a51a12630781cac1156af8500fd98f3bc96e141d585  safari-tahoe-arm-profile-blank-paint.zip
d5d2557e55ac44a50cf8b3f77dde3bdb3abc939c4a64191b4a893117ca6a90d0  safari-intel-title-request-diagnostics.zip
36c75fa7b2fcc95f018f6dd9099aa8e18966165036c46e03c13866d2acdfe0e9  safari-sequoia-arm-canvas-failure.zip
```

## Mobile responsiveness failure and fresh pass

| Archive | Source / tested merge | Run / job / artifact |
| --- | --- | --- |
| [Prior failure](mobile-responsiveness-prior-failure.zip) | `b012ffdb3ab59776a036c5e6184dc225d6227d5d` / `1d22be46464ad693a4204a5b2a375f8ac5dfc4ec` | [40967703250](https://github.com/mxbaylee/spinel/actions/runs/40967703250) / `123776619364` / `12940314001` |
| [Fresh passing run](mobile-responsiveness-followup-pass.zip) | `68a2ce9980234e292a5e333abca15c9faec271e2` / `f4f474442372fef7aa28af9e801d9d6377c0da38` | [40973885485](https://github.com/mxbaylee/spinel/actions/runs/40973885485) / `123797161459` / `12943076582` |

The prior run recorded a real 126.3 ms unprofiled capacity-flush maximum against
100 ms; its cause remains unknown. The following run passed all seven cases with
zero retries and unprofiled capacity maxima 47.4/40.0/41.2 ms, p95
19.7/19.7/22.1 ms. It also passed all original correctness and other timing gates.
Its separate descriptive profile case recorded 102.6 ms with the unchanged
`budgetEnforced:false` policy. Harness hashes, fixture, Chromium156.0.8078.4,
Playwright1.64.1, Node26.12.1, four-times CPU throttle and thresholds match. The
hosted CPU changed from EPYC9V74 to EPYC9V45; this is a fresh pass, not a
performance fix or a controlled explanation of the prior failure. No sample was
removed, threshold relaxed or retry added. Reviewer A independently rehashed both
archives and verified these measurements and complete input accounting.

```text
383ac6d1ecaec587e636932f24ee932ece0f5be8c6edf3937d97b83a148be422  mobile-responsiveness-prior-failure.zip
674eb8f72c777ca6904459ea6a8b1b79453e391abf9b9ad35392fecde119c4e1  mobile-responsiveness-followup-pass.zip
```


## Sequoia Intel rendering and pointer correction

Source/tested push: `6c1322b447038baba64f184a03dd902dc98913a2`  
Run: [40976891720](https://github.com/mxbaylee/spinel/actions/runs/40976891720),
job `123807028694`, original artifact `12943277003`  
Archive: [Sequoia Intel pointer failure](safari-sequoia-intel-pointer-failure.zip)

Safari 27.2 / macOS 15.7.9 (24G830), x86_64, image `20260824.0482.1`
visibly renders both editors and their existing images online, then the original
Doc and image after a full ordinary-profile restart (application PID6620→9211).
All four downloads report actual persistence false and truthful help; complete
original records/catalog survive the outage and restart. The unchanged Doc pixel
gate counts 4,661 purple pixels before input. Both independent reviewers inspected
the original screenshots and report.

The adapter then rejects the returned Quartz CRef before posting its first
mouse-move event because it incorrectly expects Objective-C's `.isNil()` method.
The follow-up uses public type/location consistency checks before posting and
retains all trusted DOM movement/target and native caret/content requirements.
This failed run is not native-edit or later-lifecycle acceptance.

```text
2b746e969db719c2bf412c85fefed87255f834d3dc8ac3a67bc81dda08aaad8f  safari-sequoia-intel-pointer-failure.zip
```


## Safari evaluation cleanup failure

Source/tested push: `4685e372caa3d123d4613d5c65a533a58357a971`  
Run: [40977897335](https://github.com/mxbaylee/spinel/actions/runs/40977897335),
job `123810364896`, artifact `12943008227`  
Archive: [Evaluation cleanup failure](safari-sequoia-intel-cleanup-failure.zip)

On the same measured Safari27.2 / macOS15.7.9Intel image, the added default
Canvas2D panel and SVG both physically paint online and after restart. Readback
after the screenshots matches the purple/blue RGBA values. The application run
then stops while focusing help in the conflict-Sheet completed-download dialog: a
one-second Apple Events cleanup command expires. That `finally` could mask a
primary evaluation failure; the artifact cannot reconstruct whether one also
occurred. The next repair uses the ordinary five-second bounded cleanup allowance
and preserves both error contexts; a cleanup failure still fails the run. Quartz
execution is not reached, and no full acceptance is claimed from this attempt.

```text
469b417a318307ddea158ceaedd22f0304f851a5b66313b9fadc9cbf0c8a7e77  safari-sequoia-intel-cleanup-failure.zip
```


## Native Quartz release crash

Source/tested push: `22816ef23ea32ed5f315a0e73afc551d15bf81bf`  
Run: [40978757104](https://github.com/mxbaylee/spinel/actions/runs/40978757104),
job `123813210292`, artifact `12944495724`  
Archive: [Native release crash](safari-sequoia-intel-release-crash.zip)

On Safari27.2 / macOS15.7.9Intel image `20260824.0482.1`, all downloads, the first
process restart and the physical Doc image gate pass. The first Quartz move's
type5/global(960,510) match, and its post call returns. The JXA child then crashes
inside explicit `CFRelease` (SIGSEGV, release-begin without release-complete).
The exact memory/bridge cause remains unknown. The repair retains allocations
only for the existing immediately exiting, ten-second, at-most-two-event child;
clean exit and independently observed trusted input remain mandatory.

```text
e58e6dfe886951922fdd882ae3e4f446f469a7fdd38724760ed72eb0facfd78e  safari-sequoia-intel-release-crash.zip
```

## Offline-upgrade first-attempt timeout

Source: `b012ffdb3ab59776a036c5e6184dc225d6227d5d`  
Tested merge: `1d22be46464ad693a4204a5b2a375f8ac5dfc4ec`  
Run: [40967703250](https://github.com/mxbaylee/spinel/actions/runs/40967703250),
job `123776619524`, artifact `12939191094`  
Original archive: `offline-upgrade-prior-timeout.zip`, retained byte-for-byte as eight numbered parts:

[01](offline-upgrade-prior-timeout.zip.part-01), [02](offline-upgrade-prior-timeout.zip.part-02), [03](offline-upgrade-prior-timeout.zip.part-03), [04](offline-upgrade-prior-timeout.zip.part-04), [05](offline-upgrade-prior-timeout.zip.part-05), [06](offline-upgrade-prior-timeout.zip.part-06), [07](offline-upgrade-prior-timeout.zip.part-07), [08](offline-upgrade-prior-timeout.zip.part-08).

From the repository root, reconstruct the original ZIP and verify its digest:

```sh
cat docs/implementation/evidence/SPN-052/offline-upgrade-prior-timeout.zip.part-* > /tmp/spn052-offline-upgrade-native7.zip
shasum -a 256 /tmp/spn052-offline-upgrade-native7.zip
```

Concatenation has been verified against all 18,769,471 original bytes. The parts
preserve the complete original archive; nothing was removed or recompressed.

The final worker-update observation timed out at120 seconds on the first attempt;
the complete retry passed, so the fail-on-flaky job failed. The original helper
and production worker were unchanged from main. The artifact preserves the
first-attempt report/screenshots and retry trace; it contains no first-attempt
worker-state trace. Its cause remains unknown. Bounded observations were added
without changing the timeout, retry policy or success predicate. Current68's
full offline-upgrade job123797161513 in run40973885485 passed; that fresh pass
does not retrospectively explain or erase the original timeout.

```text
795f64039158a6378845f2394fad85d433d5caa332900bc7ab4e4668abf73b78  offline-upgrade-prior-timeout.zip
```
