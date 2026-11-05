# 🔎 SPN-146 launcher capability plan — independent review B

**This is a useful, narrow next question and supports preparing a small probe for static review. It does not admit execution or a new application allowance.** Reviewed launcher-audit-plan.md, the retained first violating topology, current diagnostic workflow and the existing direct-CLI lifecycle control read-only. No build, installation, app, browser, provider call or other workload was run.

## 🎯 Why this question is distinct

The workflow starts `npx playwright test` inside the owned process guard. The retained first violation shows guard → child3359 (96,392 KiB) → shell3371 (1,920 KiB) → CLI3372. Identifying that intermediate child as npm's executor is a reasonable inference from the exact launch command and parent chain; the coarse `other` role alone does not prove it. A direct pinned CLI removes processes from execution rather than excluding them from accounting. That is an appropriate resource hypothesis; it changes no editor, input, composition, trace category, window, limit or product acceptance requirement.

The installed @playwright/test package declares its playwright bin as cli.js, and that file calls the installed playwright/lib/program parser. The existing lifecycle control invokes this package CLI directly and verifies actual timeout/owned cleanup. It does not measure npm-wrapper resident overhead or prove that both launcher routes select the same current executable under the proposed fixture resolution. The proposed single comparison therefore is not a duplicate of that control.

The retained Linux wrapper-plus-shell footprint is 98,312 KiB at one observation. It is a motivation, not a measured saving: direct launch may change other processes' heaps or scheduling. The at-least-64-MiB simultaneous-owned-RSS criterion is a fixed capability threshold, not a revision to the native runtime criterion.

## 🔐 Preconditions for a comparable small probe

- Pin the actual Node/npm/Playwright identities, package versions, both resolved executable realpaths and the program implementation used by each route. Both must load the same verified dependency closure. The partial local installation already caused one real CLI import failure; do not silently repair it, choose a different package/version, or let npm search/download a replacement. Use read-only installed dependencies and owned temporary links only. Explicit offline/no-install enforcement must fail if the intended local bin cannot resolve.
- Keep the same fixture bytes, working directory, selected test, worker count, arguments, environment and reporter. The only intended difference is the npm/shell launch wrapper. Retain any npm-injected environment differences affecting the result as a limitation; do not assert literal environment equality without checking it. Do not retain secret environment values.
- Define the exact measurement set and barrier before execution. A worker's explicit ready signal must happen after the same selected fixture setup in both routes and remain blocked until the parent samples once. Pin root PID/start identities and include all declared owned descendants under the same rule. Keep the external whole-probe guard independent of the comparison. Do not subtract separately observed process maxima, select a favorable peak, wait for a preferred RSS, force GC, warm up or take repeated trials.
- Sample and persist the first barrier observation before releasing it. Retain all observed peaks and the comparison's fixed-barrier values separately. The fixed old→direct order is reasonable for this one-shot capability question but does not remove startup/cache/order variance. The result is not a statistical estimate of Linux headroom.
- Require the same selected test, worker/result status and fixture cleanup, plus actual disappearance of the expected wrapper ancestors. If either route resolves differently, fails before the barrier, leaves descendants, times out, loses its receipt or produces a different result, stop and preserve the failed attempt. Do not use a partial old/new pair as a saving claim.

## 🧹 Ownership and minimal scope

Use one invocation per launcher and the existing 60-second/2-GiB/normal-pressure outer guard, with the declared 15-second command bound. The parent must own spawned descendants through timeout and termination, preserve the first failure over log/receipt/cleanup failures, and record partial identity/topology even if the barrier never arrives. A wrapper timeout cannot leave a detached Playwright worker behind. Output should be create-once, with final persistence failure remaining a failure. These are the same boundaries that required repair in the previous probe, not a reason to build another generic runner.

Do not add separate success and timeout repetitions just to mirror the existing lifecycle suite. A single synthetic barrier test with observable teardown/result is enough for launcher parity, while the unchanged real timeout lifecycle control can remain supporting evidence with its actual source identity. If the new probe claims to execute timeout behavior itself, it must fit that one declared invocation and report the intentional timeout/result precisely rather than count it as an ordinary passing test.

The fixture needs no app server, SDK, browser, native transport, provider, installation or full dependency copy. A tiny temporary config/test, actual pinned CLI, bounded barrier handshake and process receipt suffice. If comparable barrier sampling or dependency resolution requires a substantial new framework, stop and reassess rather than expand this checkpoint.

## 🚦 Supported outcome and remaining obligations

A qualified result requires complete parity/topology/cleanup plus at least 64 MiB lower concurrently owned RSS at the declared barrier. It would support removing this unnecessary launcher layer. It would not prove the full app fits 2 GiB, attribute historical flush pauses, make either failed component comparison pass or establish a successful fixed trace window. Negative or invalid results close this probe; the threshold, order and number of attempts remain fixed.

Even a qualified probe only supports a separate explicit source/plan review for a changed-launcher application observation. The a4eb allowance remains consumed and closed. No re-anchor, new runtime, larger budget, peer removal, narrower trace or input reduction follows automatically. All product latency, content, history, saved/peer state, access and cleanup requirements remain pending.

Operator benefits from testing a concrete removable overhead under unchanged accounting; Owner, Collaborator and Link guest retain every semantic/access guarantee. User scope remains SPN-146 plus SPN-090, then stop. No concrete reason to reject this narrowly defined preparation was found, subject to the preconditions above and review of the actual probe before execution.
