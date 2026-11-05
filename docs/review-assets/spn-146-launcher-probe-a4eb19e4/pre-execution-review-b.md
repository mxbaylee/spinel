# 🔎 SPN-146 actual launcher probe — pre-execution review B

**Execution admission is withheld for the small cleanup and output-bound repairs below.** Reviewed the unexecuted /tmp/spn146-launcher-probe/run.ts and its imported ownership helper, existing direct-CLI lifecycle test and fixed plan read-only. No run directory or result was created by this review, and no application/browser/provider/build/install execution was performed.

## 🛑 Required repairs

**Remaining descendants discovered after normal child close are not terminated.** In run.ts:120–132 the signal branch runs only when an earlier failure already exists. The subsequent final inventory can detect a remaining owned descendant and throw `Launcher descendants remain`; the catch sets failure, but does not return to termination/reaping. A normally exited CLI with a surviving detached descendant therefore leaves that process alive. Classify the remaining-owned failure before shared termination/reaping, preserve the original failure if present, signal only identity-revalidated owned processes and retain the final reaped inventory. Do not continue to the second launcher if cleanup is incomplete. The outer guard is a backstop, not a replacement for this probe's own cleanup contract.

**The advertised stdout/stderr bound is only a deferred error flag.** At run.ts:78–79 each data event first appends its whole chunk and continues appending future chunks even after one MiB is exceeded. The polling loop later notices childError, so the retained buffers are not bounded at one MiB. Cap retained bytes immediately, retain an explicit overflow failure and stop appending additional chunks while termination/stream settlement proceeds. Use byte accounting rather than JavaScript string length if the limit is stated in MiB. Preserve the original child/measurement failure if output or log persistence also fails.

**Avoid a preventable partial-barrier read.** The worker writes ready.json directly while the parent polls and JSON-parses it. A read can observe the file before that write completes; this would correctly fail closed but unnecessarily consume the one fixed allowance. Write the small ready receipt to a temporary sibling and rename it atomically. This does not introduce a retry or choose a later measurement; the parent still samples exactly once on first complete ready observation. The settled receipt can use the same tiny pattern for consistency.

## ✅ What is already appropriate

The output directory is create-once. The probe pins current a4eb source/clean status, Node identity, npm entry, actual Playwright package/bin and program hashes. A fixture-local executable link resolves to the same pinned CLI for the npm and direct routes; npm is offline and nonconfirming, and no installation fallback is implemented. Both launchers receive the same fixture/cwd/args/environment. The test requests no browser fixture or app server.

One old→direct invocation each reaches a named one-worker barrier, and the parent takes its first barrier snapshot before releasing it. The simultaneous-owned RSS set includes the probe/sampling overhead consistently rather than subtracting independent maxima. Peaks are separately recorded. Per-loop bounds are 15 seconds and 2 GiB under the separately required 60-second/2-GiB/normal-pressure owner. The old handshake is moved into its retained directory rather than discarded before the second invocation.

Actual selected-test, retry, worker, Node, program, result and afterEach settlement checks are present. Worker module paths and Node options are compared, recorded npm-related environment names expose that those environments need not be literally identical, and read-only cached dependency members are hashed. Do not describe require.cache inventory as universal proof of every possible dynamically loaded/ESM module; it is the observed package cache closure for this fixture. The existing separate lifecycle control remains the timeout/owned-settlement owner; this probe need not repeat it.

The ancestry proof checks an npm ancestor on the old path, none on the direct path and fewer direct ancestors. The intended workflow removes both the npm executor and its intervening shell; retain the actual paths and explicitly verify that topology when deciding the outcome, rather than describing any shorter chain as necessarily those exact two removed nodes. This is a receipt/interpretation requirement, not a request for a generic process classifier.

## 🚦 Revalidation and interpretation

After the small repairs are statically revalidated, a single capability run under the unchanged plan can be admissible. Keep the fixed >=65,536 KiB reduction, all parity/cleanup checks, first-barrier sample, order and stop conditions. Failure/overflow/incomplete cleanup/negative reduction consumes the allowance; no stabilization wait, warmup, forced GC, rerun or threshold change is justified.

A qualifying result could support the direct-launcher resource hypothesis, not guaranteed Linux browser-tree headroom, historical native cause or native latency acceptance. The previous a4eb diagnostic remains failed and closed. No new application allowance, source publication grade or provider execution follows from this review. User scope remains SPN-146 plus SPN-090, then stop.

## ✅ Static repair revalidation — capability run admitted

Re-read the repaired, still-unexecuted run.ts, SHA256 **6f3ceafe22879e17e9695064f72f2e83f74faf4dcf68df0d57e3208e7f6992b0**. The run directory does not yet exist. This addendum supersedes the initial withheld capability admission above, while preserving the findings and limitations.

The stream handlers now retain at most the remaining one-MiB input-byte allowance per stream, flag overflow immediately and discard subsequent excess rather than continuing to accumulate it. The first complete ready receipt is published by atomic rename. A remaining-descendant observation after normal CLI close now establishes failure before log persistence, then invokes identity-revalidated termination and a bounded one-second reap check. It cannot silently proceed to the direct case or report a qualified result after that cleanup failure. Prior failure remains primary, with later log/cleanup errors secondary.

Every retained snapshot now performs the same finite time/RSS checks and preserves its first violating state. In particular, a violating barrier is not released or accepted, and final-only violations cannot turn into a pass. The unchanged external guard remains the ultimate owner for exceptional monitor/OS failures; the result must retain incomplete cleanup honestly if normal containment cannot finish.

The platform distinction is valid: a Mac shell may exec the CLI rather than remain as a separate ancestor. Require the observed npm ancestor on the old path, its absence on the direct path and an actually shorter direct chain; report whether a separate shell was observed. Do not fabricate the Linux shell topology or require an irrelevant persistent Mac shell. This changes no memory threshold or favorable sample selection.

**One capability execution is now admissible** on these reviewed bytes, fixed npm→direct order, one first-ready sample each, identical fixture/result/observed-module parity, >=65,536-KiB simultaneous-owned saving, fifteen-second command bounds and the declared sixty-second/2-GiB/normal-pressure serial watchdog. No warmup, repeat, installation, browser, app, provider or new application allowance is admitted. Failure, negative result or partial evidence closes this capability attempt. I performed only static reads and a small source hash/absence check, not execution.

Final pre-execution readback includes the additional firstUnsettled receipt: the first failed cleanup inventory is retained before kill/reap replaces sample.final. The assigned snapshot is not subsequently mutated; later inventories replace it. **The final admitted script hash is d97175b753efd12e3a5e7cce937e2190f025beae768bcb62d45ddddffe16dcc2**, superseding the immediately preceding hash. The run directory was still absent at this readback. All limits and the single capability allowance above remain unchanged.
