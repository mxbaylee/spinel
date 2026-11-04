# 🔎 SPN-141 integrated Safari first-failure review B

Independent nonimplementing review, 2026-11-04. No source edits, native execution, rerun or resource workload performed. Inspected retained acceptance/log evidence, current storage helper/caller and original base ticket; verified the artifact hash and viewed the useful failure screenshot.

## 📌 Identity and observed failure

Source `388262cc619f6caa162bc71881f22a714d0ddf69`; tested merge `b684654080d4f22cc1cf8d03e56cc523f4df3d57`; native run `41900102794`, attempt 1, Safari job `126819901608`, artifact `13359075911`. ZIP SHA-256 `0c0148ac6d286b3d5f5c01c55ff152054c6f61f458d5f557f125a05107e0b318`.

The first failed contract is storage quiescence after same-profile restart. It is not the SPN-140 Application(pid) constructor failure. Earlier content, reconnect and conflict stages completed; storage-loss and subsequent missing-copy acceptance did not.

- At 19:56:26.238Z, inventory had one fixture tab at the inert URL. The selected document reported the expected marker and zero scripts.
- Unregister returned true at 19:56:26.473Z. At 19:56:26.476Z, registrations were empty but the existing document still had controller `https://localhost:8176/service-worker.js`.
- Browser PID 7804 exited, witnessed at 19:56:27.645Z. PID 11512 reopened the same profile. Its inventory still contained one inert fixture URL.
- At 19:56:34.873Z, strict `verify-uncontrolled` found root registration plus that controller. The deletion report failed before any caches.delete, localStorage.clear or indexedDB.deleteDatabase operation.
- Final PID 11512 exit was witnessed at 19:56:38.577Z. The evidence has no teardown-error field; this is not a claim that every browser-internal worker was independently observed exiting.

The useful `safari/failure-screen.png` shows Safari on the localhost storage-loss preparation page. It exposes no visible credentials or personal content. It supports the inert-page context, not controller absence or storage deletion; JSON supplies those facts.

## 🧭 Source and lifecycle interpretation

`desktop-storage.ts` intentionally lets the unregister phase pass with a surviving controller. `desktop-offline.ts` immediately stops the browser after that phase; it supplies no explicit fresh-document boundary while the browser is alive. The strict deletion phase correctly rejected the restored registration/controller and protected mutation ordering.

The Service Workers specification explains that unregister does not immediately detach existing controlled clients. Registration clearing is retried after the last client unloads or extended events settle; it requires no clients using the registration and no pending worker events. This supports replacing the controlled document before shutdown as a concrete lifecycle repair. It does **not** prove why this Safari run restored a registration, establish a browser bug, or guarantee that document replacement alone makes persistence reliable. [W3C Service Workers: unregister and registration clearing](https://w3c.github.io/ServiceWorker/).

The hypothesis is that stopping while the unregistered worker still owns the inert document leaves a lifecycle/finalization boundary unestablished. Browser-internal persistence was not observed. Preserve that uncertainty and the original failed run.

## 🛠️ Bounded repair disposition

The proposed repair is within SPN-141's existing L scope: after once-only unregistration, issue one explicit new-document handoff for every fixture-origin tab while the owned browser remains alive, then require fresh inert documents with null controllers and zero registrations before normal shutdown. Keep same-profile restart and the current strict post-restart precondition, targeted database deletion, empty-cache checks and subsequent missing-copy assertions.

A URL inventory alone cannot establish fresh-document or controller state. A same-document hash navigation or an ignored assignment must not satisfy this boundary. Preserve per-tab identity/membership and observe each replacement, including background fixture tabs; leave unrelated origins untouched. Read-only readiness observations may be bounded by existing budgets, but must not repeat navigation, unregister, deletion, or swallow a failed native request. Null controllers/empty registrations are observable preconditions, not proof that all outstanding extended worker events have completed; the process-exit and post-restart checks remain necessary.

Useful focused controls, before another exact-source review:

- The original surviving-controller state must not advance directly to shutdown/deletion; a real fresh document is required even when the tab was already inert.
- A no-op/same-document handoff, wrong marker, nonzero scripts, surviving controller or new registration fails without storage mutation.
- Multiple fixture tabs each receive exactly one handoff and each gets checked; unrelated tabs remain untouched; missing/new/duplicate/ambiguous identities fail.
- Navigation rejection, timeout or verification failure preserves its first cause and cleanup without renewing the mutation or native request.
- Successful pre-stop checks cannot bypass a restored registration/controller after restart; deletion still remains untouched on that negative case.
- Preserve existing denial, blocked database, recreated cache, exact content and post-loss assertions.

This protects the Operator's trustworthy acceptance signal and the Owner/Collaborator/Link guest's persisted-content and access contracts without changing product behavior or weakening checks. No unchanged-source rerun is justified. A concrete repair with focused controls, both exact-head reviews and a declared finite first-attempt native workflow is the appropriate next step. Current source remains blocked for merge; no new grade or acceptance pass is issued here.
