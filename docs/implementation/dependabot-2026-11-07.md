# ⬆️ Follow-up dependency integration

## 🧭 Decision and scope

**2026-11-07 — agent judgment under the owner's dependency-integration request.**
[PR #268](https://github.com/mxbaylee/spinel/pull/268) landed as
`757ab68e3146845f501773f7abfafe45c034e15f` after its complete selected acceptance
passed. The new grouping policy then opened four additional updates from that
main commit. Combine those compatible updates in one follow-up, retaining a
separate preparation commit for each update and using the repository's squash
merge policy after review and acceptance.

| Source PR                                           | Direct update                                              | Preparation commit                         |
| --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| [#269](https://github.com/mxbaylee/spinel/pull/269) | `@storybook/react-vite` 10.6.2 → 10.6.5                    | `971f3269193282767963c3b7c9ef44573c59dd5f` |
| [#270](https://github.com/mxbaylee/spinel/pull/270) | `@types/node` 26.6.5 → 26.6.6                              | `358fb75ec0d60c65b23b4371df52b3e94dd472a5` |
| [#271](https://github.com/mxbaylee/spinel/pull/271) | `@napi-rs/canvas` 1.0.11 → 1.1.0, root and print workspace | `25ea51e27620c4a3a48d9aad4b46d84cc6476f56` |
| [#272](https://github.com/mxbaylee/spinel/pull/272) | `@aws-sdk/client-s3` 3.1160.0 → 3.1161.0                   | `0770dbefaec0c1500230f8403779b2800129d5b1` |

Source heads were respectively `971f3269193282767963c3b7c9ef44573c59dd5f`,
`bf718aa9ef0d71e4afda501e637207df830ebcc7`,
`a2f59d3e7c1b083aced833208a4540ae90093e39` and
`3d1b01701a017df39ae655b5fd7228b905ad4c2b`.
The four diffs have no conflicting dependency-field changes. Their combined lock
changes 44 installed-package records plus the root and print-workspace records.
The complete combined lockfile SHA-256 is
`58b5f0766a2ca79c7fca32eaba8b486b40151e6c759e2e17fcbbc3ecb2e35e43`.

### Compatibility and deliberate boundaries

- Storybook's React/Vite adapter, builder, renderer and DOM shim now match the
  already accepted 10.6.5 core. The existing React 19, Vite 8 and TypeScript 7
  versions satisfy its published peers. Preserve the TypeScript API adapter.
  [Upstream manifest](https://github.com/storybookjs/storybook/blob/v10.6.5/code/frameworks/react-vite/package.json).
- Node types remain a declaration-only patch under the unchanged Node 26.13.0
  runtime. Strict typechecking owns compatibility with Spinel's existing code.
- Canvas retains the used native Canvas/PDF/font APIs and updates all platform
  packages coherently. Its default portable FreeType text renderer can change
  measurements, glyph output and font resolution. Do not force a renderer mode,
  weaken completeness/cropping assertions, or widen resource bounds to hide a
  change. Keep explicit fixture fonts, isolated font registries and cleanup.
  [Upstream release](https://github.com/Brooooooklyn/canvas/releases/tag/v1.1.0).
- S3's direct release is a version bump with AWS/Smithy transitive changes,
  including credentials and HTTP transport. Unit checks alone do not establish
  provider behavior: require the actual provider backup/catalog/restore suite.
  A bot PR's green missing-secret probe is not equivalent to that acceptance.
  [Upstream changelog](https://github.com/aws/aws-sdk-js-v3/blob/v3.1161.0/clients/client-s3/CHANGELOG.md).

Keep Caddy [#238](https://github.com/mxbaylee/spinel/pull/238) and Univer
[#240](https://github.com/mxbaylee/spinel/pull/240) out, with the exact unresolved
startup-evidence and peer/guarded-patch migration blockers in the
[preceding decision](dependabot-2026-11-06.md#updates-excluded-from-this-integration).
This cohort does not claim a cause for the preserved historical memory-headroom
refusal, change its guard, or use a retry as acceptance. The already landed
grouping policy, security handling, schedules and cooldowns remain unchanged.
Close an included bot PR only after GitHub confirms its changes landed.

## ⚖️ Matched historical comparisons

Create dependency-only descendants of both accepted historical sources:

| Comparison             | Historical parent                          | New source                                 |
| ---------------------- | ------------------------------------------ | ------------------------------------------ |
| Doc responsiveness     | `6ee50161c9eeeb7296ffb282d7ae52abd9e61d1b` | `b21979c3fdb78e3736d7ded0f7b91f44d45e5968` |
| Doc callback lifetimes | `48dc8d4698129d5c7748ff2dac3b5d18cb0bcd6b` | `dd6b3f397ea89c9eb024fcbe9f52d77b865d45d4` |

Each descendant changes only the four root dependency pins, the print-workspace
Canvas pin and the complete byte-identical candidate lockfile. All eight root and
workspace dependency maps match the candidate. Preserve historical application
source and scripts, including the original three postinstall patchers; current
main's two additional patchers are not copied into historical source. Preserve
the allowed harness overlays, workloads, attribution requirements, thresholds,
sample counts and first-attempt policy. A baseline that no longer reproduces its
required historical stall remains `needs-evidence`.

The two workflow checkout references and callback comparator constant point to
these immutable commits. Preserve the earlier named baseline refs for #268 and
retain the new sources as `ci-baseline/doc-responsiveness-dependabot-2026-11-07`
and `ci-baseline/doc-callback-dependabot-2026-11-07`. These are active acceptance
inputs, not obsolete integration branches.

## 🧪 Verification contract

The local dependency tree `2a84ee73c0b643879b87b1377fd93e29d6daaf32` was tested
with Node 26.13.0, the repository's serial runner and the unchanged 2 GiB / eight
minute watchdog. Its local cherry-pick head `be82b4c30c358db6558ecb7ddc44351ff2cbaac9`
and GitHub preparation head `0770dbefaec0c1500230f8403779b2800129d5b1` have the same
tree. Initial local evidence:

| Check                                                 | Result                                             | Duration | Peak process-tree RSS |
| ----------------------------------------------------- | -------------------------------------------------- | -------- | --------------------- |
| Clean `npm ci`                                        | 499 packages; all five guarded SDK patchers passed | 15.147 s | 1,284,036 KiB         |
| Native Sheet, Doc and PDF geometry suites             | 34/34 tests, three files                           | 47.227 s | 962,612 KiB           |
| Strict typecheck                                      | Passed                                             | 6.420 s  | 1,981,140 KiB         |
| Dependency boundary, lint and format                  | Passed                                             | 25.770 s | 816,184 KiB           |
| Comparison and CI-plan controls after baseline wiring | 66/66 tests; no skips                              | 1.223 s  | 450,524 KiB           |
| Strict typecheck after baseline wiring                | Passed                                             | 7.025 s  | 2,011,540 KiB         |

Native fixtures exercise actual text/image/PDF output, font isolation, cleanup,
continuation, resource failures and geometry under the new binary. Review every
retained reopened page, including intentional sparse pages; extraction and test
counts alone are not visual approval. The final PR records the independent page
review, useful commit-pinned examples, exact committed source and local controls.

Independent nonimplementing reviewers inspected **69 fresh PDFs / 154 pages**:
`new_canvas_compat` reviewed all 26 Sheet PDFs / 39 pages;
`remaining_compatibility` reviewed all 43 Doc PDFs / 115 pages and independently
reopened six selected Doc pages through Poppler. Both found no unexpected visual
defect. Late text, image continuation, regular/bold/italic/fallback glyphs, colors,
boundaries, margins and watermark absence met the synthetic fixture contracts.
The intentionally split glyph and native-layout gap pages match test expectations.
This is agent-only fixture review, not a pixel comparison to Canvas 1.0.11,
cross-platform proof, physical-print acceptance or a hosted result.

The unchanged reviewer receipts, complete output hashes/page inventories, local
test logs/watchdog records and baseline integrity check are retained in
[local-evidence.zip](evidence/dependabot-2026-11-07/local-evidence.zip), SHA-256
`7f5e7c4d730bacbeaa25b4b2877051649e2c1da34206b509207a90e77d04b27f`.
Original scratch paths in those receipts identify the inspected outputs; they
are not permanent download links. The repository retains five representative
unchanged page PNGs:
[Sheet faces and fallback glyphs](evidence/dependabot-2026-11-07/sheet-rich-fonts.png),
[complete wrapped Sheet text](evidence/dependabot-2026-11-07/sheet-wrapped-text.png),
[Doc faces and nested list](evidence/dependabot-2026-11-07/doc-rich-fonts.png),
[last long-text page](evidence/dependabot-2026-11-07/doc-long-text-tail.png), and
[image continuation tail](evidence/dependabot-2026-11-07/doc-image-continuation-tail.png).
The complete generated PDFs/PNGs are supplementary test outputs; the archive
records their hashes, not copies of all pages. Hosted runs must retain their own
fresh native evidence under the existing artifact contract.

The existing shared-dependency and workflow predicates retain broad CI selection.
No suite, first-failure rule, retry policy, assertion, guard, deadline or memory
budget changes. Hosted acceptance must cover all seven required checks and every
selected worker, including native print, production containers, Storybook
rendering/interactions, desktop native persistence, sized restore, actual S3
provider operations and both matched historical comparisons. No new tests or
runtime abstraction are needed for unchanged contracts. Hosted results remain
pending until the exact reviewed source completes them; earlier #268 results
cannot qualify this different dependency set.

The final PR description is the acceptance record: reviewed/tested/merged source
identities, individual review rubrics and findings, run/attempt/check identities,
first-failure disposition, plan/result provenance and relevant measurements.
Batch initial metadata before opening the draft PR. Required final evidence
publication can trigger CI even after merge; it does not replace the run that
qualified the merged source.

## 👥 Persona decision

The Operator gets one coherent, pinned dependency cohort with real provider and
resource-bounded recovery evidence. The Owner retains complete readable Sheet
and Doc exports, including late content. The Collaborator retains concurrent
editing and permission behavior under the shared dependency tests. The Link
guest retains immediate revocation and document-scoped access. There is no
product UI or design change; Storybook interactions and PDF rendering still need
their existing validation. Visual fixture review is **agent review only**.
