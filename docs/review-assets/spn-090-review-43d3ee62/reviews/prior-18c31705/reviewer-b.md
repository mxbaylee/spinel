# 🔎 SPN-090 independent full review B

Reviewed candidate **18c3170590c162bebe118a17e4b47d7df40f36ad** against actual base
**c525aa933505d6e78b8fdd7a89940d87506d5cb3** in
`/Users/mxbaylee/projects/spinel-spn-090-current`. Review is read-only and
nonimplementing; **agent review only**. No commits, pushes, PR edits, provider
operations or changes to the pre-existing untracked artifacts were made.

**Result: 95/100; changes required.** One in-scope P2 regression requires a local
production repair and meaningful lifecycle regression coverage. Exactly 95 does
not satisfy the repository's above-95 gate. This is not a deduction for any CI
result or missing hosted execution.

## 📏 Full rubric and every step to 100

- Ticket scope and acceptance: **35/35**. The complete XL outcome and approved
  verification ownership are represented; the parent does not silently complete
  the distinct SPN-154/156 launch outcomes. Pending actual acceptance stays pending.
- Correctness, integrity and access boundaries: **22/25**. **B1, -3:** stop the
  bootstrap status lifecycle when a guest application has actually taken over.
  The new global startup timer currently remains active throughout every guest
  session. Repair locally at the production guest/application lifecycle boundary,
  retaining the account sign-in/saved-files waiting stages. Do not simply stop all
  startup reporting immediately after `startApplication()` returns: that return
  does not prove React has rendered or account admission has completed.
- Regression protection and verification: **18/20**. **B1 coverage, -2:** add a
  test through the actual mounted guest/startup boundary, with controlled time,
  that would fail on this candidate. Cover a successful guest mount and the
  guest's terminal/rejected view as applicable, show no startup status remains
  after the threshold, and retain the pending-account-stage behavior. Extend the
  existing appropriate component/native owner; a regex assertion, calling
  `startupDone()` directly, or another test of the timer helper alone does not
  protect the missing production wiring. This is local work, not hosted-only.
- CI/operational usability: **10/10**. Source-sensitive selection, fail-closed
  aggregates, bounded diagnostics, retired-provider removal and truthful runbooks
  remain usable. Hosted results are independent merge gates and cost no points.
- Maintainability/documentation/process/complexity: **10/10**. The public asset,
  warm catalog and persistence helpers correspond to real boundaries, with no new
  dependency/framework or speculative public abstraction. The large evidence
  history is clearly subordinated to the current checkpoint and preserves failure
  provenance. The 17,239 counted-line soft warning remains visible and XL accounting
  covers the full outcome, not merely the small integration edits.

These are **all** actionable deductions. Both are parts of the same concrete
regression, distinguishing faulty production behavior from the missing detecting
test. There are no additional one-point items, owner-decision deductions,
hosted-only deductions or impossible steps hidden from this list. Repair and
recommit, then independently revalidate the new exact head.

## 🐛 B1 — guest sessions never finish the new startup status

**Priority P2; must repair in this ticket.** Location: new calls at
`web/main.tsx:92` and `web/main.tsx:105`, ending at dispatch
`web/main.tsx:130`; `web/application.tsx:23` renders `GuestApp` directly for a
share route. The sole successful completion call is `web/App.tsx:352`, inside
`AccountApp`. Neither `GuestApp` nor the application guest branch calls it.
`web/startupStage.ts:18-25` therefore appends and updates a fixed `role=status`
line after eight seconds even when the guest editor or revoked-link answer is
already usable. It keeps saying `Still starting: styles (...)` indefinitely.
That is false status, unnecessary repeated live-region output, and can overlay
the bottom of a guest document. No private-data leak or data-loss claim is made.

Independent reproduction: `/tmp/spn090-review-18c31705/reviewer-b-guest-probe.ts`
asserts the actual production guest dispatch and absent successful completion
path, imports the actual unchanged `web/startupStage.ts`, and advances a small
synthetic timer/DOM fixture. It observed `Still starting: styles (9 s)` and then
`Still starting: styles (120 s)` with the interval active. This is an actual-module
plus static-dispatch reproduction, **not a browser or mounted-React execution**.
The existing startup tests all passed because completion tests explicitly call
the helper; they do not exercise guest integration. Reviewer A separately
confirmed the production call graph after I shared the concrete finding; no
scores were exchanged.

