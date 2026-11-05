# 🔎 SPN-0901a9 initial source findings — review A

Exact inspected source:1a9c9df103977b4e762f52602bdb86bdba5b0980. Nonimplementing static review; no workloads run. Parent requested holding final numerical assessment until the concrete repairs are committed. This preserves findings on the original source rather than overwriting them with a later approval.

## A1 — tested commit attribution after explicit head checkout

The BrowserStack capability job now checks out the PR head, while `identityFromEnvironment()` still sets `testedSha` from `GITHUB_SHA`. For PR label events that variable denotes the event/merge commit, not the newly explicit checked-out/tested head. The build inspector separates actual source and eventSha correctly, but the capability journal and device result still mislabel the event SHA as tested. Bind testedSha to actual checked-out Git HEAD, retain event SHA under its own identity, compare the full identity across journal preparation/execution, and add a head-versus-event negative/control. No device execution is needed to prove this source discrepancy.

## A2 — ordinary-build absence ownership must match the actual build

The new mobile HTTPS absence assertion is unconditional, but supported `npm run e2e` builds a single instrumented dist with VITE_SYNC_EVIDENCE=1 before running mobile HTTPS among all projects. Its server uses the existing dist, so that route legitimately exposes the witness. The selected CI mobile owner builds with0 and should still require absence. A conditional worker check alone is insufficient: CI currently declares the flag only on its Build step, not Playwright smoke. Carry the same explicit build-mode flag to the selected worker/owner and protect selection with a control; avoid a CI check that silently skips because the variable is absent. Parent independently identified the local-route problem; A verified the additional CI environment boundary.

Other inspected aspects are coherent: fixed private-data-free phase schema, copied snapshots and seal, existing-command environment reads with sanitized witness at each consumer, no new await in the final exposure section, build/inspection/upload before provider setup, and direct serving of the same dist. No third concrete blocker identified at this checkpoint. Current hosted, ordinary/native/rendering and physical-phone acceptance remain pending; this findings note is not publication approval.
