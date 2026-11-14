# 🧪 SPN-090 independent full-outcome review A

**Candidate:** `43d3ee62bab1ed1d1b6d76209308f63f6e6aab07`.
**Actual base:** `ec42f0741415e4e712395fb47c30b911bc4e64ea`.
**Reviewer:** independent nonimplementing agent `/root/spn090_integrated_a`; **agent review only**.

**Result: 100/100. No actionable findings or unresolved review blockers. Exact-head visual and interaction applicability approved.** This assesses the complete XL SPN-090 outcome, with focused revalidation of the repairs and integration since my prior review. Required current-head hosted acceptance remains pending. CI results incur no deductions and this assessment is not a merge authorization or a claim that those gates passed.

## 📏 Complete rubric

- **Scope and acceptance — 35/35.** I reviewed both the original ebf0842f ticket and actual-base ticket, the full candidate against actual main, current canonical decision/mapping and all four personas. The original offline lifecycle, content, image, persistence, authority, replay/conflict, stable-link, shortcut and installation obligations remain accounted for. The accepted targeted Pixel/Home Screen plus shared-native method is explicit, as are its reduced physical confidence and unavailable permutations. SPN-154 and SPN-156 retain full pre-launch scope and estimates; SPN-156 still requires its own repaired-build installed-phone execution. SPN-152 remains post-launch. Provider removal neither completes those outcomes nor erases earlier failures. The complete scope remains XL and the 19,437 counted-line soft warning is disclosed.
- **Correctness, data integrity and access — 25/25.** Original runtime safeguards and the previously repaired guest lifecycle remain intact. The new changes repair fixture ownership/readiness, not production behavior. Landed feedback integration passes verified account identity through existing surfaces without removing the Dashboard/native editor lifetime or authority guards. Guest contexts receive no account feedback authority or private offline state. I found no new data/access defect in the combined paths.
- **Meaningful regression protection/evidence — 20/20.** The corrected context route exercises the real production worker/packaged-import boundary and still detects the original missing guest completion. The invitation control observes actual POST delivery separately from once-only address publication and post-create readback; its health-only negative detects a missing navigation fence. Both retain meaningful native/DOM/state assertions and budgets, without sleeps or test retries. I independently ran six focused production cases and 112 focused shared/authority controls successfully. Historical failures remain failures; the diagnostic-only invitation probe is not accepted as replacement evidence.
- **CI and operational usability — 10/10.** Existing source/shared dependency routing, required aggregate behavior and project ownership remain intact. Development and production have distinct import/runtime owners; Linux supervised maintenance remains its hosted owner. Neither service workers nor `failOnFlakyTests` are disabled. Current gate status is separate from this score. Resource-aborted typing remains no verdict and is not silently passed or repeatedly retried.
- **Maintainability, documentation, backlog/process and complexity — 10/10.** The current incremental repair is limited to three existing test owners, source-bound evidence and canonical decisions. It adds no runtime architecture, package, permission or speculative abstraction. Large evidence growth preserves necessary exact identities and failure dispositions; the top-level records make current status discoverable. The source remains cohesive around offline startup/persistence/native behavior and its verification. Actual-base bookkeeping retains next ID161, grooming2026-11-14 and completed `[SPN-098, SPN-090]`; only SPN-090's ticket is deleted relative to that base, and the index is CLI-generated. No useful unique work or unrelated artifacts were deleted.

**Every actionable step to 100:** none remains. There are no hidden one-point deductions, local repair requests, hosted-only numerical deductions or owner-decision exceptions. Pending required hosted acceptance is listed separately below. A later source or bookkeeping change needs exact-head revalidation.

## 🔬 New repairs: independently assessed behavior

### Actual application delivery and guest startup

`e2e/startup-lifecycle.spec.ts:98` now uses browser-context routing rather than page routing for the application module. This covers the real service-worker-owned fetch in the production build while retaining ordinary frame ownership in development. It records the request owner without confusing network ownership with bootstrap's stage name. The exact `Still starting: app code` assertion remains, the real guest heading must be absent while held, and release must produce the ready empty Space, remove the status, clear the observed original reporter interval and stay silent beyond120seconds. The other guest unavailable/revoked/unsupported and still-pending account cases remain.

