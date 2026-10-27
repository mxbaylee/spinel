# SPN-108 evidence record

This branch preserves the uncapped source and inspected numeric results/checksums
for [PR #202](https://github.com/mxbaylee/spinel/pull/202). The
[measurement contract](https://github.com/mxbaylee/spinel/blob/53df5a842b61c9cddb19c2c074d2c4ce240aabca/docs/implementation/SPN-108.md)
defines acceptance. Raw failed records are not retrospectively relabeled.

## Current checkpoint: fresh cap-44 collection pending

- Candidate: `53df5a842b61c9cddb19c2c074d2c4ce240aabca`.
- Actual CI source: `09cce1d160d5b03a20c7ba106c11a806ba90facb`.
- Both source trees: `151cd8c1d607a1534ee0aed7d3811da5e0c886a5`.
- Immutable uncapped baseline: `3fdac69f413d2fd423bc7ded41acbd67a177739c`.
- Main matched through `0a9cd200a5a457a6160f9dfaa86c49460ccc24e2`.
- Fresh [CI run 40597044138](https://github.com/mxbaylee/spinel/actions/runs/40597044138)
  and [Storybook run 40597044076](https://github.com/mxbaylee/spinel/actions/runs/40597044076).
- No accepted browser comparison or final grade yet.

The first measured cap-64 candidate failed the unchanged desktop paired-flush
p95 target: 27.4 / 29.6 / 29.5 ms against 16 ms. The current bound of 44 keeps the original
2,086-input continuous workload within 48 groups at unchanged native retention of 50.
Its latency remains to be established by fresh complete pairs. Local native
regressions passed all 48 Undo/Redo groups through actual sync admission,
acknowledgments, hash verification and peer delivery; 19 analyzer cases passed.
Both independent reviewers cleared source preflight, without final grades.

The same failed run exposed a signed CPU-profile timestamp reader error and a
synthetic composition sequence that omitted Chromium's final converted-text
update. The corrected reader retains raw bytes and full clock uncertainty while
sorting validated timestamp/sample pairs together. The mounted boundary now
uses Chromium's public composition input commands, verifies all 70 observed
provisional updates plus actual finalization event order, and retains exact
content/selection/replay/revocation assertions. Physical OS IMEs and the old
changed-final-end synthetic path without a converted update are not claimed fixed.

The evidence tree remains uncapped. Its additional commit parents retain actual
measured candidate source commits for provenance; they do not change the pinned
baseline tree. Always use the immutable baseline SHA above for comparisons.

## Immutable baseline provenance

| Source | Purpose |
| --- | --- |
| `a0c3154ae6b548d68ba8be9d143df781e47dc623` | Original uncapped observation-only application |
| `161b9874f3ac0e89a277c713ceb965e5ac39ca05` | Identical supported mobile Enter shortcut repair in both sources |
| `64770ad962c543d6eb9d855e51bae994e457377d` | Identical read-only reload reason/phase observation for schema 3 |
| `3fdac69f413d2fd423bc7ded41acbd67a177739c` | All concurrent main files through 0a9cd20, including SPN-063 docs and SPN-095 server/runtime, matched to candidate |

No baseline source installs the capacity policy, changes transport limits,
suppresses recovery, clears history or replaces the native workload. The same
current harness and pinned dependencies run on both sources. The original
16 paragraphs still use 2,071 keyboard-typed characters and 15 native Enter keys.

## Every first attempt remains accounted for

| Attempt | Disposition |
| --- | --- |
| Local baseline build | Passed; peak process-tree RSS 1,668.4 MiB |
| Local browser, initial launch | Loopback permission denied; no workload |
| Local browser, authorized launch | Watchdog-aborted at 2,099.0 MiB during two-editor startup; no accepted sample |
| CI 40579224187, `49a86ad` | Both presets failed during registration before typing; [reports](attempt-49a/manifest.json) |
| CI 40581429512, `cf611f7` | Desktop redo shortcut wrong; mobile observation deadline and missing native Enter exposed; [record](attempt-cf/result-summary.json) |
| CI 40586200654, `6f219b8`; CI 40586541181, `dbb2207` | Interrupted during viewer-observation repair; [6f](attempt-6f/disposition.json), [dbb](attempt-dbb/disposition.json) |
| CI 40586732900, `d099a22` | All eight baseline initial-content windows completed then failed Redo; no candidate; separate Sheet preview flake also failed despite passing retry; [record](attempt-d099/result-summary.json) |
| CI 40591775224, `993bafa` | Interrupted by current-main integration after three complete desktop baseline-only schema 3 cases; no accepted comparison; [record](attempt-993/disposition.json) |
| CI 40592509873, `2c33dec` | Cap 64 desktop p95 misses, incomplete signed-profile cases and synthetic composition Redo failure; ordinary current CI/Storybook components passed, responsiveness and aggregate failed; [record](attempt-2c33/result-summary.json) |
| CI 40597044138, `53df5a8` | Fresh cap 44 collection pending; no accepted result |

The baseline collection deadline is 600 seconds per case and the job deadline is
60 minutes. Candidate cases retain 300 seconds. These are collection windows;
all registered latency targets remain unchanged. The local blank-Chromium
IME control also retains its initial sandbox launch failure and unsupported
all-events-trusted assertion before the completed event-order observation.

## Explicit schema 3 amendment

The initial contract required baseline Redo success. The corrected shortcut and
exact native reproduction exposed a 166,056-byte redo mutation array and a 166,206-byte
reserved envelope (fixture unit ID `doc`), exceeding the unchanged 65,536-byte
wire limit. Typing and Undo passed actual ACK/hash verification; Redo restored
locally then refused sync admission with `capacity`. Browser UUIDs alter the
exact envelope size.

Schema3 was adopted after baseline observation and before any candidate
measurement. It separates primary timing and initial integrity from Redo
outcome. Only the baseline may report `baseline-capacity-refusal`: exact
successful empty Undo, actual Ctrl+Y, exactly one same-unit sender capacity reload
with clean:false inside the recorded Redo phase, and exact empty saved/peer/local
recovery at the unchanged revision. Every other failure remains blocking.
Candidate content, selections, full original-workload replay, no reloads and
all latency targets remain mandatory. Old schema 2 and incomplete cases stay failed.

## Retention and independent review

The public record contains inspected numeric results, dispositions and checksums.
The durable private measurement bundle supplied to the owner preserves raw CPU
profiles, clock sidecars, input/long-task timelines, phase snapshots, manifests,
test reports and logs beyond the seven-day Actions retention. Screenshots remain
in the original CI artifacts. Automatic approval review rejected bulk public
publication of the complete mixed CI ZIP; that payload is not republished.

Two nonimplementing reviewers must each score above 95/100 on the same final
candidate and have no blockers, after inspecting fresh paired raw evidence and
all current required checks. Passing retries, historical scores and a matching
tree alone do not establish acceptance.
