## 🧭 Why this registration is needed

PR #260's merge conflicts are resolved at C `472a130c4b6fdaf7b342b0ea3d2c180cd408067e`, but its required mobile first attempt failed **114.4 ms > 100 ms** in [CI41956095276](https://github.com/mxbaylee/spinel/actions/runs/41956095276). The preceding B **129.1 ms** failure remains unexplained. Separate history, native, Storybook and visual successes do not accept either failed performance sample.

This focused backlog maintenance follows the owner's request to fix the conflicts and get #260 merged. It registers the independently necessary native outcome before implementation and makes it a real prerequisite. It changes no application behavior, performance budget, workload, workflow or CI selector.

## 📝 What changes

- Promote the already CLI-allocated **SPN-145** and **SPN-146**, preserving their original IDs and titles. This is not a new allocation or ID reuse.
- Preserve SPN-145's complete **M** offline-activation outcome and immutable evidence mapping.
- Retain SPN-146's original **L** assessment as history, record C's genuine failure and the early **XL** capability/scope reassessment, and state the finite diagnostic plan and actual execution prerequisites.
- Keep SPN-089 open, synchronize its already reviewed complete **M** outcome, and add `depends_on: [SPN-146]`.
- Regenerate the index: **24 open tickets / 19 unchanged completions / next ID147**. Preserve the 2026-10-29 grooming date, every other setting, canonical SPN-144 and SPN-141's dependency.

The complete change is eight Markdown/backlog files. This is focused maintenance, not a claim that the full backlog has been groomed. All four personas retain their existing editing, history, persistence, access and operational boundaries.

