# SPN-066 visual evidence

These representative captures show the implemented production components using
synthetic Storybook fixtures. They cover the proposed inventory design and its
changed states: integrated light/dark/phone profile, expiry editing, whole-Space
turn-off, expired sharing, load failure and long names.

The exact source commit, CI build identity, theme, viewport, capture time and
image hashes are recorded in [manifest.json](manifest.json). The source was
`2f84289abad8454a6dfaf4def00da345f35fd8f8`; subsequent changes before publication
repair test fixtures and transition waits without changing these production
components. Production source hashes make that equivalence reviewable.

The capture run checked all 40 selected story/viewport combinations successfully.
That count is scoped to these eight stories across five variants, not the full
Storybook catalog. The PR records full current-head CI and independent reviews.

**Agent review only.** An independent nonimplementing reviewer inspected all
40 captures plus Operator/offline states and found no actionable visual defect.
Final approval and both numerical reviews are tied to the PR's exact final SHA
in its conversation. This file does not substitute for those merge gates.
