# 🔎 SPN-090 startup diagnosis — independent next-step review B

**The retained evidence supports investigating the anonymous startup dependency path. It does not prove that slow network transfers caused the blank Safari page, and it does not justify another phone run yet.**

Read-only review of local source `5bb97d17484ca7df151114ad2f6e28a03b4630c2` and failed-phone source `6f9a92e41996f8fca7b8e90ede61bbbb3242ce4b`. I confirmed the relevant bootstrap/application/App/Dashboard/CopyFile/theme/Vite source is unchanged between those identities. PR224 remains a separate source identity from the diagnostics branch. No provider request, session allocation, build, browser, application or test execution was performed.

## 📌 Established observations

The failed Safari attempt 42020011460 completed its eager URL command in 14,416 ms, then never met anonymous readiness within its original bound. Secure context and an activated controlling worker were observed; the combined worker/readiness error label does not diagnose a missing worker. The screenshot is blank. Networking restoration, session deletion and fixture closure succeeded. Installed/native actions and authored editing were not reached.

The completed-session network read 42025414770 obtained 37 supported HAR records with no omitted/malformed entries under its schema. Fixture HTTP statuses were 200/302/304. Exact pathname hashes match the same phone-job build log, including CopyFile-C6i42XXv.js at 12,078 ms and theme-BUKfwjsk.js at 17,257 ms, predominantly receive time. The application entry itself took 2,515 ms. Names are recovered without another provider fetch; the existing mapping proof already establishes this.

There is **no application dynamic-import 10-second timeout**. `web/main.tsx` awaits the chosen application's import without a timer. The 10,000 ms timer belongs to stylesheet loading after that import resolves. The worker-selection request has separate registration/reply limits. WebDriver's script timeout is another distinct boundary. Raising one of these based on the HAR durations would not be a diagnosed fix.

## 🧭 Source-level startup path and its limits

The initial HTML contains an empty root. The bootstrap registers the worker, selects an applicable runtime, imports the application, validates compatibility, loads all manifest CSS, and only then calls `startApplication`. That function initializes theme, creates the React root and renders App or GuestApp. Thus a pending import or stylesheet promise can leave the page blank before React begins; this is directly supported by source, independent of the historical phone inference.

The application has static imports of both App and GuestApp and theme initialization. App statically imports Dashboard, which statically imports CopyFileForm, plus numerous other authenticated surfaces. AuthEntry is therefore not an isolated initial module boundary. Editors are already lazy in several routes, so blindly making one editor lazy would not address this identified eager path. Initial anonymous App rendering normally produces AuthEntry with a loading state, rather than intentionally returning an empty page until authentication completes. This supports checking pre-render phases first, but does not rule out a later render/evaluation exception.

Vite explicitly isolates its module-preload helper and renderer dictionaries. The offline-shell plugin makes the application entry a descriptor URL and writes a complete shell file inventory and CSS list into HTML/worker. That inventory is not an import/dependency graph. The `CopyFile` and `theme` emitted chunk labels also do not identify all contained modules: the source CopyFile form and theme initializer alone cannot be assigned their entire reported 637/590 KB. Shared imports and bundler coalescing must be inspected before selecting a split.

The emitted `module-preload` helper was itself recovered as a small successful HAR entry; its existence does not imply the entire application dependency graph completed. A stylesheet rejection should eventually reach the explicit bootstrap failure text, but the missing error text at one screenshot cannot prove the import was still pending: there is no phase-aligned execution record.

## 📦 Exact evidence missing

The retained Safari workflow artifact inventory has one artifact, 13410608977. Its ZIP contains only `browserstack-capability.json` and the failure PNG. The workflow upload paths retain those records, not `dist`, the injected runtime descriptor, emitted JavaScript/CSS, source maps or a bundler dependency graph. The build log lists emitted assets but not their contents/import edges. The sanitized HAR intentionally excludes absolute request starts, initiators and content; it provides no import-settlement, parse/evaluation or first-render witness.