[Maintained registration decision](https://github.com/mxbaylee/spinel/blob/067aeb03a493b782fffd97c318c441a4633640f1/docs/implementation/grooming-2026-11-05-spn089-prerequisites.md) · [SPN-146 current failure/capability](https://github.com/mxbaylee/spinel/blob/067aeb03a493b782fffd97c318c441a4633640f1/docs/implementation/SPN-146.md#current-c-failure-and-capability-checkpoint)

## 🔎 Publication checkpoint — 2026-11-05

| Identity | Value |
| --- | --- |
| Reviewed source | `067aeb03a493b782fffd97c318c441a4633640f1` |
| Tree | `44b954bda2f88c4cf4af5505ccfdf377fa3694c4` |
| Sole parent and reviewed main | `1045e729c391c47a9b6a895782a2fa69dc6fa044` |
| Complete diff | 8 files, 443 additions /26 deletions |
| Hosted acceptance | **Pending at publication**; this draft is not yet approved to merge |

Two independent nonimplementing agents inspected the same complete committed head and original allocations, links, failures, exact executable/config equality, persona effects and landing bookkeeping. **Agent review only.**

| Reviewer | Scope /35 | Correctness /25 | Evidence /20 | CI /10 | Maintainability /10 | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/root/verification_plan` | 35 | 25 | 20 | 10 | 10 | **100/100** |
| `/root/repair_independent_review` | 35 | 25 | 20 | 10 | 10 | **100/100** |

Both have no unresolved findings. The earlier precision finding is fixed: the corresponding C state-672 window is **23.0 ms outer /22.9 ms native pair**, with neither interval substituted for the other. Prose-spacing findings are also fixed. Both reviewers explicitly assessed scope and unnecessary complexity; no new abstraction or speculative implementation is introduced.

### Local checks completed before publication

- Generated backlog index: exit0, 747 ms, peak252,876 KiB.
- Backlog check: exit0, 688 ms, peak250,152 KiB.
- Final exact-commit PR checker, exact base/title: exit0 at **03:44:35.814 UTC**, 3,030 ms including serial-lock wait, peak256,320 KiB, no abort.
- Complete diff whitespace check and clean worktree confirmed. The temporary dependency symlink was removed.
- Original allocation/counter proofs, 24/19/147 counts, unchanged canonical144/141, and all55 local +7 pinned links independently verified.

These documentation checks fit the actual scope. Existing documentation-only classification is expected to apply without modification; the actual hosted plan and all seven required contexts will be checked before any guarded squash. No runtime suite, native diagnostic or browser capture was repeated for this registration.

**Final evidence route:** this is the dated initial publication checkpoint. After terminal verification and any confirmed merge, a complete maintained repository `registration-terminal.json` and readable summary will record the reviewed/tested/merged identities, all seven gates, plan, reviews, local receipts and cleanup. A commit-pinned conversation update will link that authoritative record and explicitly supersede this pending checkpoint. Its evidence-only ref will remain retained until the necessary files are preserved elsewhere. A body edit is not required for that record and would itself launch unrelated full validation.

## ⬆️ Open Dependabot review and disposition

Read-only review at **2026-11-05 03:46:56 UTC** covers all seven currently open Dependabot PRs. Existing updates remain open; this review neither merges them nor certifies an unexecuted acceptance gate.

| PR / exact current head | Current CI and compatibility/security disposition |
| --- | --- |
| [#244 Vite8.3.4→8.3.5](https://github.com/mxbaylee/spinel/pull/244), `2fa7387ae8020144017416e6f2438d735d87a245` | [CI41490041899](https://github.com/mxbaylee/spinel/actions/runs/41490041899) failed27/33, including historical/callback install-build owners and sized restore; native Safari also fails, Storybook passes. A retained baseline install explicitly mismatches Vite manifest8.3.4/lock8.3.5. Preserve failures; integrate the current harness deliberately and qualify the build/import/dev-server patch independently. |
| [#243 AWS S3 SDK](https://github.com/mxbaylee/spinel/pull/243), `2090a4c03019c564eb48c51c3b93756019d4d674` | [CI41489984643](https://github.com/mxbaylee/spinel/actions/runs/41489984643) failed28/33 in historical/callback install-build owners and aggregate; native/Storybook pass separately. Retain S3/Spaces behavior and authentication compatibility; reviewed release notes identify endpoint/codegen/SSO updates, not an established S3 security fix. |
| [#242 Storybook](https://github.com/mxbaylee/spinel/pull/242), `dd2b2a6b577635e3f6c37398e79e9e389421acb8` | [CI41489903141](https://github.com/mxbaylee/spinel/actions/runs/41489903141) failed28/33 on historical workers; native/Storybook pass. Keep the Vitest/types/Jest-loader tooling change focused, with real catalogue and interaction qualification. It is not a proposed SPN-146 repair. |
| [#241 oxlint](https://github.com/mxbaylee/spinel/pull/241), `8dfbd4ee013dd014e934bcf378520584fd66e2d4` | [CI41489864928](https://github.com/mxbaylee/spinel/actions/runs/41489864928) failed28/33 on historical workers; native/Storybook pass. Review newly recommended rules and AST lone-surrogate compatibility before landing the linter update. |
| [#240 Univer1.2.0](https://github.com/mxbaylee/spinel/pull/240), `70430e9413d73c708c924daf0e339ba47ef32e6d` | Draft; [CI41489835535](https://github.com/mxbaylee/spinel/actions/runs/41489835535) failed30/33 before runtime; later41539213850 is cancelled. Core1.2.0 conflicts with presence-ui's1.1.0 peer; native/Storybook fail. Keep one coherent root/workspace SDK group and actual stock-core/patch-retirement qualification. No guard bypass or assumed upstream fix. |
| [#239 Node26.13](https://github.com/mxbaylee/spinel/pull/239), `786b8586991baf624f9690568a8951d889e79336` | Draft; current-head CI41539561371/41542084603 and Storybook41539561656 are cancelled; native41539561167 passes. Official change is LTS metadata relative to26.12.1. Preserve atomic runtime/image/engine pins, SPN-117 mitigation and actual host/container acceptance. |
| [#238 Caddy digest](https://github.com/mxbaylee/spinel/pull/238), `ff0872497ad8a83856e77b4d404333f85a020117` | CI41489209986/41489210883 pass33/33, but earlier41489208790 remains failed after a first-attempt supervised-restore fixture failure/retry pass. Storybook passes. The proposed image remains Caddy2.11.7/Alpine3.23.7; it does **not** include [2.11.8's new security fixes](https://github.com/caddyserver/caddy/releases/tag/v2.11.8). Keep the existing PR as owner for digest refresh, reverse-proxy security/config review and qualification. |

Grouping: keep unrelated runtime/tooling/image changes in their existing separate PRs; move Univer packages as one SDK set and Node pins as one runtime set. No specific advisory was identified in the reviewed Vite/AWS/Storybook/oxlint release notes; that bounded statement is not a complete vulnerability clearance. Caddy's reverse-proxy 1xx header fix is relevant to evaluating Spinel's `reverse_proxy` use; PHP/file-path fixes are not directly exercised by its current Caddyfile. Exact official source links and all inspected run identities are retained in the supplementary review receipt.

## ⛔ Remaining merge boundary

The registration's passes will accept **this documentation outcome only**. PR #260 stays draft and unmerged. A supported SPN-146 repair or evidence-based measurement disposition must land first, then SPN-089 must integrate actual main and obtain fresh exact-head reviews, required visual disposition and every selected first-attempt gate. No bookkeeping-only push, unchanged rerun, reduced workload or relaxed100 ms limit is authorized by this registration.
