# SPN-071 focus synchronization repair and retained hosted attempts

Source `d75f46fe7648e6dfaa75f8ae8859b87505b20bea` changes only the story's bounded focus assertion and the existing production journey's focus assertions. Application behavior is identical to `f653e24f34e9e7af3d6eb3bdc794fa4178b5bbe8`; this archive commit adds evidence, not application changes. `validation.json` pins exact source hashes, environments, attempts and memory scopes.

## Original tablet failure and repair proof

Storybook run41400587432/job125133767183 on172b94f had one failing state, HideAndShow/tablet. Its immediate assertion found body focus after the row/message DOM update. Dashboard deliberately focuses the heading on the next animation frame; the later failure PNG already shows that heading's focus outline. The source and capture support a premature assertion, not missing eventual focus. Both independent reviewers confirmed this diagnosis. The repair uses the existing default-budget `waitFor` around the same exact heading assertion; no sleep, enlarged timeout, scenario retry or product focus change was introduced.

The declared local proof uses five fresh768×900 contexts, all successful with zero play errors, followed by one deliberate negative control that suppresses only the Shared with me heading's focus method. That control still produces the expected focus assertion failure (one play error) within the default wait. The temporary TypeScript driver, full observations and negative screenshot are retained. The existing ordinary production hide/show journey now verifies actual heading focus after hiding each Doc and Space, and passes without retries. Typecheck passes. All local workloads use the serial lock and memory watchdog.

The refreshed supported Storybook `--test` build and85 state checks (17 stories ×5 variants) pass including every play result and zero swallowed errors. Eleven representative unmodified current component captures, their complete checked-state manifest and exact source identity are retained in `current-components`. Desktop/light-dark images are1280×900; phone/light-dark are390×900. Chromium156.0.8078.4, Playwright1.64.1, Node26.12.1, normal Mac system fonts. These are component fixtures, not physical devices. Existing fourteen production/native captures remain valid because application/capture source is unchanged. **Agent review only**; final exact-head grades and hosted gates remain required.

## Other hosted outcomes retained separately

The repaired public sign-in restore fixture passed its complete256MiB journey on172b94f, including authentication, rich contents/authority/native rendering, and cleanup. Its full raw evidence and original artifact ZIP are retained here; the earlier failed attempt remains archived at8273a9efa9c7684ab5e1301d916dfc9f3e445473. The successful older-head result does not replace new-head CI.

The same172b94f CI run's Sheet soak job failed the known SPN-131 Ubuntu mirror check before Chromium installation or any scenario. Its original AWS/image/profile-error log is retained. A targeted setup restart was requested but GitHub refused while the workflow was still active; none ran. The new story-source repair requires a fresh complete run, which will also obtain a fresh setup attempt. No product assertion retry, mirror-helper weakening or claim that SPN-131 is fixed is made.

The original tablet ZIP is44,790,668bytes; its SHA256 and artifact identity are in validation.json. This archive retains the full manifest and every relevant failure record, omitting unrelated catalog captures rather than storing the44MiB ZIP. Final PR#226 records required CI, independent grades and final merge/cleanup identities.
