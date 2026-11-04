# SPN-089 final native-preview evidence

This ancillary bundle preserves the fresh, uninstrumented native-copy preview captures and their visual review, together with the failure from the current source's first Desktop offline attempt. It leaves the tested application source identity unchanged. See [PR #260](https://github.com/mxbaylee/spinel/pull/260) for full-suite and current readiness.

## Source and build

| Identity | Value |
| --- | --- |
| Application source | `ef899b8004c650f8564d6f1fc3fa7d9bf9623076` |
| Tested PR merge | `b928c3848847eca3433171524a3ed8d331e295e4` |
| Source and tested merge tree | `19d726f7eeb41c581a7bd96ee221e49215a02f13` |
| Storybook workflow | [41918564629](https://github.com/mxbaylee/spinel/actions/runs/41918564629) |
| Hosted artifact | `13366516366` — 6,192,507 bytes |
| Hosted archive SHA-256 | `a39ef7084e29999b2da37c6764dcd90ffa6c5ced5d5cb9b0fcb17c23332906d6` |

The original [build provenance](final-build-provenance.json), [capture measurements](final-captures.json) and [capture manifest](final/manifest.json) are retained. The unchanged screenshot runner completed **5/5 native-copy variants with zero failures** in **29.736 seconds**, at **1,080,508 KiB** peak process-tree RSS. These are captures of the actual hosted source build, with no diagnostic instrumentation or derived-bundle substitutions.

| Variant | Capture |
| --- | --- |
| Desktop light | [PNG](final/redesign-native-editors--make-copy-dialog-light.png) |
| Desktop dark | [PNG](final/redesign-native-editors--make-copy-dialog-dark.png) |
| Phone light | [PNG](final/redesign-native-editors--make-copy-dialog-phone.png) |
| Phone dark | [PNG](final/redesign-native-editors--make-copy-dialog-phone-dark.png) |
| Tablet | [PNG](final/redesign-native-editors--make-copy-dialog-tablet.png) |

The [inventory receipt](inventory-receipt.json) retains all **45 production inventory rows and 114 unique IDs**. All 114 IDs resolve to exact story entries in the final hosted index, with zero missing, non-story or mismatched IDs. This establishes preview availability; it does not claim that the entire catalogue or all CI passed.

## Reviewer-reported visual disposition

`dialog_audit` reported the following judgment for this exact source:

> Final visual approval granted — agent review only — SPN-089 dialog-title implementation and reviewed layouts at ef899b8004c650f8564d6f1fc3fa7d9bf9623076, tree 19d726f7eeb41c581a7bd96ee221e49215a02f13. All five fresh uninstrumented captures personally inspected and approved; all 363 extracted files byte-match archive. Prior common/formula/Appearance/Profile/Space/Search/Passkeys/History and four native production captures carry forward under source 8e5c48f because only NativeEditors.stories.tsx changed outside documentation. P3 accepted fixture-only fidelity limitation: compact Name inputs use default square borders from existing .rd-native-editor exclusion, whereas actual production captures show rounded inputs. This does not block title/layout visual approval. Full CI/Firefox readiness remains separate.

The P3 observation is a fixture fidelity limitation, so the compact preview should not be described as pixel-identical to the production form. The earlier production native screenshots retain their original `8e5c48f` provenance in the application's SPN-089 evidence record.

## Preserved Firefox failure

The current source's first Desktop offline attempt, [run 41918564509, attempt 1](https://github.com/mxbaylee/spinel/actions/runs/41918564509), finished with **failure** at **2026-11-04 21:52:42 UTC**. Chrome job `126884672301` and Safari job `126884672353` passed; native Firefox/macOS job [`126884671951`](https://github.com/mxbaylee/spinel/actions/runs/41918564509/job/126884671951) failed.

The [minimal sanitized record](firefox-first-attempt/failure-record.json) preserves the original identities, archive SHA-256, relevant source hashes and complete ten-operation deletion sequence. `localStorage.clear` returned **0**; the later strict verification saw **1** local-storage entry. Service-worker and shell-cache removal and deletion of the targeted private database passed. The other two database names did not fail the predicate. The subsequent storage-loss checks did not run.

The [failure PNG](firefox-first-attempt/failure.png) shows the live **Shared with me** application still displayed after preparation failed. The record establishes storage counts; the screenshot supplies UI context. Full browser-driver logs, raw acceptance data with unrelated embedded images, and authentication/session material are excluded.

This failure belongs to **SPN-141's quiescent storage-loss preparation outcome**. The exact key/writer, whether it shares the earlier failure's producer, and whether unintegrated candidate `c4e64fa110a57d70fb682649d7f4d45ca3d20951` fixes this exact predicate remain **unproven**. Its integration is blocked by SPN-142 and needs fresh native acceptance. This bundle preserves the original failed attempt without claiming a repair or replacing it with other passes.

## Bundle integrity

[bundle-manifest.json](bundle-manifest.json) records each payload file's byte size and SHA-256. It excludes its own digest. The final captures, build/runner records and failure PNG were copied byte-for-byte; the inventory and sanitized failure receipt are extracted records with their source identities retained.