Other current-source ordinary CI artifacts include callback source/map collections, and the retained Storybook output is a different build entry. Neither is automatically the same Safari fixture build. Existing local evidence does not establish a byte-identical application chunk graph. If an ordinary artifact is later used, compare exact source, build flags, public asset path and byte/hash identities first; do not silently substitute it for the missing phone build. No new provider fetch is needed to recover the already-known asset names.

Consequently the evidence cannot align the two slow transfers with URL return, readiness cutoff or screenshot, distinguish network contention from CPU evaluation, identify module parse errors, or rule out worker-selection/style/render delays. HTTP success is not module execution success. No retained-only operation can recover omitted historical timing or bytes.

## 🔬 Smallest useful next verification

The next question should be explicit: **what must settle before anonymous entry renders, and does deferring one of those dependencies produce the observed blank state while worker readiness remains true?** It is a capability/regression question, not a proposed network timeout increase.

A finite deterministic bootstrap control is the lowest meaningful behavioral check. Exercise pending and rejected application import, pending/rejected style loading, worker-selection failure/fallback, and successful first render. Keep the actual sequencing/admission logic, demonstrate exactly which state appears before React, and verify stale operation cancellation cannot expose the wrong runtime. This establishes what the source does under delayed dependencies without repeating the paid session or claiming to reconstruct it. Existing runtime/account isolation must remain part of the contract; do not add a parallel bootstrap framework merely to test it.

For a dependency-splitting hypothesis, a separate bounded emitted-build inspection is necessary before implementation. Prefer exact retained emitted bytes if they can be proven to match; otherwise explicitly declare one new offline build of the pinned phone source/config as a **new build**, not recovered historical bytes. Retain source/lock/tool versions, build flags, emitted JS hashes, static/dynamic import edges, module membership and compressed/uncompressed sizes. Walk the static closure from the descriptor's application entry to anonymous rendering and identify which slow named chunks are mandatory before that render. No phone is needed for this graph question. A source-only list of imports is useful but cannot quantify the emitted boundary.

A production split should follow only a concrete graph result: for example, isolating authenticated surfaces from anonymous admission may be justified if they account for substantial mandatory startup code. Do not pick CopyFile or theme based only on their filenames, add arbitrary delays, enlarge readiness bounds, or introduce a cosmetic loading message and call phone acceptance repaired. Any loading-state change is UI work requiring the normal design/stories/current visual review; any module split must preserve complete offline shell assets, build compatibility, retained-runtime selection and guest/account authority.

If later phone execution is separately admitted, the retained artifact should include the exact emitted build identity/graph and a small identity-free bootstrap phase witness (selection/import/styles/start/render, monotonic timestamps, first failure), rather than another broad HAR-only diagnosis. This is a prospective evidence requirement, not an execution allowance or an instruction to collect private URLs/content.

## 👥 Scope and stopping conditions

Owner and Collaborator need usable first entry plus the full original offline/edit/recovery outcome; Guest must not acquire account data/authority through a startup split; Operator needs a finite discriminating observation and recoverable evidence. Finishing SPN-090 still requires its complete real-device/product acceptance and current visual evidence, not just resolving the blank-page hypothesis.

The old sequential Safari/Chrome/Firefox script is not itself a diagnostic plan. Running all three now would not supply the missing historical startup phases and could consume extra allocations after the first unresolved failure. Preserve the closed Safari allowance and separate completed diagnostics; do not turn an optional supplied script into authorization for a blind three-browser retry.

This review recommends the bounded verification questions above only. It does not admit a build/test workload, provider fetch, new paid session, timeout change, source implementation or final grade. Root can preregister the chosen smallest check, its resources and terminal outcomes before execution. Under the latest user direction, finish only SPN-146 and SPN-090, then stop; the other prerequisite chain remains parked.