The fix must preserve slow account admission reporting, handle the guest's
initial lifecycle rather than polling/reconnect repeatedly, and avoid introducing
private account/token information into the public status. The regression test
must exercise the wiring itself. A generic maintenance blocker was considered
and rejected: `MaintenanceShell` always renders its children, so there is no
additional finding there.

## 🧭 Entire outcome, native behavior and authority assessment

I read the base ticket, AGENTS, process/run-backlog, all four personas, sustainable
testing and relevant design rules; inspected the complete changed-file inventory
and source diffs, current scope/phone-method records, repair evidence and new-main
integration records. HEAD was verified exact. The supplied full diff SHA256 is
`170fb55c6532d559bdcb060e1eb2b015e57838f2b4809968fd020a699913a69c`, matching
the packet. No original numerical historical assessments or old scored PR bodies
were used to determine this grade.

- **Startup and retained shell:** known-offline short-circuit and bounded worker
  navigation execute at the production boundary. Server-only guest/setup/invite
  routes do not obtain the private-capable saved shell. Deadline negative controls
  in the retained repair record fail when timeout behavior is removed. Splitting
  renderer dependencies retains dictionaries and execution order; its independent
  script test builds both coupling choices and executes the repaired graph.
- **Complete public installation assets:** emitted manifest and three PNGs use
  fixed public paths backed by hash-addressed bytes. Descriptor validation checks
  the complete path set; runtime admission checks digest/MIME/size/schema or PNG
  dimensions; old descriptors keep their original contract. No private IDs,
  tokens, arbitrary URLs or new authority are included. Existing-cache reads do
  not create/repair stores. The native offline suite checks exact manifest/icon
  hashes before and after cold launch, not merely existence or HTTP cache hits.
- **Account catalog and warm native opening:** fallback follows failed network
  requests, including owned timeout, and never overrides a real 403. It requires
  the prepared account, current account/navigation fences, existing store and
  usable device inventory; handles close on failure. Native Doc coverage asserts
  exact downloaded clipboard text on warm and first-list-failed deep-link opens,
  plus an actual 403 refusal. Catalog metadata alone cannot create a copy.
- **Reconnect and unfinished input:** device editor identity is retained across
  incidental refresh/reconnect; the existing native binding owns authority and
  replay. The Sheet case verifies the same canvas, exact unfinished cell text,
  unchanged server snapshot before Enter, and exact server cell after Enter.
  Retained negative control fails at canvas identity when the old handoff returns.
  This is materially stronger than an empty frame or saved-label assertion.
- **Persistence feedback:** download preparation does not await an unanswered
  browser persistence prompt. Late answers update only their exact still-current
  message/scope. Guide availability and final focus survive the answer; the
  existing interaction owner asserts stored bundle identity as well as UI.
- **Original product requirements:** offline-editing retains two-reload/exactly-once,
  viewer-without-outbox, cross-account refusal and crash-after-ack coverage;
  offline-recovery retains changed/revoked-document copies, exact unfinished
  native input, lost responses and failed local cleanup; offline-creation retains
  exact-once creation/reload and rejected destination recovery; offline-sign-out
  retains account locks, multiple tabs and subsequent account isolation. Exact
  Space-child routing and unavailable sibling refusal remain in the offline
  owners. This review did not rerun all these native owners locally or treat
  their presence as a current execution pass.
- **Provider retirement and splits:** BrowserStack workflow/harness removal is
  consistent with the base ticket. Historical Chrome data loss remains unexplained,
  and SPN-157's bounded non-recurrence audit is not presented as a causal fix.
  SPN-158 admission repair is incorporated without relabelling the older recovery
  503 success. SPN-154 and SPN-156 remain full pre-launch obligations; SPN-152 is
  explicitly owner-deferred. Closure of this parent does not allow launching past
  incomplete pre-launch work.

**Personas:** Operator benefits from bounded local/hosted ownership and removal of
ineffective paid orchestration without account-content access. Owner gets retained
private documents, exact content and explicit limits on durability/phone evidence.
Collaborator retains permission fences, viewer states and unfinished work through
reconnect. Link guest retains token/account isolation but is directly harmed by B1's
false perpetual startup status; that persona must be repaired rather than treating
offline account behavior as the whole review.

## 🎨 Actual image inspection and applicability at this SHA

