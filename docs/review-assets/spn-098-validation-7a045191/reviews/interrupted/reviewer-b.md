# 🔎 SPN-098 technical handoff — superseded review B

This is a technical handoff, **not a qualifying review**. No numerical grade, push approval, merge approval or exact-head visual approval is issued. The delivery manager requested replacement of this review because a grade-masking defect in historical packet material made exposure uncertain. This replacement preserves the blind-input requirement; it is unrelated to any desired assessment.

## 🧾 Identity and exposure disclosure

- Candidate: `7a0451917ef38524138fa2eac432d4520fbed008`.
- Actual base: `c525aa933505d6e78b8fdd7a89940d87506d5cb3`.
- Worktree: `/Users/mxbaylee/projects/spinel-spn-098-production`.
- Reviewer: `/root/spn098_integrated_b`, independent and nonimplementing. No source edits, dependency mutations, pushes or PR metadata changes were made.
- Exposure: I ran `rg -n '^##|^###|failure|failed|repair|boundary|capacity|review|cancel|131.2'` against packet `implementation-SPN-098.md` and `prior-pr-technical-history.md` in one command. The returned output was truncated. The visible prior-history portion contained dated failures and `[prior numerical review grade omitted]`; I did not consciously recall or use numerical grades/rubric values. I had not read the complete prior-PR history. The manager subsequently reported unmasked prior rubric values around lines 13/64. Because the search included the unsafe file and truncation makes exposure uncertain, this review is superseded. I did not reread that file after notification.
- I also read the grade-free prior validation evidence with another packet file in a combined, truncated tool response. No numerical score was assigned at any point.
- **No local execution tests were run.** The shared workload slot remained assigned elsewhere. Static inspection and small hash/read-only provenance checks only were performed.

## 🔐 Independently checked provenance

The receipt is `/tmp/spn098-post157-20261114/reviewer-b-static.json`. A Python read-only audit independently checked:

- Exact HEAD and clean tracked/untracked worktree.
- Packet `full-diff.patch` is byte-for-byte the plain `git diff` from actual base to candidate, SHA-256 `bb1a819021ddad7f828966177ff1e99e4d718606ddcbbf55597b7b6b4ac4fe7a`.
- All 51 retained runtime/configuration hashes, all 26 dependency/build/patch hashes and the four incoming non-documentation hashes.
- All 48 maintained image hashes, including the 32 images inspected directly below.
- All six packet/original hash and available Git-blob provenance bindings. This receipt precedes the packet sanitation correction; its contents must not imply validation of subsequently modified presentation copies.

The four incoming paths are `scripts/screenshots.ts`, `src/ui/nativeDrawingResize.test.ts`, `web/SyncNative.stories.tsx` and `web/nativeDrawingResize.ts`. I inspected their diff from source `5e72d33ac9cb3a86b3496345209493d6c86e469c`. They are native drawing fixture/assertion work. The screenshot runner adds reading of a synthetic `data-native-drawing-capture` field and bounded geometry metadata inside native geometry collection. It does not change selected feedback capture viewports, themes, screenshot flow or feedback fixtures. The nine selected feedback story modules exclude `SyncNative`.

## 🧩 Static technical observations

Read the original base ticket from the packet, process/run-backlog/personas/testing instructions, design README/admin guidance, the full changed runtime modules, added feedback/context tests, affected production stories and real diagnostics browser flows. I inspected changed smaller integration files and maintained guidance. Large historical evidence output was sometimes truncated; this handoff does not claim every historical packet byte was read.

No concrete actionable product defect was established during this static pass. This is not a substitute for the replacement reviewer's own inspection or related local tests.

### Durable submission and privacy

`src/server/diagnostics/routes.ts` derives user identity from the live cookie session, rejects Operator submission and mismatched account headers, validates an exact context-key allowlist and fixed route templates, and verifies current file/Space access immediately before the synchronous write. Mutation routes require configured Origin and JSON. Session hashes and generation-bound HMAC bindings are not stored in exported events.

`src/server/diagnostics/store.ts` sets synchronous FULL and inserts feedback within `BEGIN IMMEDIATE`/`COMMIT`. The feedback path does not enter the lossy observation queue. An existing ID returns the previous receipt only for the identical actor/message/context and current generation; duplicate retries bypass new-report rate admission. New submissions have nonblank/length/byte/rate/free-space/logical/physical limits and fail visibly. Truncate clears rows and buffered observations, advances generation, and invalidates prepared pairs only after successful commit.

The tests inspect real SQLite persistence, restart retry, wrong actor/payload/context, transaction-trigger failure/rollback, full store refusal, failed flags, generation fencing and raw payload privacy. The HTTP tests reject unauthorized reads/mutations and foreign file access, allow authorized Collaborator reads for context, and reject access removed before a new submission.

### Paired exports and lifecycle

`feedback-export-worker.ts` freezes one database snapshot, checks generation, derives the closed window from selected actor `received_at`, and creates fresh user/system databases. Fresh filtered outputs avoid excluded text lingering in free pages. User selection includes attributed frontend/backend rows; system selection includes all actors and actor-null rows within the same interval. Both outputs carry shared snapshot ID/generation/window/watermark, actual counts, scope/provenance and explicit collection/drop/retention limitations. Empty selection provides no system-wide fallback; feedback-only spans remain truthful.