This is a precise response to the original production failure: the page-level route never saw the worker's application fetch even though the guest UI became ready. The repaired test does not skip service workers or substitute a mocked startup reporter. The held application path, real timer callback/handle, actual React dispatch and visible guest assertions make the proof stronger than the prior helper-only controls.

The retained production negative restores only old GuestApp lacking its completion effect, rebuilds, and fails because the startup line remains after the real ready guest mounts. Its first local mistaken expectation that a worker-owned request implied a `service worker` stage is retained and corrected to the actual `app code` stage. Runtime code and assertion budgets were not changed to fit that expectation. The positive source/build restoration remains explicitly recorded.

### Invitation publication is not readback completion

`e2e/maintenance.spec.ts:244` now waits for the actual Backups & health link to lose `aria-disabled=true`, then clicks that link. This follows the production navigation contract rather than navigating immediately after once-only link publication. I read AdminInvites' mutation/refresh lifetime and AdminPage's busy/link/hash guards: the published address precedes completion of the awaited refresh, so its presence is not readiness to leave the section.

`e2e/admin-layout.spec.ts:207` extends the existing held-readback control to prove the health link remains disabled, its event handler rejects navigation, and a direct health hash is restored to Invites while busy. After releasing the held503 readback, the actual link becomes enabled and navigation works. Existing real Escape during held POST, initial People guard, clipboard failure/manual copy, secret disappearance on departure/reload and API exclusion assertions remain. The retained health-only negative bypasses the health hash guard while preserving the older People guard and fails specifically at the new `#invites` assertion, receiving `#health`. That is a meaningful detecting control for the added boundary.

### Response readiness and honest unknown cause

`e2e/admin-layout.spec.ts:179` installs an exact pathname/method POST response observer before Create. After releasing the route, it requires status201 and successful `response.finished()` before the existing five-second address/focus assertion. A swallowed side catch only prevents an unhandled pending-promise rejection from replacing a primary assertion on cleanup; the same promise is awaited and actual response failure still fails the case.

Release permits delivery; it is not delivery. Separating these observable boundaries is appropriate fixture readiness, not relaxing the UI assertion. The original five-second assertion and30-second overall case budget remain; no timeout setting, sleep, blind retry or weaker expected result was added. The response observer cannot confuse the held GET readback with the POST.

The first combined development attempt remains failed with Creating visible and no address. Its durable row timestamp was approximately86ms **after** the reported case end. I inspected the retained diagnosis, journal and revised narrative: the initial within-case assumption is explicitly superseded, and the original cause remains unproved. The single diagnostic probe exposes POST hold/release/fetch/fulfill/browser-response and GET readback stages; it does not prove the old failure's cause or serve as acceptance. Final corrected positive runs and the detecting health negative are separate source-bound executions.

## 🧬 Full runtime, authority and landed-base integration

This resumes my previous complete independent SPN-090 review rather than treating the executable repair as the whole task. The full candidate runtime/config/test changes were inspected in the earlier review; this pass verifies the actual base transition, source differences and combined effect. Original independently examined safeguards remain:

- Browser-known-offline and bounded network failure can enter prepared account startup; guest/invite/setup do not obtain the private saved shell. Real denied server responses stay authoritative.
- Warm and first-list deep links require the prepared account, existing store, persisted catalog and verified available copy, with asynchronous account/navigation fences and handle cleanup. A shortcut or metadata row does not manufacture a download.
- An admitted native offline editor remains mounted through reconnect/incidental metadata refresh. The native binding retains authority/replay ownership and explicit navigation retains unfinished-input protection. The real Doc exact-content/403 and Sheet same-canvas/draft/server-ack controls remain.
- Hash-addressed installation manifest and180/192/512PNG assets are bound to the retained runtime, validated for digest/MIME/size/shape, and exposed through fixed public aliases without account or token URLs. Old retained builds keep their original completeness contract.
- Download completion does not wait indefinitely for a persistence prompt. A late answer is scoped to its original current result; storage guidance/focus remain available, and device copies are not represented as backups.
- Native shared owners retain exact server/local content, one durable revision/copy, lost acknowledgement and cleanup-crash handling, viewer no-outbox, wrong-account no-submit/exposure, revocation and exact Space-child routing. Their original execution identities remain attached to the evidence; not every owner was rerun locally by me here.
- Renderer output retains the narrow nonrecursive grouping/strict order fix, full offline dictionary inventory and actual-bundler negative/positive control. Bootstrap/native diagnostics remain bounded opt-in observations, not AI/product features.
- BrowserStack execution is retired as authorized. Historical provider data loss and the earlier recovery503 retain unknown cause and failed status. No new paid/device execution or causal claim is introduced.

