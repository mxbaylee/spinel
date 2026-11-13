# 🔎 SPN-149 independent review A — repaired candidate

## Verdict and immutable identity

**Score: 100/100. No actionable findings or unresolved blockers remain in this candidate.** This is a read-only, independent revalidation of the complete current rubric. It is not a hosted acceptance result or a merge authorization.

- Candidate: `db24230dd4df539e2055471f55e50a402596c1fb`.
- Tree: `42cd4dfe89d0281ff5b11aa984053bd0493e22bb`.
- Base: `04baabd6a68abe7c0b225f8699681532e2205b60`.
- Prior reviewed candidate: `8ee824a9787c630f7c9b02263461280611f68d59`.
- Reviewer: independent nonimplementing agent `/root/review_a`.
- Date: 2026-11-13 UTC.
- Repository: `/workspace/scratch/13a7bba7afec/spinel`; clean before and after inspection.

I did not edit the candidate, commit, push, trigger remote validation, run a browser or run a full test matrix. Only the focused controls and read-only source/evidence checks were executed. This report and its control-run logs are outside the repository.

## Full current rubric

| Category | Score | Current assessment |
| --- | ---: | --- |
| Ticket scope and acceptance criteria | 35/35 | The bounded conditional investigation, actual closure and denial requirements, surviving-login content contract, first-attempt evidence and owned cleanup remain complete. The setup-failure cleanup exception identified in the first review round is now bounded. |
| Correctness, data integrity and access boundaries | 25/25 | Successful establishment, every frozen target’s protocol close, no reopening, an intact observer and HTTP 401 are all required. The original two-login journey separately verifies the other session’s forwarded queued write, saved cell and native reloaded value. No application authority or transport policy changes. |
| Meaningful regression protection and local verification | 20/20 | All 19 focused controls passed independently on this exact candidate. The added mocked-timer control exercises the actual setup catch with a never-settling detach and proves the existing 5,000 ms bound and identical original error. Retained source hashes and repair verification logs match the candidate. |
| CI and operational design | 10/10 | Existing unit/browser owners, source/shared-dependency routing, fail-closed aggregates and first-attempt JSON artifact retention remain intact. No extra browser matrix, weakened gate or changed retry policy. |
| Maintainability, documentation, process and over-complexity | 10/10 | The repair reuses the existing bounded cleanup function and adds one focused control. Pinned Apache source attribution, original header and extraction notice now satisfy repository policy. The complete history, findings, repaired-source identities, all attempts and bookkeeping remain durable and accurate. No unnecessary abstraction or dependency was added. |
| **Total** | **100/100** | **No deductions.** |

No points are withheld for pending, absent or other hosted CI status.

## First-round finding disposition

Both first-round findings are valid and repaired; their original reports and evidence remain retained in `docs/implementation/evidence/SPN-149/review-iteration-1.json`.

### Failed observer setup now has bounded cleanup

At `e2e/session-revocation.ts:117–122`, the `Network.enable` rejection path now calls `cleanupSessionRevocation([{ name: 'observer', run: stop }])`, then rethrows the original setup error. `stop()` still removes all owned CDP/page/socket listeners before awaiting detach (`:103–115`). A rejected or never-settling detach cannot keep this setup failure pending indefinitely.

The new control at `scripts/ci/session-revocation.test.ts:237–275` makes enable reject and detach remain pending. It verifies removal of owned listeners and a single detach attempt, remains pending at 4,999 mocked milliseconds, then rejects at 5,000 ms with the same primary error object. It passed in my exact-candidate run. The existing rejecting-detach and normal teardown controls still pass. The repair keeps the browser journey’s assertion budgets and overall deadline unchanged.

### Retained Playwright source has complete attribution

`docs/implementation/evidence/SPN-149/original-13557930894-playwright-source.json:62–63` now retains the Google/Microsoft copyright and Apache-2.0 header together with an accurate extraction notice. The snippets are unchanged source lines packaged as diagnostic evidence, with omitted surrounding code explicitly identified. `THIRD-PARTY-NOTICES.md:91–98` registers the exact evidence path, pinned Playwright commit, license and extraction. This repair does not modify the dependency or repeat the bounded investigation.

## Independent local execution

Command from the repository:

```sh
PATH=/workspace/scratch/cece61e42934/runtime/node-v26.13.0-linux-x64/bin:$PATH node ../validation/watchdog.ts ../validation/review-a-2-controls-watchdog.json node scripts/serial.ts node --test scripts/ci/session-revocation.test.ts > ../validation/review-a-2-controls.log 2>&1
```