`feedback-exports.ts` has one bounded preparation/retained-pair/transfer lease, private staging permissions, free-space reserve, worker resource/deadline controls and expiry. Idle retained pairs hold no live SQLite lock and may coexist with the bounded generic export. Same-session/same-actor preparation recovery preserves the original window/expiry. Cancellation/expiry/truncate invalidates both artifacts. Cleanup failure retains an unavailable occupied lease and prevents new staging until removal succeeds. Maintenance drain closes feedback work.

The download route rechecks Operator/session/generation/expiry per streamed chunk. `feedback-transfer.ts` keeps the deadline over destination final flush and aborts the full pipeline. Existing regression controls use real SQLite files/workers, exact mixed-actor membership and raw excluded-text sentinels, clock rollback/new ingestion inside the old interval, simulated TTL, empty/feedback-only windows, cleanup denial, timeout after source EOF, late authority changes after preparation, disconnected JSON acknowledgement, timer expiry and disabled sender exports.

### UI and tests

`Feedback.tsx` retains failed/ambiguous attempted payloads read-only for an identical retry, validates a matching durable receipt before success, requires a deliberate new report after a stale generation/session and explains access loss. Account identity keys and guest caller filtering prevent sharing drafts across account changes. Page context is fixed route/UUID metadata rather than raw URL/title/content. Standalone editors and member Space pages supply the expected account/file context.

`AdminFeedback.tsx` treats failed flag loading as unknown, refreshes after clear/focus, and exposes only two scoped downloads. Preparation/transfer state is serialized. A failed known pair is discarded from the UI, so stale buttons cannot promise reuse after server-side disposal. Expiry and cancellation require explicit fresh preparation. Object URLs are bounded per scope and revoked. `AdminUsers.tsx` displays metadata/flag only; disabled senders remain selectable through server administrative lookup.

Production stories exercise StrictMode, draft dismissal/focus return, multiline/long-token geometry, pending/failed/stale/denied submissions, empty/expired/failed downloads, native disclosure marker, 44px recovery links and guest exclusion. The real browser test loses only the HTTP acknowledgement after actual persistence, retries the same full payload, compares exact paired SQLite rows/manifests and excludes later ingestion. It separately verifies clear/cancel/new-generation behavior. No browser execution was repeated by this reviewer.

### Scope and operations

The full effort-L feedback outcome remains coherent; SPN-110 retains actual observation TTL ownership and is explicitly unimplemented. The narrow integration record does not declare TTL acceptance. The CI workflow addition preserves the existing coverage plan and adds only the synthetic paired-export artifact to retention. The existing plan routes diagnostics server and shared inputs conservatively.

The original mobile 131.2ms failure, subsequent supervisor failures and successful comparators remain separate historical records. SPN-157's landed disposition is **bounded non-recurrence, historical cause unknown**, not causal repair. Source-equivalent prior acceptance is not current-head hosted success. Current required hosted gates remain independently pending; no point deduction or approval was inferred from those results.

## 🖼️ Actual image observations — no qualifying visual approval

I directly opened each of these 16 PNG names with `view_image`, once in `docs/review-assets/spn-098/` and once in `docs/review-assets/spn-098-post160/`, for **32 individually viewed images**:

- `account-draft-light`, `account-draft-dark`, `account-draft-phone`.
- `account-failed-draft-phone-dark`, `account-long-message-phone`, `account-access-changed-phone`.
- `admin-feedback-flag-light`, `admin-paired-downloads-light`, `admin-paired-downloads-dark`, `admin-paired-downloads-phone-dark`.
- `admin-download-failed-phone`, `admin-expanded-limits-phone`, `admin-access-changed-phone-dark`, `admin-old-feedback-only-phone`.
- `editor-guest-phone`, `admin-diagnostics-clear-phone`.

All have `.png` suffixes. Original proposed/reference source is `ea6aa741c89b3e52350849b73dbbc41ef3893fbc`; current retained actuals are runtime `23e7553ff4f35f5f03dfe51a644840994e52929e` / final `5e72d33ac9cb3a86b3496345209493d6c86e469c`. They were **not recaptured on this candidate**. They use synthetic fixtures and emulated phone widths; no physical-device claim is made.

Observed light/dark dialogs consistently use the existing palette and controls, readable message/privacy text and visible focus rings. Phone drafts and long messages wrap within the viewport. Failed drafts retain their content and communicate retry meaning. Access-changed states retain visible sign-in recovery and disabled submission/download controls. The Operator flag is text plus icon, without report text or document details. Paired windows/counts and collection-limit disclosures remain legible. Expanded/long states use the bounded modal's scroll surface; the single still may place lower actions below the visible fold, while existing story geometry assertions separately own reachability. The full-page clear image is longer than its 390×900 viewport and truthfully shows the pending destructive action; it must not be captioned as a single viewport capture.

Persona observations: Owner and Collaborator receive a comprehensible intentional report path, privacy disclosure and recoverable ambiguity. Operator receives a metadata flag and complete retained-download semantics without an inbox or document access. Link guest screenshots and story guards preserve scoped editor chrome without feedback/account actions. No visual defect was established in these inspected images. **Agent observations only; qualifying exact-SHA visual approval is withheld because this review is superseded.**

## ⏭️ Replacement review handoff

The replacement reviewer must receive the fully sanitized packet, independently run the relevant local tests after the manager grants the sole workload slot, form their own rubric assessment and independently decide visual approval on the exact committed candidate. This document and the static receipt preserve technical work and exposure history only. No grader should inherit a numerical assessment from this handoff.
