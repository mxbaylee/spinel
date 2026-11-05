# 🛑 SPN-090 single Safari outcome review B

**The selected Safari authored lane failed and its allowance is closed.** Startup, installation, same-session native termination/relaunch and four offline image-rendering captures completed before the first authored input failed. These useful partial outcomes do not make the lane pass, complete the remaining offline-edit/reconnect journey, or approve merge. No device command, provider GET, retry, new build or new session was performed for this review.

## 🔐 Exact source and retained integrity

Run `42080221117`, attempt 1, job `127431013928`, source/tested/event `d4eeeb8b4871695a0efc9b2c09259cc801784894`, tree `ee14758d57461c4a79176d6417ed9ce2f00c6058`; known Safari session `4eee9750abd5d75609f3a66830d3471fcfd891ea`. The requested target is iPhone 18 Pro Max / iOS 27; the returned capabilities acknowledge Safari/iOS, device name and eager loading. The retained user agent separately reports Version/27.0 and CPU iPhone OS 18_7; preserve those actual fields rather than treating the requested target string as an independent OS measurement.

Outcome artifact `13440581386` is 7,108,019 bytes, SHA-256 `8eeca61e42b0127825edd03419a9aa046fcdbb799a50bf02471aa358be7d4728`. I independently checked ZIP CRCs, safe unique paths and all **57 member sizes/hashes**. Every one of the **51 original preallocation-build members** is byte-identical to the previously audited artifact, including all 48 dist files. The capability JSON matches its extracted copy exactly. All four rendering-image hashes match their retained observations; the failure PNG matches the ZIP member and was visually inspected.

`audit-outcome-b.ts`, `outcome-proof-b.json`, `outcome-audit-b.log` and `outcome-watchdog-b.json` retain the proof. One bounded archive audit passed in **724 ms**, peak **200,176 KiB**, normal pressure, through the shared serial runner and 60-second/2-GiB guard. The original ZIP remains intact.

## ✅ Completed substeps

Clean install, application/fixture typecheck, inspected production build and preallocation artifact upload passed. The terminal workflow correctly reports the physical scope step failed; artifact retention and tunnel stop passed.

Initial eager navigation completed in **13,704 ms**, within the unchanged 15-second command bound. The first read has secure context, controlling worker and `anonymousReady: true`. Its bootstrap journal is sealed, with no failure, dropped events or invalid clock: worker selection settled at 81 ms, application import ended at 394 ms, styles ended at 661 ms and start returned at **663 ms**. This is actual current phone observation. Those relative document timings are not the entire navigation duration and do not retrospectively prove the cause of the earlier blank-sign-in failure.

The retained native actions show Add to Home Screen and launch through the Spinel icon, then native termination of `com.apple.webapp` with the stopped-state observation. Relaunch uses the Home Screen icon in the same known session, reports a new window after native launch, `standalone` and `navigatorStandalone` true, foreground `com.apple.webapp`, and offline state. The associated WebKit context's SafariViewService bundle is recorded explicitly rather than mistaken for an ordinary Safari tab. The relaunched bootstrap is clean and sealed with start returned at **148 ms**.

Network observations distinguish `navigator.onLine` from actual reachability: device-offline HTTP probes fail and the previously authenticated socket fails while its ticket remains valid. After relaunch the two HTTP probes still fail. The socket is explicitly **not retested** after relaunch because a new ticket cannot be obtained offline; do not claim an extra socket observation.

All four normal/conflict Sheet/Doc records remain present across restart, with exactly equal retained before/after bundle and image identities. Each reaches its offline-ready/rendering observation, with the four useful PNGs retained. These demonstrate completed downloaded-content/reopen substeps. They do not cover the later requested authored changes, creation, undo/redo/reopen, reconnect/conflict resolution, link and repeat assertions that this failure prevented.

## ❌ First failure and its meaning

First failure is **`capability-acceptance-native-input-character-dropped`**, in `acceptance-native-offline-edits`, while authoring the first normal Sheet's required `731`. The actual source sends each key once as its own WebDriver keyDown/keyUp action, then waits at most **2,000 ms** for the page's insertion-event count to reach the next index. The recorded step counts are **1, 2, 2**; all three readbacks still report the installed counter and focused native editor. The failure screenshot visibly shows **`73`** in the editing/formula area, consistent with the third required insertion not having appeared before the observation deadline.

This is a concrete failed input contract, not a global readiness timeout: the failure occurs at **150,647 ms**, with **629,353 ms** remaining in the 780-second lane, `deadlineReached: false`, no omitted command/stage records, and no lane-abort indication. The insertion counter is an observation of qualifying DOM input events, not a complete key-dispatch or mutation trace. Neither that count nor the screenshot proves whether the driver action protocol, installed WebKit/editor interaction, event handling or another layer caused the missing insertion; they also do not prove the key could never arrive later. The required result was absent at its fixed deadline, so failure is correct.

The earlier `actions-release-unsupported` observation is `unknown command` for DELETE actions. Existing source tolerates only that response after a successful POST because each action ends with keyUp/pointerUp. Its presence is relevant to static protocol review but is not itself evidence that it caused this third-key failure. The last journal command is an observation read, not proof that no key action was dispatched. Do not resend the uncertain input or extend the deadline to erase this result.

## 🧹 Cleanup and remaining scope

The outcome records network **restored-4g-lte-good**, session **deleted**, fixture **closed**. Cleanup took **768 ms**; total lane time **151,888 ms**. The workflow's separate Local tunnel-stop step passed. This is the retained owned cleanup evidence; no independent provider account query or system-wide process inventory was performed. Allocation is known, with no uncertain-allocation flag.

Chrome was not selected or allocated. The Firefox row preserves its maintained native-context provider blocker without allocation; the separate owner-recorded ordinary-tab offline limitation remains unobserved as previously documented. Neither is made passing by this run. Safari status stays failed, full matrix status incomplete, and the selected workflow/job stays failed.

The smallest justified next investigation is static inspection of this exact native-input action/observation protocol and its deterministic controls, using the first-failure evidence. A proposed repair must distinguish an actual protocol defect from merely waiting or sending again. This audit authorizes no unchanged retry, extra diagnostics, new paid session or automatic allowance. Preserve the completed startup/reopen evidence together with this failed authored stage and cleanly stopped resources.
