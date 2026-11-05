# 🔎 SPN-144 desktop responsiveness acceptance — review A

**Desktop responsiveness owner accepted on source `7b06d7516c4c386f5a23044e74d0c09b95a5a929`.** This is the unchanged independent unprofiled content/history/access/latency owner, not a new performance-improvement claim for SPN-144. Mobile responsiveness and final workflow/merge readiness remain separate.

Base `1045e729c391c47a9b6a895782a2fa69dc6fa044`; tested merge `eb91917064bd9d7665683fade860cd82457fbca4`; independently equal source/tested tree `d451532408b37f1cb5da12511c6fca38520599e2`. CI41959231289 attempt1, job127021613697 is terminal success, started2026-11-05T03:09:14Z, completed03:26:15Z, with every step successful. Raw terminal record/hash is bound in `responsiveness-desktop-review-a.json`.

## 📦 Artifact, source and first attempts

Artifact13385463079 ZIP is1,686,582bytes, SHA-256 `d2b65e6e6c5968a6f4bcf45558fc69067154dc926c9700c499e228875943217a`, matching published metadata. All **18 original members** passed ZIP CRC32/uncompressed-size checks, received SHA-256 identities, were extracted exclusively and re-read byte-for-byte. Nothing is omitted and the ZIP remains unchanged. `responsiveness-desktop-members-a.json` is the complete member proof.

Eight raw metric records cover baseline/candidate plain1/2/3 plus profile, with two CPU profiles and their clock records, full Playwright JSON, paired comparison and candidate boundary/continuation records. All harness hashes match current reviewed source. Historical responsiveness source remains `2c84a18449c7dae09e2817989fac6236be96ef98`, distinct from the callback project's historical baseline; candidate records name the tested merge. Same-run/attempt, runtime, browser, Playwright and per-sample instrumentation match across the pair.

Playwright retains exactly **4 baseline +7 candidate first-attempt cases**, each one retry0 passing result, zero flaky/unexpected/skipped cases. Candidate's additional cases cover post-burst continuation and composition/revocation boundaries. Existing paired comparison reports passed=true, no failures or unavailable fields; I independently recomputed primary distributions from raw input/native records with the current distribution/idle-owner helpers and verified their budgets and actual behavior records. No browser, benchmark or CPU profile event-analysis was repeated.

## ⏱️ Raw unprofiled budget evidence

For candidate plain1/2/3 respectively:

- Capacity flush p95 **7.6 /8.1 /7.4ms**, maximum **17.3 /12.8 /12.6ms**; limits16ms p95 and50ms maximum.
- Idle flush p95/maximum **0.8 /4.0 /0.7ms**, independently checked against the same16/50ms limits; idle observations do not dilute capacity samples.
- Input-to-frame p95 **36.4 /36.5 /36.4ms**, below100ms.
- Long-task maximum **74 /55 /75ms**, below200ms.
- First verified browser-local drain **309.5 /322.1 /308.3ms**, below1000ms. Later controller reads are retained separately (587.3 /488.6 /472.3ms upper-bound delays) and are not substituted for the preregistered local acceptance clock.

Each raw burst has2,086 native key/frame observations,65 capacity flush groups, pending high-water32/32 and final pending0/0. The terminal six-state idle episode is observed directly: terminal history/collaboration6/6, history owner drains history to0, collaboration owner drains collaboration to0, with policy-idle origins and full pair witness between terminal and first-empty observations. Time origin/completed-state identities match, and no witness invalidation is present. Plain2's native owner pair measures3.9ms while the primary flush record is4.0ms; these are separate observed spans, not an inconsistency to normalize away. The witness is sealed after integrity observation and before Undo.

## 📝 Native content, history and access

All candidate samples preserve exact pre-Undo authored text/hash/length in sender, peer and saved state, then exact final sender/peer/saved content. Actual sender history is66 groups. Plain1 performs the complete66-group Undo to the exact empty document with0 undos/66 redos, then Redo restores the exact document and66/0 history. Other candidate samples perform their registered one-group Undo/Redo. Sender selection returns to2086; peer selection remains0. Both reload observers have zero malformed/dropped records; candidate pre-Undo, Undo/Redo and final reload lists are empty. No capacity reload replaces the candidate history proof.

Historical baseline is retained honestly: its original capacity limit refuses Redo and records a capacity recovery reload in these four samples, with pre-Undo content and permitted baseline history outcome preserved. It is not credited with the candidate's66-group complete Redo guarantee. The raw comparison's historical limits/outcomes remain distinct.

The post-burst case preserves the original text plus the one continued native character in saved/native state, with no reload. Its40.5ms key-to-frame,40.8ms key-to-native-read and52.925ms request-return observations meet their current limits; original-final-key to continuation frame/read is438.2/438.5ms. Source/harness/run identities match.

Composition evidence shows composing Enter does not change provisional text/selection/pending/history, cancellation-end and converted-commit events are present, and the full first-attempt assertions verify atomic finalized composition, exact saved/peer state and Undo/Redo. Revocation evidence retains31/31 pending state before revocation, one held write, forwardedAfterRevocation=[false], and no observation errors; the actual test asserts unchanged persisted snapshot/revision and denial of old capability and late guest edits. `physicalIme=false`: synthetic composition events do not establish physical keyboard/IME behavior.

## 🔬 Profile and cleanup limits

CPU-profile files and clock hashes match the metric records. Their clock brackets have **420.2ms baseline /433.2ms candidate uncertainty**. Candidate profile retains **2 negative deltas and4 reordered samples**. Baseline sampled history/collaboration CPU is8,791.125/9,235.998ms; candidate137.887/113.049ms, but candidate whole-containing-task attribution is unavailable/null. These are sampled diagnostics, not exact per-flush execution times, recovered missing latency samples, or proof of SPN-144 causal improvement. Profile/plain differences include run-to-run variation and cannot isolate profiler overhead. Raw unprofiled budgets above independently pass.

I inspected the current source's finally paths: metric/continuation owners dispose observers and await fixture close; test and terminal job results pass, including post-job cleanup. The responsiveness schema does not provide the callback project's separate positive process/stream cleanup journal, so I make no independent OS-process-absence claim. All raw errors arrays are empty, and no failed first result is hidden by a later attempt. No routine screenshots are required for these unchanged successful owners; the complete retained artifact remains available for final privacy/evidence publication.

## 🧪 Independent audit work and disposition

Bounded serial/watchdog extraction: **287ms /90,768KiB**; raw metric/source/profile-hash audit: **1,195ms /223,744KiB**; content/history/idle-owner/continuation/boundary audit: **301ms /91,184KiB**, all normal pressure and first attempt. Supporting scripts, logs and watchdogs are `retain-responsiveness-desktop-a.*`, `audit-responsiveness-desktop-a.*`, and `audit-responsiveness-semantics-a.*`; terminal/pair/clock reconciliation is `responsiveness-desktop-finalize-a.ts`. No browser, converter, benchmark or profile-event replay occurred. Slot was released after bounded work.

No desktop responsiveness blocker found. This accepted owner cannot replace mobile responsiveness, callback pair acceptance, all seven final gates, final immutable evidence/guards or downstream SPN-141/140/120 acceptance. No merge approval is given here.