Result: **19 passed; zero failed, skipped or cancelled; exit 0** on Node `v26.13.0`. The shared serial runner and watchdog recorded:

| Measurement | Result |
| --- | ---: |
| Start | 2026-11-13T04:13:06.223Z |
| Finish | 2026-11-13T04:13:06.806Z |
| Watchdog elapsed | 582 ms |
| Peak process-tree RSS | 230,868 KiB |
| Minimum system available memory | 8,097,124 KiB |
| Resource abort | None |

The parent was notified immediately after the run, releasing the local workload slot for reviewer B.

Logs are `/workspace/scratch/13a7bba7afec/validation/review-a-2-controls.log` and `/workspace/scratch/13a7bba7afec/validation/review-a-2-controls-watchdog.json`.

## Full-contract and evidence revalidation

I inspected the complete incremental diff, the full current base-to-candidate file inventory, changed source and documentation, updated local-validation manifest and first-round report retention. I reused only unchanged evidence from my original full review, with its original source identity preserved in `/workspace/scratch/13a7bba7afec/validation/review-a.md`. The required repository rules, original ticket, personas, testing policy and runbook are unchanged.

The complete revocation contract remains in `e2e/collaboration.spec.ts:365–567`: observed establishment before revocation, five-second actual protocol closure, sign-in/editor removal, denied requests, successful forwarding of the surviving login’s held write, its connection continuity, HTTP 200 and exact stored value, no later matching received frames during the queued-write/reload window, native reloaded value and final denial. The browser-case bytes are unchanged from the first review.

The helper’s bounded content-free event log and fail-closed state remain unchanged apart from setup cleanup. Navigation and legacy page-close events cannot satisfy closure. Existing negative controls still cover unestablished/wrong/live sockets, active authorization, multiple targets, reopening, observer loss, overflow, private-data exclusion and listener ownership.

The previous review verified that the pinned Playwright JSON reporter serializes body attachments into each attempt’s report and that the existing workflow uploads those reports. Those reporter/config/workflow bytes are unchanged. The 60-second journey, five-second closure poll, existing save/readiness bounds, retries and `failOnFlakyTests` are unchanged. No native execution or historical causality is inferred from the browser-free probe.

I independently verified every one of the 14 updated `sourceSHA256` entries against this candidate. The repaired source commit `8ea17ad308b5fe77b293f58f35c803575cede0d6` has recorded tree `924001dbca2b2e27d24fc40d6ccbdc28b68eff3f`. Its difference from this candidate is limited to the implementation record, validation manifest and first-round review record; executable bytes are identical.

I read the actual repaired controls/typecheck/lint/PR-check logs. They support the manifest’s successful results, including dependency and full formatting checks within lint. The manifest accurately distinguishes those pre-commit byte-identical source checks from final committed-source verification. My control run above independently executes the complete committed candidate.

The original probe declaration, two-ordering result, original artifact/member hashes and missing historical first-attempt timeline retain the identities verified in the first review. The new record keeps the earlier failure and all later attempts instead of replacing them with a repaired pass. The failed pinned-browser installation remains unavailable local acceptance.

CI selection and package test inclusion are unchanged. All applicable source/shared inputs still select their owners, selected missing/skipped/failed/cancelled work still rejects, and the 19-control suite remains in the existing Node test glob. Bookkeeping continues to remove only SPN-149, retain its Rules and decision rationale, append its completion without resetting allocation/grooming state, and show 22 open tickets in the generated index. All four personas remain considered. There are no product UI changes requiring visual review.

## Every remaining actionable step to 100

**None.** There are no local repair deductions, hosted-only deductions, owner-decision deductions or impossible steps in this review.

## Separate pending acceptance

Actual development and production Chromium first attempts, their separately retained configured retries if needed, all seven current-head gates and every selected worker remain required. The finite native sample must record whether natural recurrence is observed or not reproduced. The original failed attempt remains failed and its missing ordering remains unavailable.

The final PR or immutable receipt must retain both new independent reviews on this exact candidate, actual tested-merge/run identities, first-attempt diagnostic and cleanup outcomes, and every failure/retry disposition. Any subsequent candidate or base edit requires both reviewers to revalidate the new SHA. No publication, hosted gate pass, native acceptance or merge is claimed here.