I used the image tool to inspect eight actual retained images: storage pending
light/dark desktop and light phone, refreshed startup light/dark desktop and light
phone, and the 192/512 installed icons. Desktop images are 1280×900, phone images
390×900; original capture provenance and focused-build limits remain those in
`visual/manifest.json` and `story-readiness/local-visual/manifest.json`.

Storage dialogs have readable theme-specific contrast, concise truthful pending
copy, paired bottom-right actions, visible restored focus and a phone layout that
fits with 16px margins and large controls. Startup text is low prominence and
fits without clipping at the captured widths. Both icons show the approved
faceted gem, warm background and optical offset with ample maskable margin. I
found no new styling/geometry defect in those captured states.

Independent hashing matched the original gallery's rendering/theme/icon inputs;
the startup story's changed hash matches the later readiness receipt, whose
only story repair awaits the same status. I inspected the actual SPN-159
`scripts/screenshots.ts` delta: it reads bounded drawing-fixture JSON and appends
geometry/transition diagnostics inside `nativeEditorGeometry`. It does not alter
startup/storage/icon rendering, viewport, theme or capture operations. Thus the
retained gallery is **applicable to the rendering of 18c31705**, without claiming
a fresh whole-build or current-head image execution. The original execution
captions must remain unchanged.

**Overall UI acceptance is withheld at 18c31705 because B1 adds an incorrect guest
state not represented by those isolated captures.** Applicable, visually sound
gallery evidence does not approve the broken guest lifecycle. Once repaired, a
fresh independent assessment can reuse unchanged pixels with original provenance
and inspect the detecting lifecycle evidence. This is **agent review only**.

## 🧪 My independent local receipts

All workload execution used pinned Node
`/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node`, the existing
`watch.ts` and shared `scripts/serial.ts`, after root granted the sole Mac slot.
The guard retained normal memory pressure, 2 GiB aggregate RSS and eight minutes.
Candidate-local seven `@spinel` workspace links were inspected. Vitest disabled
result caching and used my task-private module cache.

- `spn090-review-b-focused`: **161 tests, 14 files passed**, 5,502ms guard time,
  1,047,184KiB sampled peak. Owners: warm catalog/open, startup deadlines,
  production worker, shell/runtime, download/protection, bootstrap failure,
  icon, drawing resize, maintenance HTTP/ownership/supervisor controls.
- `spn090-review-b-script-controls`: **42 controls passed**, 223ms,
  345,584KiB sampled peak. Owners: fixture origin, offline image pixels,
  bootstrap evidence, renderer chunk execution, CI selection, session revocation.
- `spn090-review-b-guest-probe`: reproduction completed successfully, 112ms;
  peak recorded as zero because it ended before the 200ms sample, not zero real
  memory. This command passing means the reported defect was reproduced.

Exact commands and outcomes are in
`/tmp/spinel-dependabot-2026-11-11/spn090-review-b-{focused,script-controls,guest-probe}.json`;
logs and probe source are under `/tmp/spn090-review-18c31705/reviewer-b-*`.
The private Vitest cache was removed. An initial `rm -rf` cleanup command was
automatically rejected before execution; removal through Node's exact task-owned
path succeeded. No permission request or candidate modification was necessary.
Process inspection found no owned guard/serial/test descendants, pressure was 1,
and the slot was released. `git status --short` still showed only the pre-existing
`artifacts/` directory. No browser/compiler/build retry was performed.

## 🚦 Pending acceptance, without score deductions

All seven current-head hosted gates, selected actual Linux recovery/supervisor,
native content/access/replay/installation, ordinary desktop and full Storybook
owners still need their real current-source results. Prior resource-aborted typing
has no verdict; it was not repeated. SPN-159's full drawing owner is still required.
Original failed recovery run 43548838838 and failed-closed aggregates remain failed
at their original source even after prerequisite integration. Current exact
source/base/tested/run/attempt and failure dispositions must be kept in final PR
evidence; no prior green checks, local grade or gallery applicability transfers
those results to this head.

Physical confidence remains limited to the accepted targeted Pixel 10/latest
Chrome/Home Screen observations with unknown exact versions/build. The final
known-offline sign-in shortcut was not phone-retested, and not all physical
editing/reopen/replay/creation permutations were observed. The base specification
explicitly accepts that ownership/confidence tradeoff, so I neither deduct for
it nor invent a current-SHA phone pass. SPN-156's own repaired-build installed
observation remains its requirement. These are separate from the local B1 repair.
