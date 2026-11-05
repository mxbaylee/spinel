# 🔎 SPN-090 independent source review — 30fbfef9

Reviewed exact commit `30fbfef980a5f257b7879cf6dead0541ad207a23` against `origin/main` / original-ticket base `2f442317dd2e1c188ae4a810ac094fd1162a4a2a` in `/Users/mxbaylee/projects/spinel-spn-090-production`. This is reviewer A's nonimplementing pre-push review. **94/100; not qualified for validation publication.** A repaired commit requires fresh exact-head review. This is neither device-plan approval nor merge acceptance.

## 🧮 Rubric

- Scope and acceptance: **35/35**. Complete XL real-phone outcome remains recorded, including existing images, same-context restart, authored changes, reconnect/conflict, access boundaries, creation/recovery and remaining platform limitations. The new observation responds directly to the retained third-key loss. It does not claim to fix that loss or renew the consumed Safari allowance.
- Correctness, integrity and access: **22/25**. Deduct three for the concrete cleanup path below.
- Meaningful regression protection/evidence: **17/20**. Deduct three because current fake-driver cleanup controls miss the actual diagnostic wrapper's prerequisite failure. VM controls otherwise cover important observer ownership, pending dispatch, immutable snapshots, overflow and privacy boundaries.
- CI and operations: **10/10**. Existing full-input classification includes `scripts/ci/`; selected missing/failed work remains fail-closed. Physical execution remains separately gated. Local and hosted evidence distinctions are explicit.
- Maintainability/process/over-complexity: **10/10**. The bounded dedicated helper is justified; no speculative input fallback, generic recording framework or new dependency. Necessary ownership/schema safeguards are not unnecessary complexity.

## 🛑 P2 — screenshot failure can skip observer removal

At this exact commit, `scripts/ci/browserstack-acceptance.ts:754–759` invokes the sole observer-removal read through `driver.diagnose(stop)` after an input failure. The real hook is `failureDiagnosis`, wired in `browserstack-capability.ts:2196`. In `scripts/ci/browserstack-offline-preparation.ts:53–61`, it awaits the stalled screenshot **before** calling `work()`. A rejected screenshot therefore prevents `stop()` from running. The original input error remains primary, but the temporary listeners/event references remain installed until later page/session teardown, and the requested final removal observation is never attempted. This violates the newly claimed owned-removal contract precisely on a plausible failed-provider-evidence path.

Fix the shared hook so diagnostic screenshot failure cannot bypass its one work callback; preserve the original command and both failure identities without replaying actions, reads or journal writes. Record successful stop evidence inside the callback so a later wrapper rejection cannot erase that successful cleanup result. Add a control using the actual hook with screenshot rejection, plus nativeType integration proving one stop, original input failure precedence and truthful diagnostic-versus-removal outcomes. Parent and reviewer B identified the same path; I independently verified the committed call chain. No workload was needed to establish it.

## ✅ Other inspected boundaries

The new recorder uses eight fixed passive capture listeners and at most 16 retained event references per marked range. It copies only fixed event metadata, never key text, input data, editor values or document contents. Post-dispatch prevention is observed only once the event leaves dispatch; unresolved events fail the observation requirement. Overflow stays visible after the next mark. Removal/replacement ownership checks prevent an old counter from deleting its replacement. Range sequence is observation order, not causal attribution to a particular key; the maintained decision accurately preserves that distinction.

Native actions still send each key once with the same release behavior and 2,000 ms insertion wait. No resend or new readiness loop is introduced. The deadline's failed snapshot stays separate from a late insertion observed during cleanup. Failure and recording precedence otherwise remain intact; runtime/browser behavior is not inferred from the VM fixture.

The complete PR remains large (reported committed checker: 29,617 changed lines; the focused d4ee-to-30fb change is six files, 661 additions/135 deletions). Earlier reviewed application/storage/startup/renderer/quota/provider changes remain part of this XL acceptance outcome. I reconciled the full base diff inventory and original ticket with that retained review history and inspected the new delta directly. A small diagnostics-only split cannot truthfully declare the parent phone outcome delivered. No unrelated cleanup or speculative abstraction is needed for this change, but the broad PR is not a substitute for final current-source application and physical evidence.

All four personas remain represented: Operator gets bounded sanitized evidence and explicit failures; Owner gets no hidden replay of a lost edit; Collaborator retains actual document and conflict assertions rather than event-count-only acceptance; Link guest retains token isolation/revocation and no broadened offline authority. No changed UI state was introduced by this delta. Prior agent visual approval remains on its recorded fixture/source, not a physical-device pass.

## 🧪 Evidence and remaining gates

Read retained final control logs: 97/97 combined observation/acceptance/capability tests passed, zero skipped/cancelled, 36,157 ms parent watchdog / 751,360 KiB peak / normal pressure. CI-plan controls 11/11 passed, 260 ms / 90,368 KiB. Scoped types, lint, format, backlog and PR-check receipts are retained under `/tmp/spn090-input`; initial type failure and local-install limitations remain disclosed. I did not repeat tests, build, install, access the provider or run a browser.

Current-head full installed application checks, hosted selected owners and physical acceptance remain pending. Safari run `42080221117` remains a first-failure result: intended `731`, observed `73`; this observation patch does not retrospectively explain or repair it. The allowance is closed. No new device execution is approved here. Even after the source blocker is repaired and two exact-head reviews qualify, any physical attempt still needs its separately recorded finite plan and prerequisites. SPN-090 remains incomplete and unmergeable pending the complete outcome.