I read the incoming feedback integration at the overlap: Dashboard adds only `feedbackAccountId={user.id}` to its retained frame; EditorFrame strips that context for guests; EditorTools/Space/Rail pass account context through existing boundaries. FeedbackDialog performs no request merely because an offline frame mounts—prepare is gated by deliberate open. Its mounted/account-generation/abort fences remain landed main's source. The actual native editor component/key and SPN-090 device-open logic are unchanged by this integration. `Controls.tsx` adds only `modalIcons.feedback`; it does not change the icons used by these storage stories. Incoming feedback is already landed actual-base scope, not a newly claimed SPN-090 design.

## 🧾 Independent checks and exact source identity

I read the supplied grade-free packet/body, original and actual-base tickets, repair and integration runtime diffs and maintained technical evidence. AGENTS, process/run-backlog, personas, sustainable testing and design guidance remain unchanged from my previous full review; I verified that no delta was introduced to them. I did not consult another reviewer's score, old scored PR bodies or unmasked inherited numerical review reports.

Independent read-only hash audit (`/tmp/spn090-review-43d3ee62/a-identity.json`) confirms:

- All ten files hashed in the packet provenance match.
- Packet `full.diff` is byte-exact `git diff --binary ec42f074… 43d3ee62…`, SHA256 `6558b682296fe628e049066de2b77c03a1cf42f09d44d254940b837049301ce2`.
- All48 final combined runtime/test input hashes match current files.
- All13 images match their original commit's recorded bytes; all10 retained current images match candidate bytes.
- All10 recorded current rendering-input hashes match, including the explicitly changed shared Controls input.

My initial diff-audit command unnecessarily added `--full-index`, so its header formatting differed from the packet. I corrected to the packet's `--binary` invocation and obtained byte equality. This was an audit-command mismatch, not a source or packet defect, and the disposition is retained in the audit JSON.

**Checks I actually ran on this candidate:**

1. Six production cases in `e2e/startup-lifecycle.spec.ts` and the held invitation case in `e2e/admin-layout.spec.ts`, selected with `--grep 'startup reporting|pending invitations prevent'`, `--project=production --workers=1 --retries=0`. **6 passed**, guard elapsed **5,543ms**, sampled process-tree peak **1,221,312KiB**, exit0/no guard reason. This used the worktree's existing combined production build from the maintained build receipt; I did not rebuild or claim a new build execution. The final input map confirms its recorded runtime inputs, and the subsequent readiness correction is test-only.
2. Focused Vitest `startupDeadlines`, `warmOpen`, `warmCatalog`, `feedbackContext`, `serviceWorker`, `spinelSync`, `--cache=false --fsModuleCachePath /tmp/spn090-review43-a-vitest-cache`. **112 tests in6files passed**, guard elapsed **1,281ms**, sampled peak **458,960KiB**, exit0/no guard reason. These include account/guest/revocation and production worker handler controls as well as the integration's shared context boundary.

Complete commands, logs and actual guard receipts are retained at:

- `/tmp/spn090-review-43d3ee62/a-production.log`
- `/tmp/spn090-review-43d3ee62/spn090-review43-a-production.json`
- `/tmp/spn090-review-43d3ee62/a-unit.log`
- `/tmp/spn090-review-43d3ee62/spn090-review43-a-unit.json`

