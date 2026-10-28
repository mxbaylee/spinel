# SPN-066 visual evidence

These representative captures show the implemented production components using
synthetic Storybook fixtures. They cover the proposed inventory design and its
changed states: integrated light/dark/phone profile, expiry editing, whole-Space
turn-off, expired sharing, load failure and long names.

The exact source commit, CI build identity, theme, viewport, capture time and
image hashes are recorded in [manifest.json](manifest.json). The source was
`2f84289abad8454a6dfaf4def00da345f35fd8f8`. The captured settings components remain
byte-identical after the test-fixture and transition-wait repairs and the separate
native-editor denial fix. Production source hashes make that equivalence
reviewable. Real native expiry journeys are verified by the PR's browser suite.

The capture run checked all 40 selected story/viewport combinations successfully.
That count is scoped to these eight stories across five variants, not the full
Storybook catalog. The PR records full current-head CI and independent reviews.

**Agent review only.** An independent nonimplementing reviewer inspected all
40 captures plus Operator/offline states and found no actionable visual defect.
Final approval and both numerical reviews are tied to the PR's exact final SHA
in its conversation. This file does not substitute for those merge gates.

## Native expiry

The native-expired-dirty.png image is the real production guest terminal screen
after a standalone Doc expires with pending input and unavailable metadata. The
Sheet journey produced identical pixels, so one representative image is retained.
Neither private title/content nor copy/export/recovery actions remain. The
manifest identifies the identical local/remote source tree and content hashes.

The inventory and standalone Doc/Sheet journeys completed before the enclosing
five-case local run exceeded the 2 GiB resident-memory cap on entering its Space
case. The watchdog stopped that workload; it is **not** recorded as a passing
full browser run. Final current-head CI and the PR review record supply that gate.
