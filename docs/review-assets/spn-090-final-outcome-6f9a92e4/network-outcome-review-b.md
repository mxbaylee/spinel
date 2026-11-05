# 🔎 SPN-090 completed-session HAR — independent outcome review B

## Observed result and identity

The one authorized diagnostic observation completed on **5bb97d17484ca7df151114ad2f6e28a03b4630c2**, run **42025414770**, attempt **1**, diagnostic job **127238289785**. The capability/allocation job **127238291261** is skipped with no steps. Source and tested identities in the sanitized report both equal 5bb97d17; the target is the already completed Safari session **a4da71c1d9135174dc4dc74b9d2f0eff0d10c7f3** from failed phone source **6f9a92e41996f8fca7b8e90ede61bbbb3242ce4b**. This review does not merge those two execution identities.

Independently verified the retained ZIP is **2,953 bytes**, SHA256 **af90e57b622a7a65510f96ccefba66052b86cea3e0ffdfdb35da6b0fc676e7bc**, has a valid CRC and exactly the sanitized JSON member; that JSON agrees with `network-diagnostics.json`. The single networklogs GET reports HTTP200, 59,346 raw response bytes and response digest **723d2999c216fb3691f277ca86c58a64c7d5cca50231999f99745819122e6c95**, 439 ms elapsed. The raw provider body was deliberately not retained, so its digest cannot independently be recomputed from the sanitized artifact. Run/job records agree with successful diagnostics and zero allocation. No new provider request, application execution or phone action was performed by this reviewer.

The HAR normalizer retained **37 entries**, zero malformed/omitted, `complete=true`. This is completeness of the obtained HAR under its supported schema, not proof that the provider captured every browser operation or that the application loaded. All fixture-host records have statuses200/302/304; the HTTP400 rows are non-fixture records. No fixture HTTP failure is established. Status200 and JavaScript MIME do not prove successful module parsing/evaluation. Diagnosis remains **unclassified**, capability acceptance **not assessed**.

## 🧭 Correction to the timeout premise

**There is no 10-second dynamic-import deadline in the actual 6f9 bootstrap.** I inspected `git show 6f9a92e4:web/main.tsx`, not just the newer checkout. Lines74–76 await the manifest application import without a timer. The `10_000` at line32 belongs to each stylesheet load in `loadStyles`; those loads occur only after the import settles at line80. The provider's 10-second WebDriver script setting is also a different operation, not an application dynamic-import timeout.

`boot()` first asks the worker for an applicable runtime, catches that request failure, then awaits `start()`. The worker request has its own registration/message bounds. A rejected import/style/start ultimately writes the explicit “Spinel could not start…” root message. A pending import does not reach that catch. `application.tsx` imports App/GuestApp/theme and only creates/renders the React root when `startApplication` is called after admission/styles. Therefore comparing 12.078/17.257-second network durations with a supposed 10-second import cutoff cannot identify this failure's cause or justify increasing a timeout.

## 📦 Asset identities recovered without another fetch

The retained **same Safari-job** log `safari-job.log` lists Vite's emitted public asset paths. Hashing those literal pathnames with SHA256 exactly matches **22** fixture HAR rows, including repeated304 entries. Full matched observations and the input build-log digest are saved in **`network-asset-mapping-b.json`**. This is exact pathname correlation, not a rebuild, guessed filename or decryption of arbitrary URLs.

- Entry20: `/assets/application-8TWMM7LW.js`, 2,515 ms total, 505 ms wait, 2,010 ms receive, 341,972 response-body bytes.
- Entry34: `/assets/CopyFile-C6i42XXv.js`, **12,078 ms** total, 417 ms wait, **11,661 ms receive**, 637,550 response-body bytes.
- Entry35: `/assets/theme-BUKfwjsk.js`, **17,257 ms** total, 1,574 ms wait, **15,683 ms receive**, 590,277 response-body bytes.
- Entries32/33 map to floating-ui.react-dom/profile chunks (5,715/4,586 ms respectively).

