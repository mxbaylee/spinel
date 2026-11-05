# 🔎 SPN-123 provisional nullable-loader review

Independent nonimplementing review by reviewer A, 2026-11-05. **No concrete source blocker found in this narrow repair.** This is provisional source/retained-evidence review, not a final exact-head rubric grade, validation-push authorization, native acceptance or merge approval.

## Reviewed scope and identity

Reviewed the nullable-loader production/test delta from published `5d775fba29a076126ebe3d81ed9232f355b5c6dc`, the appended SPN-123 decision record, generated JXA and host failure handling, the two native probe scripts/results and local control receipts. At final readback the previously dirty repair had been committed as `04cfb15562db47562c7be0499ae74206cb879c67`; the worktree was clean. This observation does not substitute for reviewing the later complete main-integrated candidate.

Reviewed file SHA-256:
- `scripts/ci/desktop-safari-identity.ts`: `4cfefd35b46be423a151b24c6642359a794f26e3650167218a5f71501d36a7a8`.
- `scripts/ci/desktop-safari-identity.test.ts`: `609faeb0ff889019af1fc7399217a4c644e0c3435deeda4d6911c9842963174a`.

## Correctness and boundary assessment

The original `string` return binding attempts to turn a successful NULL `dlerror` result into a native string. The retained original probe reproduces the NULL-cString exception. The separate opaque-pointer probe demonstrates that even NULL is a truthy Ref, so JavaScript truthiness or comparison with JavaScript null cannot repair this boundary.

The new sequence captures the loader/error/equality functions before observing loader state, calls `dlerror` twice consecutively to obtain a known NULL reference, calls the fixed system AppKit executable once, then reads its error immediately once. It compares opaque pointers rather than dereferencing, coercing an address, inspecting a Ref property or constructing a C string. Error-pointer rejection precedes handle validation; both precede class/process lookup and any Safari authority. The image remains loaded until helper exit. These are narrow changes with no new loader search path, arbitrary library input or unload race.

Apple documents that `dlerror` resets its thread-local error and an immediate consecutive second call returns NULL. Its JXA documentation explicitly exposes `Ref.equals` for opaque-pointer equality and `ObjC.bindFunction` for declared native signatures. Using a pointer-shaped return avoids string marshaling; the local probe additionally validates this concrete bridge behavior, including fixed missing-image NULL, non-NULL error, reset NULL and successful AppKit/class resolution. Sources: [Apple dlerror manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/dlerror.3.html), [Apple JXA Ref and function binding](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html).

The source inserts no logging or bridge-symbol lookup between the immediate reset/load/error calls. Native binding/reset/load/read/comparison exceptions propagate as the original failure. Fixed loader failure messages expose neither the raw loader string nor pointer addresses. Existing phase records remain bounded; the repair adds no document-content capture. Existing process PID/bundle/liveness/launch-date checks remain before action dispatch. `identify` returns before `Application(pid)`. The eight-second host process timeout and supplied action timeout remain unchanged, with no action or loader retry and no alternate fallback. This does not cure or bypass Apple Events consent or constructor failures.

## Meaningful verification and limits

The revised deterministic fixture represents each pointer as a distinct truthy function proxy, rejects pointer-property inspection, and compares hidden addresses through its explicit equality boundary. It therefore would reject the old truthiness behavior instead of silently treating native NULL as JavaScript null. Ordering assertions require all three error reads before comparisons and forbid phase logging inside the critical sequence. Controls cover binding/reset/null-reference-read/load/error-read/comparison exceptions, NULL handle, non-NULL loader error, missing class and identity failures before teardown. Successful title/evaluate/baseline/quit behavior retains its established authority and parameters.

I inspected the retained 29/29 passing log and watchdog: 222 ms, peak 92,896 KiB, pressure 1. Scoped typecheck passed in 327 ms, peak 171,056 KiB; formatting invocation passed in 385 ms, peak 195,936 KiB. The format receipt is a successful formatter invocation, not a repository-wide lint or independent clean-install check. No reviewer test or native/browser workload was run.

The native pointer-equality probe reports all six expected booleans true in 51 ms; the original failure is retained separately. These local observations support the ABI/null-handling mechanism on the observed environment. The VM fixture cannot prove native bridge behavior on every hosted architecture, and neither probe exercised Safari, process identity, Apple Events, offline storage or document assertions. No additional speculative local probe is required by this review; fresh selected native acceptance owns that remaining boundary.

## Scope, personas and disposition

The repair is proportionate: two pointer comparisons and one contractual NULL reference replace incorrect string/truthiness assumptions without a generic FFI abstraction. Operator benefit is diagnosable bounded failures and restricted authority; Owner and Collaborator benefit is preventing invalid cleanup/action authority; Link guest access and document boundaries remain unchanged. The native diagnostic does not claim product correctness merely because the loader can resolve a class.

Proceeding toward the complete main-integrated candidate and its feasible checks is supported. Preserve the original failed loader evidence and both probe identities. Final candidate review must include main integration, complete ticket scope, routing and durable evidence; two independent qualifying exact-head grades and fresh current-source CI/native acceptance remain outstanding. The previous mobile 110.4 ms capacity failure and callback baseline timeout are not explained or waived by this loader repair. The previously consumed workflow allowance is not renewed by this provisional review, and no Safari run is authorized or executed here.
