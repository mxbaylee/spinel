# 🔎 SPN-090 independent review B — repaired candidate

**Reviewed exact commit:** `724b577791273e0962ff08a38dea77a5aa632d84`.
**Actual base:** `c525aa933505d6e78b8fdd7a89940d87506d5cb3`.
**Previous reviewed candidate:** `18c3170590c162bebe118a17e4b47d7df40f36ad`.
Worktree: `/Users/mxbaylee/projects/spinel-spn-090-current`.

**100/100; no remaining actionable findings.** The production defect and missing
detecting lifecycle coverage identified in B1 are repaired. **Independent visual
and interaction approval at this exact SHA: approved; agent review only.** This
review is not a hosted/production/device acceptance pass or permission to merge
without the repository's other gates.

## 📏 Complete rubric and scope

- **35/35 — ticket scope and acceptance.** The full original XL outcome remains
  the basis of assessment: installed lifecycle investigation, bounded public
  startup/assets, private account catalog/native opening, unfinished input through
  reconnect, authority, truthful storage feedback, icon integration and provider
  retirement. The six-line guest repair closes an in-scope defect; it does not
  replace this outcome with a small integration-only review. The approved targeted
  physical method and separate pre-launch SPN-154/156 outcomes remain explicit.
- **25/25 — correctness, data integrity and access.** GuestApp now ends the public
  bootstrap reporter in its actual mount effect, before its capability branch.
  The existing guest UI owns loading/unavailable/terminal states after that mount.
  Account admission still owns its own completion, and the new test observes it
  waiting. No authority, persisted storage, replay, token exchange or native-editing
  behavior changed. The earlier B1 production deduction is resolved.
- **20/20 — regression protection and evidence.** Five actual application/browser
  controls cover successful guest mount after held import, unavailable/revoked/
  unsupported guests, and held account admission. They check real DOM status and
  real interval disposal, not a direct call to the helper. The retained unpatched
  negative fails on the visible line after a ready Space mounts. I independently
  ran all five on this exact candidate; all passed without retries. The earlier
  B1 coverage deduction is resolved.
- **10/10 — CI and operational usability.** The new owner fits existing development
  and production selection. Development proves mounted lifecycle; production
  separately proves the emitted application import boundary and remains pending.
  There is no new environment, broadened timeout, disabled assertion or weakened
  aggregate. Existing source-sensitive selection and fail-closed gates remain.
  No CI result, including pending/missing/failing hosted results, costs points.
- **10/10 — maintainability, documentation and complexity.** The smallest production
  fix is colocated with the guest lifetime. The controlled clock/timer wrapper is
  justified by proving both visible cleanup and actual disposal without replaying
  two minutes of unrelated polling. Exact input hashes, first failures, the type
  correction and negative-control provenance remain recorded. The complete
  18,169-line soft warning is not disguised by the six-line production delta.

**Every step to 100:** none remain. There are no hidden one-point items,
hosted-only or owner-decision deductions, or waived local repairs. Current hosted
acceptance and the recorded physical-confidence limits are separately pending.

## 🛠️ B1 revalidation and test quality

At `web/GuestApp.tsx:41`, the unconditional mount effect calls `startupDone()`.
It precedes the missing-Web-Locks branch, so unsupported guests also dispose the
reporter. React's development effect replay is safe because completion is
idempotent. Finishing here leaves the still-loading guest UI responsible for
its own status rather than falsely reporting that app styles are pending.
`web/App.tsx`, `web/main.tsx` and `web/application.tsx` are unchanged by the repair.

`e2e/startup-lifecycle.spec.ts` mounts the real bootstrap, dispatch, GuestApp and
Space with scoped deterministic HTTP responses. The held application request
first proves that the observed one-second interval produces the real pre-React
status; after release it proves a real named empty Space mounts, the status is
removed, and the same interval handle is cleared. Moving wall time and ticking
once proves it stays absent after 120 seconds without exhausting unrelated
network deadlines. Unavailable, revoked and unsupported entry controls exercise
the actual guest branches. The pending account test holds the real
`/api/auth/session` endpoint and verifies that sign-in reporting remains active.

I inspected the full test/production delta, canonical decision, README, all eight
final-input hashes, retained test snapshot hash, negative context/image and relevant
attempt logs. The eight positive execution input hashes match this candidate.
The negative's preserved pre-type-correction test matches its stated digest; its
later DOM-only `Window` typing repair does not change the assertions/callback.
The negative image shows an actual ready Space with the erroneous bottom status,
corroborating the failure at the real line-removal assertion. It is diagnostic
failure evidence, not a proposed successful design.

The first ready-case failure queried a phone-only control in desktop; the first
account-case failure held the wrong endpoint. The retained contexts support both
fixture diagnoses. The initial full compiler found a real Node/DOM timer overload
error; the DOM `Window` reference resolves that boundary. Final full typing and
five positive cases are recorded separately, without rewriting the first failures.
No additional negative-control rerun was needed or performed.

## 🧭 Full outcome and all four personas

My previous complete assessment remains applicable to every unchanged source input;
I verified that this repair's entire 19-file delta consists only of GuestApp, the
new lifecycle owner and maintained evidence/decision records. Earlier independent
161-test/14-file and 42-script-control runs remain attributed to `18c31705`, not
claimed as new executions here. The prior review is
`/tmp/spn090-review-18c31705/reviewer-b.md`.