These durations are dominated by the reported receive interval for the two slowest fixture scripts. They establish slow transfers in this session; they do not identify the network layer responsible, module completion time, CPU evaluation cost or which request initiated another. Body bytes are provider metadata, not independently hash-verified emitted content. Chunk labels do not establish that all bytes in a chunk originate in the similarly named source file.

Static source does establish an eager module chain `application.tsx → App.tsx → Dashboard.tsx → CopyFile.tsx`; `application.tsx` also imports `initializeTheme`. Thus substantial pre-sign-in application dependencies are a relevant hypothesis rather than an invented unrelated subsystem. The production bundler can share/coalesce modules, so attributing the entire637KB/590KB to CopyFile/theme alone requires the emitted chunk graph/content, not these labels.

## 🍎 Relationship to the failed phone chronology

The original phone evidence remains as previously verified: eager was acknowledged; URL completed in14,416ms; initial environment and subsequent readiness polls stayed `anonymousReady=false` with secure context and an activated controlling worker. The anonymous-HTTPS stage lasted33,200ms, including navigation/readiness and diagnostic work. The first bounded readiness poll is distinct from the app bootstrap. The failure image shows a blank page, not the explicit bootstrap error text. No native/installed authored action occurred. Network restoration, session deletion and fixture closure succeeded.

A still-unsettled application dependency/evaluation before the readiness cutoff is **plausible** and consistent with the blank UI and slow script transfers. It is **not proven**. The sanitized HAR contains no absolute request start times, initiators, evaluation/parse/error records or import-settlement timestamp. Its array index is not enough to establish concurrency or align a request's start/end with the URL return, readiness cutoff or screenshot. The provider may also omit/cache activity. The absence of stylesheet entries in this obtained set is consistent with not reaching `loadStyles`, but is not an execution witness proving that phase was unreached. A JavaScript exception, pending module evaluation or a different runtime/startup condition remains possible. Driver logs did not settle that question either.

This evidence neither proves the earlier normal-page-load timeout's cause nor changes the paid attempt's failed disposition. It does not show an active-worker fault merely because the combined error label contains “worker”. No green ordinary application run can retroactively supply these missing phone observations.

## 🔬 Bounded next question, with no renewed phone allowance

The network-read allowance is now consumed successfully. Do not repeat it, increase the readiness/import bounds based on the false10-second premise, or dispatch a blind paid retry.

The next useful lowest-layer question is **which exact emitted modules must settle before anonymous entry can render, and whether this source can remain blank while those imports are pending**. First inventory already-retained build outputs/source maps/manifests from this source's completed CI/artifacts; if the exact Safari build is present, perform one bounded static dependency walk and correlate the already recovered pathname hashes. Do not imply that a later build is the identical artifact merely because source matches. If exact emitted bytes were never retained, state that gap: the current build log already resolves the public pathname question, but not constituent code or execution timing. No additional provider fetch is required to resolve the names.

A subsequent narrowly specified deterministic bootstrap control, if separately admitted, could defer/reject the application import and style completion and verify the actual first-render/fallback sequencing. That would test source behavior without a phone, avoid speculation about a nonexistent import timeout, and establish the right regression contract before a production loading-state or dependency-splitting proposal. It would not reproduce or prove this phone event's cause. Any source change needs its own complete scope/persona tradeoffs and exact-head reviews; any new paid acceptance requires a new explicit finite plan. No such execution or repair is approved by this read-only report.

The ticket remains blocked on the full truthful phone/product outcome and current visual acceptance. Owner/Collaborator need usable first entry and reliable offline documents; Operator needs a bounded discriminating investigation; Link guest's minimal isolated entry must not inherit new account authority. The evidence supports investigating pre-render loading/dependency behavior, not waiving coverage or claiming a repaired cause.
