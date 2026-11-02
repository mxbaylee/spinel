# SPN-090 resume audit after SPN-132

2026-11-02. Remote source e0abee43dcb5d7edcb2508e940733e730729b01c remains
draft PR #224. The owner chat was rechecked idle; latest commit was more than
two hours old. Main is now cc8364693791d981b86e80efc40bedba7fff2c08.
The older local checkout has unrelated dirty/untracked work and was untouched.
No device, tunnel, provider request or new test execution was started by this audit.

The original all-lane installed-context prerequisite still prevents the full
physical matrix. Chrome's eighth completed session dc1a30f87ce096c3e7ae42bae0fd3349bc24d9ad
failed its first readiness execute/sync at approximately 05:40:28.352 UTC after
verified item navigation. The generic unknown error supplies no concrete cause.
Two earlier completed-session log observations remain available/unclassified;
their second interpretation found a correlated UnknownError, not an underlying
cause. Existing evidence does not justify replaying a paid allocation.
Firefox still needs a supported native-control route or an actually provisioned
native-capable runner preserving the device/profile. Empty inventory proves
neither entitlement absence nor a general Firefox limitation. Safari's historical
capability pass does not satisfy the full editing/reopen/reconnect matrix.

Primary references rechecked: BrowserStack's Automate session API documents
GET /automate/sessions/{session-id}/appiumlogs, already used by the bounded
diagnostic. Appium Geckodriver's moz/context reference exposes content/chrome
browsing contexts; it does not establish Android NATIVE_APP/Home Screen control
on this account. This audit found no new supported execution route. No provider
contact was sent.

- https://www.browserstack.com/docs/automate/api-reference/selenium/session
- https://appium.github.io/appium-geckodriver/latest/reference/endpoints/

Current ordinary CI run41396964949 is failed, not merely queued as in the old
checkpoint. The attached complete job logs preserve these actual failures:

- job125138956718: development1/2 fails strict Ubuntu mirror-profile validation
  before browsers (the known SPN-131 class).
- job125138956672: production2/2 cannot find enabled Pause edits in the Workspace
  maintenance controls region, e2e/maintenance.spec.ts; cause unclassified here.
- job125138956462: sized restore fails during confirming-and-restoring; this
  audit does not diagnose it from the stage alone.
- job125138956436: restore-crash.integration.test.ts postcommit SIGKILL scenario
  fails on unexpected fixture HTTP503; 606 other tests passed. No retry/fix claim.
- job125133644545: the PR checker correctly rejects unfinished SPN-090 landing
  bookkeeping and the unlanded SPN-130 registration below main's next_id.
  Preserve the allocated SPN-130 provenance; do not reuse or silently renumber it.

Earlier whole-ticket grades remain67/100 and65/100, not merge approval. Current
main integration, exact failure dispositions, SPN-130 registration reconciliation,
full physical acceptance and fresh independent grades remain owed. Ordinary CI
success alone cannot resolve the physical prerequisites. The source's complete
scope and all four personas remain intact; no ticket is deleted or marked done.

Continue the next eligible backlog ticket while these capability prerequisites
remain unresolved, and recheck this PR/ownership on subsequent work selection.
These logs are evidence, not a new implementation or a claim of repaired CI.