Both ran from the candidate worktree with pinned Node26.13.0 first on PATH, supplied `watch.ts` and shared `scripts/serial.ts`, normal-pressure admission/runtime checks, unchanged2GiB/eight-minute limits and private outputs/cache. No tests ran concurrently. Afterward pressure was1, the shared lock was absent, no owned guard/serial/test/server descendants or3101listener remained. I promptly released the sole workload slot and removed only my private Vitest module cache. Tracked source remains clean; original untracked `artifacts/` is preserved. No source edit, package installation, push, PR metadata edit or cleanup of unique histories occurred.

I did not repeat the unchanged resource-aborted full compiler or Linux process/maintenance suite. A resource abort remains no type verdict. Previous independent208Vitest/28Node and five development lifecycle results retain their earlier candidate identities, and are not relabeled as current-head execution. The new production run closes the specific feasible packaging boundary here without replacing full hosted acceptance.

## 🎨 Independent visual and interaction applicability

I inspected all13 actual images using the image tool: five current startup variants (light/dark desktop, light/dark phone, light tablet), three current storage-result variants,192/512icons and the three historical light/dark/phone storage proposals. The historical proposal pixels remain references, not current physical-phone observations. I independently verified their original commit hashes; original captions, viewport dimensions and source identities remain valid.

The current storage dialog follows the playbook: readable theme tokens, meaningful title/icon, honest storage-protection copy, right-aligned guide/Done actions, visible focus and fitting phone layout. The current focused guide action improves discoverability over the historical quiet reference without introducing redundant recovery controls. Startup text is readable and stays within the phone/tablet viewport with modest fixed placement. The icons preserve the chosen facet family, spacing and optical alignment at both sizes. No clipping, accidental theme mismatch or layout concern was found.

Startup/storage/icon render inputs and relevant theme/story sources retain their prior bytes. The new shared Modal icon entry is unused by these stories; the already-inspected screenshot-runner drawing diagnostics change neither these renders nor their capture operation. The real production lifecycle tests now confirm that a displayed startup line disappears and its timer is cleared after guest mount, including service-worker-owned delivery, while pending account admission continues reporting. The invitation test independently confirms the changed navigation/readback interaction.

**I approve SPN-090's visual and interaction result, and retained-image applicability, on exact `43d3ee62bab1ed1d1b6d76209308f63f6e6aab07`, agent review only.** No fresh phone capture, whole-build byte identity or full Storybook completion is inferred. Full current-head Storybook and its native drawing owner remain required.

## 👥 Four personas, physical limits and pending acceptance

Operator receives bounded startup, disposed timers, explicit diagnostic/failure provenance and truthful maintenance fixture readiness without new services or paid orchestration. Owner and Collaborator retain saved content/images, stable links, private account boundaries, unfinished native input and replay/recovery ownership; landed feedback context does not replace those guards. Link guest retains only linked content and its own loading/access/revocation states, with no private offline store or account feedback authority, and no false perpetual startup announcement.

The accepted method continues to combine targeted Pixel10/latestChrome/HomeScreen observations with shared deterministic/native owners. Exact phone OS/browser/build identities are unknown; the final known-offline sign-in shortcut was not phone-retested; the notes do not prove every physical edit/image/reopen/replay/creation permutation. These are explicit confidence limits in the actual-base ticket, not passed checks or grounds to invent a current phone SHA. SPN-156's own installed repaired-build reconnect prerequisite remains untouched.

All seven required exact-current-head hosted gates, hosted typing, actual Linux supervised maintenance/recovery, selected native/content/access/replay/installation, ordinary desktop and full Storybook acceptance remain pending. Original source724 CI43626186157 remains failed, including three configured ready-guest timeouts and maintenance flaky first failure despite its retry; its31success/2failure terminal state is not relabeled. Historical successful native/Storybook results retain source724. Earlier671 recovery503 remains failed independently. The diagnostic invitation probe and corrected fixture do not establish an unknown historical cause. No score deduction is assigned for any CI status; these remain independent merge requirements.
