# 🔗 Landed feedback integration and response readiness

Actual main is SPN-098 squash `ec42f0741415e4e712395fb47c30b911bc4e64ea`,
parent `c525aa93`. Local fixture repair was preserved first as `e4de84c0`.
Only backlog JSON/index conflicted; keep main's grooming date, next ID 161 and
completion list followed by provisional SPN-090 (`[SPN-098, SPN-090]`), and run
the index CLI. The Dashboard merge adds the upstream feedback account prop
without changing its device-editor retention, connection or authority branches.
No new package/SDK dependency or production repair is introduced here.

## 🧾 Combined-source checks and first failure

The 23 shared startup/warm-open/catalog/feedback-context tests passed (833 ms,
285,184 KiB sampled tree peak); combined production build passed (1,609 ms,
1,132,992 KiB). All six production startup/invite controls passed (5,811 ms,
1,078,048 KiB). Five development startup controls passed, but the existing
invitation control failed before the newly added navigation assertions: after
release, the once-only address was absent and its dialog still showed Creating.
That full batch was 12,304 ms / 1,217,264 KiB. Original source, report, log,
context and screenshot remain here. It is not relabeled as a passing attempt.

A read-only fixture database query later found one durable invitation for that
synthetic operator. The original case started at 19:17:51.448Z and reported
6,043 ms duration; its invitation timestamp was 19:17:57.577Z, approximately
86 ms after reported case completion. This supersedes the earlier assumption
that creation was observed within the failed case. The original attempt had no
request-stage journal, so response cancellation, delivery and readback attribution
remain unproved. No causal claim about SPN-098 or production maintenance is made.

One separately authorized diagnostic run retained the same assertions and budgets,
adding only redacted request/response stages. It passed (5,284 ms / 1,336,272 KiB)
and is **diagnosis, not replacement acceptance**. Its journal records held POST
at 992 ms, Escape at 1,003–1,005 ms, release at 1,006 ms, fetched 201 at 1,022 ms,
fulfilled at 1,023 ms, browser 201 and held readback at 1,024 ms, readback release
at 1,061 ms and browser 503 at 1,063 ms. There was no requestfailed event. The
cancellation hypothesis therefore remains unproved. The journal stores no invite
token, cookie or response body; diagnostic listeners were removed afterward.

## 🔬 Smallest contract-preserving correction

`release()` allows the routed POST to proceed; it does not establish its completion.
The control now registers an exact path/method browser response wait before Create,
then after release requires HTTP 201 and completed response delivery before starting
the existing five-second address/focus assertions. The original overall 30-second
budget, actual Escape, held POST, held 503 readback, navigation/secret-disposal
assertions and retry settings are unchanged. No delay or retry was added. This
repairs an unsupported readiness assumption without claiming the original cause.

The final invitation control passed in development (5,243 ms / 1,400,768 KiB)
and production (2,470 ms / 1,317,872 KiB). A bounded negative changed only
AdminPage's health hash handling to ignore busy while preserving the earlier
People guard. The same control failed exactly at the new held-readback health
navigation assertion: expected `#invites`, received `#health` (7,695 ms /
1,419,888 KiB). This is detecting failure evidence, not a proposal. Restore
AdminPage byte-exact to the positive/main source afterward; cleanup records that
comparison. No unrelated browser matrix or unchanged startup case was repeated.

## 🔒 Identity, resources and remaining acceptance

`checks.json` binds actual commands, outcomes, peaks and final source inputs.
`executed-inputs.json.gz` retains the first combined input map; only the admin
fixture changed afterward. Both final invitation positives and the detecting
negative use its exact final bytes. The production build was not affected by
that test-only correction. Source/negative snapshots and full reports remain
available without numerical review assessments.

All workloads used pinned Node 26.13.0, shared serial, normal-pressure admission,
the 2 GiB sampled process-tree limit and eight-minute watchdog. Vitest used its
private module-cache path and disabled results caching. Final lint passed;
no task server/browser process, listener or serial lock remained at release.
The earlier full compiler resource abort remains no verdict; no unchanged retry
was run. Current combined hosted typing, full Linux supervised maintenance,
native/browser acceptance and Storybook are required before merge.

The existing 13 useful startup/storage/icon images retain their original source
captions. No new layout, component or icon was introduced by the fixture repair;
incoming feedback UI is already owned by landed main. Shared Modal's upstream
change adds only an unused feedback icon entry for these stories. Independent
exact-head visual applicability must still assess the complete combined source.
First-failure and terminal source724 archives remain immutable, published and failed.
No physical-phone retest or reinterpretation of its unknown build/version is claimed.