The retained shell still validates complete public manifest/icon assets and old
descriptor compatibility. Warm opening still requires the prepared account,
current navigation/account lifetime, existing store and usable copy; a real denial
does not fall back. Native Doc exact-content/deep-link and Sheet unfinished-input/
server-ack assertions remain intact, with their original detecting controls and
execution identities. Persistence answers remain fenced to the exact current
result and account scope, and guide/focus behavior is unchanged.

The original editing, images, two-reload/exactly-once delivery, crash/lost-response,
conflict recovery, creation/rejected destination, history, account switching,
viewer/revoked access and exact Space-child/guest exclusion owners remain required.
I do not equate inspecting their source or old native receipts with a current-head
hosted run. Provider history, including lost data of unknown cause and the old
recovery 503, remains accurately failed/unknown at its original source. SPN-158
and SPN-157 completion do not retroactively pass it.

Operator retains bounded diagnostics, no private-content access and no retired paid
provider work. Owner and Collaborator retain saved work, exact content/replay and
permission guarantees, with truthful account startup while admission is pending.
Link guest now gets truthful guest-specific status without a perpetual public
startup timer; its token/account boundaries remain unchanged. These are meaningful
effects for all four personas, with no new human approval or product dependency.

## 🎨 Exact-head visual and interaction approval

**Approved at `724b577791273e0962ff08a38dea77a5aa632d84`; agent review only.**
I previously inspected the actual retained eight-image gallery using the image
tool: pending storage light/dark desktop and light phone; refreshed startup
light/dark desktop and light phone; 192/512 installed icons. Those rendering,
theme, story and icon sources and images remain unchanged in this repair.
The current review additionally inspected `guest-startup/negative-visible-line.png`
using the image tool and independently executed the repaired DOM/timer interactions.
The previous overall approval hold is now resolved by actual mounted lifecycle
proof, while the unchanged captured typography/layout remain applicable.

Storage dialogs retain readable theme contrast, truthful copy, visible focus,
bottom-right actions and usable phone margins/targets. Startup typography fits
the captured desktop/phone widths. Icons retain the approved facet palette,
optical offset and ample maskable margin. No new component, layout, theme or copy
was added by the repair. The diagnostic failure PNG is not represented as a new
positive screenshot.

The earlier independent SPN-159 screenshot-runner assessment still applies:
`nativeEditorGeometry` adds bounded drawing-fixture diagnostic fields only; it does
not alter startup/storage/icon rendering or capture operations. Full hosted
Storybook still owns the current drawing fixture. Original gallery execution
captions, dimensions, themes and focused-build limits must remain intact; this
approval does not claim newly captured whole-build output.

## 🧪 Independent exact-head local execution and cleanup

Root granted the sole local workload slot after the other reviewer released it.
I used pinned Node 26.13.0, the shared `scripts/serial.ts` via `watch.ts`, normal
pressure, 2GiB combined RSS and the eight-minute cap.

Command environment: `SPINEL_E2E_PROJECT=development` and PATH preferring
`/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin`.
Guarded command:

```text
node node_modules/@playwright/test/cli.js test e2e/startup-lifecycle.spec.ts
  --project=development --workers=1 --retries=0
  --output=/tmp/spn090-review-724b5777/browser-output
```

**Five tests passed, zero retries; 6,973ms guarded elapsed; 1,200,496KiB sampled
peak; exit 0; no resource-guard reason.** Exact receipt:
`/tmp/spn090-review-724b5777/reviewer-b-lifecycle-receipt.json`; complete log:
`/tmp/spn090-review-724b5777/reviewer-b-lifecycle.log`. Original watchdog receipt:
`/tmp/spinel-dependabot-2026-11-11/spn090-724-review-b-lifecycle.json`.

After completion, process inspection found no owned guard, serial, server or
Playwright browser descendants; pressure was 1. The slot was released. Tracked
source remained unchanged and only the pre-existing `artifacts/` directory was
untracked. No production build/compiler/full native rerun, source mutation,
commit, push, PR edit or provider action occurred. Task-local browser output and
review receipts are retained for audit.

## 🚦 Acceptance still pending, with no score deductions

All seven exact-head hosted gates and selected actual Linux recovery/supervisor,
native content/access/replay/installation, ordinary desktop and full Storybook
owners remain required. In particular the new production lifecycle owner must
exercise the packaged import boundary on the published source. My development
pass does not certify that boundary. The earlier resource-aborted compiler has
no verdict; the repaired candidate's new full typing result is separately preserved.

The accepted Pixel 10/latest Chrome/Home Screen observations still have unknown
exact versions/build; the final known-offline shortcut was not phone-retested,
and the full physical edit/reopen/replay/creation permutation matrix was not
observed. No current SHA is attached to those observations. SPN-154/156 remain
complete pre-launch obligations and SPN-156 retains its own installed repaired-
build observation. SPN-152 is owner-deferred. The base specification explicitly
accepts this confidence/ownership boundary, which this repair does not broaden.
No pending result was deducted or reclassified as passed.
