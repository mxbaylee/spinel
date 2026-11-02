# Resumed integration evidence

Application and test source: `f653e24f34e9e7af3d6eb3bdc794fa4178b5bbe8`, on
main `df1d910822cba284178f26ac4f6cf359ddcfacef`. Validation ran on the identical
uncommitted tree immediately before that commit. The evidence commit changes
only documentation and retained artifacts. [manifest.json](manifest.json)
records source/artifact SHA-256 hashes, runtime, cases, elapsed time and observed
process-tree memory peaks. All workloads used the repository serial lock and
the 2 GiB memory-pressure watchdog; all acceptance browser cases used zero retries.

Fourteen unmodified PNGs show the actual integrated production app in light and
dark themes. `shared-menu-desktop` and `access-details-desktop` use 1280×900;
`hidden-shares-phone` and all native `phone-*` states use 390×844 Chromium
emulation. They are not physical-device evidence. The menu includes Make a copy,
Access details and Hide. The Modern viewer gains native Edit/Done and a current
Can edit header without replacing its canvas; Traditional keeps its phone layout
restriction while reporting the new account role. Earlier component proposals
remain in the parent folder; final current component review and exact-commit
hosted checks are linked in PR #226. **Agent review only.**

## First failures and controls

- `negative-authoring`: the first new phone assertion incorrectly expected Edit
  alone to focus the native input. The existing real touch helper supplies the
  required canvas tap; this was a test-authoring correction, not a product fix.
- `negative-done`: the corrected regression on `7c137138580ebac6fbed947276e2fd9b9538c99f`
  fails because native Done is absent. Restoring `HEADER_MENU` on an allowed
  upgrade repairs it. The two phone cases then passed (10.095 s / 1,365.1 MiB).
- `negative-header`: on that same application plus the single `HEADER_MENU`
  repair, the desktop Doc becomes editable but still reports View only. The
  saved regression fails expecting Can edit (9.923 s / 1,326.1 MiB). Verified
  role propagation to existing Dashboard metadata fixes the mismatch without
  taking its loading/remount path. The final seven-case run also checks a Sheet
  admin's header/Rename action, same native canvas/focus/selection, actual saved
  edits, and subsequent downgrade/revocation rejection.
- `copy-stale-status`: the first combined integration run passed four cases and
  failed the phone-copy fixture's old “reload after your access changes” text
  (44.714 s / 1,472.3 MiB). SPN-071 intentionally supports live upgrades; updating
  that assertion to View only preserves the complete retained-copy journey,
  which passes in the final seven-case run. No copy behavior was weakened.
- One preliminary header command collected zero tests because an anchored grep
  ignored Playwright's project/file prefix (1.681 s / 662.8 MiB). The corrected
  grep produced the retained negative control above; zero tests is not a pass.

Raw failure screenshots, accessibility contexts and available diagnostics are
retained here. Regression source snapshots use `.ts.txt` to keep historical
fixtures out of compilation. Earlier resource aborts remain disclosed in the
implementation record; none is counted as acceptance.

The routing collections prove each Modern/Traditional upgrade case remains in
development, production and mobile HTTPS during routine CI, while full
compatibility retains both additional sync projects. These cases assert native
UI/authority, not protocol instrumentation; prepared upgrade cases continue to
own instrumented offline admission and replay. All nine plan tests passed.
