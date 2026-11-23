# 🔄 Maintaining Univer upgrades

Every Univer dependency-update PR owns this checklist. This is recurring maintenance,
not three standalone unpatch tickets. SPN-147 owns missing upstream contributions.
Owner direction, 2026-11-22; [decision](implementation/grooming-2026-11-22.md#-univer-maintenance).
The current source pins 1.3.1 and runs five guarded OSS patch scripts. This grooming
changes no installed bytes and claims no new release is qualified.

## 📦 Assess one aligned release

- Recheck published OSS source/package bytes and actual upstream disposition at
  update time. A submitted or merged PR alone is not a suitable released package.
  Align all root/workspace Univer dependencies, peers and lock entries; retain the
  no-Pro boundary. Reuse one exact release/lock/source assessment across repairs.
- Inventory every `scripts/dependencies/patch-univer-*.ts` guard and its ES/CJS
  bytes. For each, record whether stock satisfies its contract, an existing repair
  can be safely requalified, or the update is unsuitable. Never silently skip a
  mismatched guard. Keep needed reviewed repairs under the retained-patch policy;
  prefer upstream behavior and adapt Spinel through supported APIs for retirement.
- Size the complete outcome before implementation: core stock adaptation retained
  an XL estimate; callback and composition retirement each retained L estimates
  before shared release reuse. UI/drawing need bounded investigation and explicit
  estimates at kickoff. Consolidation does not complete these requirements or
  imply every dependency bump must remove all patches.

## 🧪 Retain each protected contract

- **Core** — [complete retained SPN-099 specification](https://github.com/mxbaylee/spinel/blob/cc9e9fd2222b12d87f0213e4d481409feb195ace/docs/todo/SPN-099.md):
  canonical link/custom ranges, negative retains, paragraph REPLACE and falsy
  styles, deterministic transform/fuzz/native convergence, saved content and
  history. Scheduler tests retain ordering, cancellation, thrown-callback progress
  and Node pending/idle liveness without imposing one particular channel design.
  Keep upstream [#7938](https://github.com/dream-num/univer/pull/7938) and recorded
  [#7987](https://github.com/dream-num/univer/pull/7987) provenance; recheck status.
- **Docs UI callbacks** — [complete retained SPN-119 specification](https://github.com/mxbaylee/spinel/blob/cc9e9fd2222b12d87f0213e4d481409feb195ace/docs/todo/SPN-119.md):
  replacement/disposal ownership, cursor/blink/zoom, desktop/mobile responsiveness,
  exact content/selection, sync, Undo/Redo, composition and denied/revoked access.
  [#7969](https://github.com/dream-num/univer/pull/7969) is a contribution reference,
  not release acceptance. Preserve detecting lifecycle-validator controls.
- **Docs composition** — [complete retained SPN-122 specification](https://github.com/mxbaylee/spinel/blob/cc9e9fd2222b12d87f0213e4d481409feb195ace/docs/todo/SPN-122.md):
  balanced inserts, descending-delete groups/prefixes, single-Enter/plain-append,
  unsupported fallbacks, metadata/cache ownership/publication order; original
  2,086-input workload, fourfold mobile throttle, first-attempt budgets, 16-state
  grouping and 200-group history retention, complete Undo/Redo, IME/segments,
  quiet tail, saved/peer convergence and access. Do not relax budgets to unpatch.
- **UI resize** — preserve the callback lifecycle/resize behavior covered by
  `scripts/dependencies/patch-univer-ui.test.ts` and native print/editor checks;
  qualify separately from core. SPN-147 records its upstream disposition.
- **Drawing refresh** — preserve zero/signed extents, complete resource bytes,
  unaffected drawing/queue progress and continued editing. Distinguish saved
  geometry from actual canvas visibility on activation/reopen; retain the
  [documented boundary](implementation/SPN-056.md#retained-drawing-visibility-on-tab-activation-and-reopen).

## 🔎 Retire only demonstrated replacements

Keep semantic regressions beside their maintained owner before deleting a patch’s
script, patch-specific installation tests, postinstall entry, notices and temporary
repair instructions. Fresh installation must leave that package byte-identical to
the selected release. Independently needed guards remain. Use existing deterministic
fixtures, exact package hashes and focused unit/native/browser owners under
[sustainable testing](testing.md); route SDK, lock, postinstall, shared harness and
source changes to all affected CI work and required historical comparisons.

Record failed attempts, release identities, each repair’s disposition and remaining
work in the update PR. Require current-head gates, both independent reviews and
visual approval for visible SDK changes. Diagnostic emitters keep their contracts
or receive the inventory/regression updates required by [diagnostics](diagnostics.md).

[Draft #223](https://github.com/mxbaylee/spinel/pull/223) remains preserved, unmerged
1.1.0-era implementation work. Port useful changes into an appropriately scoped
update against current main; its old checks do not qualify 1.3.1 or a future release.
